using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// In-memory stateful study queue shared by Review and Cram. Cards graded into a learning or
/// relearning step come back when that step says, ordered against the other waiting cards;
/// graduated cards leave. Review persists each grade through the study service; Cram persists
/// nothing.
/// </summary>
internal sealed class FlashcardStudySession : IFlashcardSession
{
    /// <summary>
    /// How far ahead of its step a card may still be shown. A short step is a wait the reader will
    /// sit through rather than end the session over, but a step further out than this belongs to a
    /// later sitting, so the card leaves instead of pinning the session open.
    /// </summary>
    private static readonly TimeSpan LearnAhead = TimeSpan.FromMinutes(20);

    private readonly IFlashcardStudyService _service;
    private readonly IFsrsScheduler _scheduler;
    private readonly FlashcardClock _clock;
    private readonly FlashcardPreset _preset;
    private readonly string _sessionId = Guid.NewGuid().ToString("N");
    private readonly List<FlashcardView> _queue;
    private readonly Stack<UndoRecord> _undo = new();
    private int _total;
    private int _completed;

    public FlashcardStudySession(
        IFlashcardStudyService service,
        IFsrsScheduler scheduler,
        FlashcardClock clock,
        FlashcardPreset preset,
        FlashcardSessionMode mode,
        string deckId,
        IReadOnlyList<FlashcardView> initialQueue)
    {
        _service = service;
        _scheduler = scheduler;
        _clock = clock;
        _preset = preset;
        Mode = mode;
        DeckId = deckId;
        _queue = new List<FlashcardView>(initialQueue);
        _total = _queue.Count;
    }

    public FlashcardSessionMode Mode { get; }
    public string DeckId { get; }
    public bool WritesSchedule => Mode == FlashcardSessionMode.Review;
    public bool IsFinished => _queue.Count == 0;
    public FlashcardView? Current => _queue.Count > 0 ? _queue[0] : null;

    public FlashcardSessionProgress Progress => new(
        New: _queue.Count(v => v.Schedule.FsrsState == FlashcardFsrsState.New),
        Learning: _queue.Count(v => v.Schedule.FsrsState is FlashcardFsrsState.Learning or FlashcardFsrsState.Relearning),
        Due: _queue.Count(v => v.Schedule.FsrsState == FlashcardFsrsState.Review),
        Completed: _completed,
        Total: _total);

    public string DescribeInterval(FlashcardReviewGrade grade)
    {
        var current = Current;
        return current is null ? string.Empty : _scheduler.DescribeInterval(current.Schedule, grade, _clock.Now, _preset);
    }

    public async Task GradeAsync(FlashcardReviewGrade grade, CancellationToken cancellationToken = default)
    {
        var current = Current;
        if (current is null)
            return;

        var now = _clock.Now;
        var updatedSchedule = _scheduler.ApplyGrade(current.Schedule, grade, now, _preset);
        var wasNew = current.Schedule.FsrsState == FlashcardFsrsState.New;

        // Cram writes nothing, so it cannot mark a leech either. A card the reader is drilling
        // outside its schedule has not lapsed in any sense the scheduler tracks.
        var leeched = WritesSchedule
            ? FlashcardLeech.Evaluate(current.Card, current.Schedule, updatedSchedule, _preset, now)
            : null;

        // Answering one card off a piece of material is enough for one day: the rest of it would
        // only be answered from memory of this card rather than from memory of the material. Cram
        // writes nothing, so it neither buries nor is bound by a bury.
        var buryUntil = WritesSchedule && _preset.BuryRelated
            ? _clock.DueAfterDays(now, 1, _preset.DayStartHour)
            : (DateTimeOffset?)null;

        long reviewId = 0;
        var localDay = _clock.KeyFor(now, _preset.DayStartHour);
        if (WritesSchedule)
        {
            // A card with no prior review has no elapsed interval to log, so this is 0 rather than
            // the scheduler's formula, which falls back to the card's due date (its creation time
            // for a New card) and would otherwise log the card's age as if it were a review gap.
            var elapsedDays = current.Schedule.LastReviewedAt is null ? 0d : _scheduler.ElapsedDays(current.Schedule, now);
            var scheduledDays = Math.Max(0d, (current.Schedule.DueDate - (current.Schedule.LastReviewedAt ?? current.Schedule.DueDate)).TotalDays);
            var log = new FlashcardReviewLog(FlashcardReviewLog.Unassigned, current.Card.Id, DeckId, _sessionId,
                grade, now, elapsedDays, scheduledDays, updatedSchedule.Stability, updatedSchedule.Difficulty,
                current.Schedule.FsrsState, updatedSchedule.FsrsState);
            reviewId = await _service.RecordReviewAsync(new FlashcardReviewEntry(updatedSchedule, log, wasNew, localDay, leeched, buryUntil), cancellationToken).ConfigureAwait(false);
        }

        _queue.RemoveAt(0);
        // The store holds the rest of the material back from later sittings; this sitting is
        // already holding it in memory, so it comes out of the queue here.
        var buried = buryUntil is null ? Array.Empty<BuriedCard>() : TakeSiblingsOut(current.Card.FactId);
        var stepping = updatedSchedule.FsrsState is FlashcardFsrsState.Learning or FlashcardFsrsState.Relearning;
        // A card just suspended for lapsing too often does not come back on its relearning step:
        // the whole point of suspending it was that another repetition is not the answer.
        var suspended = leeched?.State == FlashcardCardState.Suspended;
        var requeued = stepping && !suspended && updatedSchedule.DueDate - now <= LearnAhead;
        var updatedView = current with { Schedule = updatedSchedule, Card = leeched ?? current.Card };
        if (requeued)
            _queue.Insert(NextStepPosition(updatedSchedule.DueDate, now), updatedView);
        else
            _completed++;

        // A buried card is not one the reader got through, so the sitting is that much shorter
        // rather than one that can never finish.
        _total -= buried.Length;

        _undo.Push(new UndoRecord(current, reviewId, wasNew, localDay, requeued, leeched is not null, buried));
    }

    /// <summary>
    /// Pulls every other card off one piece of material out of the queue, remembering where each
    /// sat so undo can put it back where the reader would have met it.
    /// </summary>
    private BuriedCard[] TakeSiblingsOut(string? factId)
    {
        if (string.IsNullOrEmpty(factId))
            return Array.Empty<BuriedCard>();

        var taken = new List<BuriedCard>();
        for (var i = _queue.Count - 1; i >= 0; i--)
        {
            if (!string.Equals(_queue[i].Card.FactId, factId, StringComparison.Ordinal))
                continue;
            taken.Add(new BuriedCard(i, _queue[i]));
            _queue.RemoveAt(i);
        }

        // Walking backwards keeps the indexes valid while removing; putting them back needs the
        // other order.
        taken.Reverse();
        return taken.ToArray();
    }

    /// <summary>
    /// Where a card waiting on a step belongs: after everything that can be answered right away,
    /// and among the other waiting cards in the order their steps come due. A fixed gap would put
    /// a one minute step and a ten minute step back in the same place.
    /// </summary>
    private int NextStepPosition(DateTimeOffset due, DateTimeOffset now)
    {
        for (var i = 0; i < _queue.Count; i++)
        {
            var waiting = _queue[i].Schedule;
            if (waiting.DueDate <= now)
                continue;
            if (waiting.DueDate > due)
                return i;
        }
        return _queue.Count;
    }

    public async Task<bool> UndoAsync(CancellationToken cancellationToken = default)
    {
        if (_undo.Count == 0)
            return false;

        var record = _undo.Pop();
        if (WritesSchedule && record.ReviewId > 0)
            await _service.UndoReviewAsync(DeckId, record.Before.Schedule, record.ReviewId, record.LocalDay, record.WasNew,
                record.Leeched ? record.Before.Card : null, record.Buried.Length > 0, cancellationToken).ConfigureAwait(false);

        // Remove the post-grade copy of the card (if it was requeued) and restore the pre-grade card to the front.
        var idx = _queue.FindIndex(v => string.Equals(v.Card.Id, record.Before.Card.Id, StringComparison.Ordinal));
        if (idx >= 0)
            _queue.RemoveAt(idx);
        else if (!record.Requeued)
            _completed = Math.Max(0, _completed - 1);

        // The queue is back to the shape it had the moment the siblings came out, so each one
        // goes back where it was, lowest first.
        foreach (var (position, view) in record.Buried)
            _queue.Insert(Math.Min(position, _queue.Count), view);
        _total += record.Buried.Length;

        _queue.Insert(0, record.Before);
        return true;
    }

    /// <summary>A card taken out of the queue for its material, and the place it came out of.</summary>
    private readonly record struct BuriedCard(int Position, FlashcardView View);

    private sealed record UndoRecord(FlashcardView Before, long ReviewId, bool WasNew, string LocalDay, bool Requeued, bool Leeched, BuriedCard[] Buried);
}
