using System.Collections.Concurrent;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Keeps live study sessions on the server and hands each one an id the client can name.
/// </summary>
/// <remarks>
/// The engine's session is a mutable in-memory queue with an undo stack and no identity of its
/// own - the desktop simply held the object for as long as the screen was open. A browser cannot
/// hold it, so the host does, and the client drives it over REST. That introduces a lifetime the
/// desktop never had: nothing guarantees the client ever says it is finished. Hence the idle
/// sweep below.
/// </remarks>
public sealed class StudySessionRegistry
{
    /// <summary>
    /// How long a session survives without a request. Hour-scale on purpose: the cost of keeping
    /// one is a card list and an undo stack, and cutting a reader off mid-deck because they took
    /// a long break would be far worse than holding a few kilobytes.
    /// </summary>
    public static readonly TimeSpan IdleTimeout = TimeSpan.FromHours(1);

    private readonly ConcurrentDictionary<string, StudySessionEntry> _sessions = new(StringComparer.Ordinal);

    // One gate per deck, never removed. A deck's gate is two pointers and the set of decks is
    // small and long-lived, whereas retiring one safely would mean proving nobody is about to
    // wait on it - the wrong trade for the size of what is being kept.
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _startGates = new(StringComparer.Ordinal);

    /// <summary>Runs a deck's session setup with no other start on that deck interleaving.</summary>
    /// <remarks>
    /// Superseding is a check-then-act: the caller clears the deck's old sessions, builds the new
    /// one over several awaited reads, and only then registers it. Two starts arriving inside that
    /// window each find nothing to supersede and both register, which is precisely the two-live-
    /// sessions state <see cref="RemoveForDeck"/> exists to prevent. The gate is per deck so
    /// starting one deck never waits on another.
    /// </remarks>
    public async Task<T> StartExclusiveAsync<T>(string deckId, Func<Task<T>> action, CancellationToken cancellationToken)
    {
        var gate = _startGates.GetOrAdd(deckId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await action().ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    public StudySessionEntry Add(
        IFlashcardSession session,
        string deckName,
        FlashcardSessionScope scope,
        FlashcardAutoReveal autoReveal,
        DateTimeOffset startedAt)
    {
        var entry = new StudySessionEntry(
            Guid.NewGuid().ToString("N"), session, deckName, scope, autoReveal, startedAt);
        _sessions[entry.Id] = entry;
        return entry;
    }

    /// <summary>Looks a session up and marks it as still in use. Null when it is unknown or expired.</summary>
    public StudySessionEntry? Get(string sessionId, DateTimeOffset now)
    {
        if (!_sessions.TryGetValue(sessionId, out var entry))
            return null;

        entry.Touch(now);
        return entry;
    }

    /// <summary>Ends a session. Null when the id is unknown, so a repeated end is not an error.</summary>
    public StudySessionEntry? Remove(string sessionId) =>
        _sessions.TryRemove(sessionId, out var entry) ? entry : null;

    /// <summary>Removes and hands back every live session on a deck.</summary>
    /// <remarks>
    /// Two sessions on one deck each hold their own snapshot of the schedules they started with,
    /// so grading in both writes each one's answer over the other's and charges the deck's daily
    /// budget twice for one card. The desktop cannot reach that state - it has one study screen -
    /// but a browser that navigated away without ending its session leaves one live for an hour,
    /// so re-entering the deck has to supersede it.
    /// </remarks>
    public IReadOnlyList<StudySessionEntry> RemoveForDeck(string deckId)
    {
        List<StudySessionEntry>? removed = null;
        foreach (var (id, entry) in _sessions)
        {
            if (!string.Equals(entry.Session.DeckId, deckId, StringComparison.Ordinal))
                continue;

            if (_sessions.TryRemove(id, out var taken))
                (removed ??= new List<StudySessionEntry>()).Add(taken);
        }

        return (IReadOnlyList<StudySessionEntry>?)removed ?? Array.Empty<StudySessionEntry>();
    }

    /// <summary>
    /// Removes and hands back every session nothing has touched inside the timeout.
    /// </summary>
    /// <remarks>
    /// Swept on request rather than on a timer: the only thing that accumulates sessions is a
    /// client making requests, so the work happens exactly when there is something to clean up
    /// and the host keeps no background loop running for a window that is usually idle. The
    /// entries come back rather than being dropped so the caller can still record the study each
    /// one represents - the desktop writes that record when its session object is disposed, and
    /// a browser that was closed mid-deck never gets to say so.
    /// </remarks>
    public IReadOnlyList<StudySessionEntry> TakeExpired(DateTimeOffset now)
    {
        List<StudySessionEntry>? expired = null;
        foreach (var (id, entry) in _sessions)
        {
            if (now - entry.LastTouched < IdleTimeout)
                continue;

            // Only the caller that actually removes it gets to report it, so two concurrent
            // requests cannot record the same session twice.
            if (!_sessions.TryRemove(id, out var removed))
                continue;

            // A request may have touched it in the moment between the test and the removal; put
            // a session back rather than expiring one that is being used right now.
            if (now - removed.LastTouched < IdleTimeout)
            {
                _sessions.TryAdd(id, removed);
                continue;
            }

            (expired ??= new List<StudySessionEntry>()).Add(removed);
        }

        return (IReadOnlyList<StudySessionEntry>?)expired ?? Array.Empty<StudySessionEntry>();
    }

    /// <summary>
    /// Atomically removes all sessions for shutdown, regardless of age. Concurrent end requests can
    /// remove each session only once.
    /// </summary>
    public IReadOnlyList<StudySessionEntry> TakeAll()
    {
        List<StudySessionEntry>? taken = null;
        foreach (var id in _sessions.Keys)
        {
            if (_sessions.TryRemove(id, out var removed))
                (taken ??= new List<StudySessionEntry>()).Add(removed);
        }

        return (IReadOnlyList<StudySessionEntry>?)taken ?? Array.Empty<StudySessionEntry>();
    }
}

/// <summary>One live session plus the bookkeeping the desktop kept in its ViewModel.</summary>
/// <remarks>
/// Deliberately not disposable. The only thing that could be disposed is the gate below, whose
/// wait handle is never touched, so disposing it frees nothing - and ending a session while a
/// grade is still inside the gate would fault that request for no gain. A dropped entry is
/// collected like any other object.
/// </remarks>
public sealed class StudySessionEntry
{
    // Grade and undo both read the head of the queue and then mutate it. Two requests arriving
    // together - a double-tapped grade button, or grade racing the unmount - would otherwise
    // grade the same card twice or undo into a queue that moved underneath them.
    private readonly SemaphoreSlim _gate = new(1, 1);

    // Held as ticks so the sweep, which reads this from another request's thread, cannot catch a
    // half-written value and drop a session someone is in the middle of.
    private long _lastTouchedTicks;

    internal StudySessionEntry(
        string id,
        IFlashcardSession session,
        string deckName,
        FlashcardSessionScope scope,
        FlashcardAutoReveal autoReveal,
        DateTimeOffset startedAt)
    {
        Id = id;
        Session = session;
        DeckName = deckName;
        Scope = scope;
        AutoReveal = autoReveal;
        StartedAt = startedAt;
        _lastTouchedTicks = startedAt.UtcTicks;
        StartedEmpty = session.IsFinished;
    }

    public string Id { get; }
    public IFlashcardSession Session { get; }
    public string DeckName { get; }
    public FlashcardSessionScope Scope { get; }
    public FlashcardAutoReveal AutoReveal { get; }
    public DateTimeOffset StartedAt { get; }
    public DateTimeOffset LastTouched => new(Volatile.Read(ref _lastTouchedTicks), TimeSpan.Zero);

    /// <summary>True when the queue was already empty at start - the "all caught up" case.</summary>
    public bool StartedEmpty { get; }

    /// <summary>
    /// Grading actions still standing, which is both how deep undo can go and how much study
    /// gets recorded when the session ends.
    /// </summary>
    /// <remarks>
    /// One counter, not two. The desktop tracks undo depth and cards-graded separately even
    /// though every path moves them together, and the one place it does not - giving up on undo
    /// zeroes the depth but leaves the card count - is a bug there: a session the reader fully
    /// reversed still reports cards studied. Keeping a single number makes that state
    /// unrepresentable. Distinct from the engine's <c>Completed</c>, which counts only cards that
    /// left the queue; an Again keeps the card in rotation but is still a grade.
    /// </remarks>
    public int Graded { get; private set; }

    public void Touch(DateTimeOffset now) => Volatile.Write(ref _lastTouchedTicks, now.UtcTicks);

    public void RecordGrade() => Graded++;

    public void RecordUndo() => Graded = Math.Max(0, Graded - 1);

    /// <summary>Resets the count when the engine reports it had nothing left to reverse.</summary>
    public void ClearUndo() => Graded = 0;

    /// <summary>
    /// Runs one mutation with the session to itself. The token only cancels the wait for the
    /// gate - a request the client gave up on before its turn came never has to run. Once the
    /// mutation starts it runs to completion, deliberately: the token here is the HTTP request's
    /// abort, and abandoning a grade halfway could leave the review committed while the queue it
    /// came from never advanced, so the card would come round again already graded.
    /// </summary>
    public async Task<T> MutateAsync<T>(Func<Task<T>> action, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await action().ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc cref="MutateAsync{T}"/>
    public async Task MutateAsync(Func<Task> action, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await action().ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }
}
