using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Host.Flashcards;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The registry exists because the browser cannot hold the engine's session object the way the
/// desktop did, and everything worth testing here follows from that: two requests for the same
/// deck's start racing each other, two requests against one session racing each other, and the
/// idle sweep racing a request that just touched the session it is about to expire. None of this
/// shows up in a single-threaded call, only under real concurrency, so the tests drive the
/// registry from several tasks at once rather than asserting on isolated calls alone.
/// </summary>
public sealed class StudySessionRegistryTests
{
    [Fact]
    public async Task StartExclusiveSerializesTwoStartsOnTheSameDeck()
    {
        var registry = new StudySessionRegistry();
        var inside = 0;
        var overlapped = false;

        async Task<int> Start()
        {
            if (Interlocked.Increment(ref inside) > 1)
                overlapped = true;
            await Task.Delay(30);
            Interlocked.Decrement(ref inside);
            return 1;
        }

        var first = registry.StartExclusiveAsync("deck-a", Start, CancellationToken.None);
        var second = registry.StartExclusiveAsync("deck-a", Start, CancellationToken.None);
        await Task.WhenAll(first, second);

        Assert.False(overlapped, "two starts on the same deck ran their setup at the same time");
    }

    [Fact]
    public async Task StartExclusiveOnDifferentDecksDoesNotWaitOnEachOther()
    {
        var registry = new StudySessionRegistry();

        Task<int> Start() => Task.Delay(250).ContinueWith(_ => 1);

        var clock = System.Diagnostics.Stopwatch.StartNew();
        var a = registry.StartExclusiveAsync("deck-a", Start, CancellationToken.None);
        var b = registry.StartExclusiveAsync("deck-b", Start, CancellationToken.None);
        await Task.WhenAll(a, b);
        clock.Stop();

        // Serialized, the pair would take at least 500ms; run side by side they finish near 250ms.
        // 450ms sits well clear of both so ordinary scheduling noise cannot flip the result.
        Assert.True(clock.ElapsedMilliseconds < 450,
            $"two different decks waited on each other's gate ({clock.ElapsedMilliseconds}ms)");
    }

    [Fact]
    public void AddAssignsEachSessionItsOwnIdAndGetFindsItBack()
    {
        var registry = new StudySessionRegistry();
        var now = DateTimeOffset.UtcNow;

        var first = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now);
        var second = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now);

        Assert.NotEqual(first.Id, second.Id);
        Assert.Same(first, registry.Get(first.Id, now));
        Assert.Same(second, registry.Get(second.Id, now));
    }

    [Fact]
    public async Task ConcurrentAddsNeverLoseASession()
    {
        var registry = new StudySessionRegistry();
        var now = DateTimeOffset.UtcNow;
        const int count = 200;

        var tasks = Enumerable.Range(0, count).Select(i => Task.Run(() =>
            registry.Add(new FakeSession($"deck-{i % 5}"), $"Deck {i}", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now)));
        var entries = await Task.WhenAll(tasks);

        Assert.Equal(count, entries.Select(e => e.Id).Distinct().Count());
        foreach (var entry in entries)
            Assert.Same(entry, registry.Get(entry.Id, now));
    }

    [Fact]
    public void GetTouchesTheSessionAndReturnsNullForAnUnknownId()
    {
        var registry = new StudySessionRegistry();
        var started = DateTimeOffset.UtcNow;
        var entry = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, started);

        Assert.Null(registry.Get("does-not-exist", started));

        var later = started.AddMinutes(5);
        var found = registry.Get(entry.Id, later);

        Assert.NotNull(found);
        Assert.Equal(later, found!.LastTouched);
    }

    [Fact]
    public void RemoveTakesTheSessionOutAndIsANoOpTheSecondTime()
    {
        var registry = new StudySessionRegistry();
        var now = DateTimeOffset.UtcNow;
        var entry = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now);

        Assert.Same(entry, registry.Remove(entry.Id));
        Assert.Null(registry.Get(entry.Id, now));
        Assert.Null(registry.Remove(entry.Id));
    }

    [Fact]
    public void RemoveForDeckOnlyTakesThatDecksSessionsAndLeavesTheRest()
    {
        var registry = new StudySessionRegistry();
        var now = DateTimeOffset.UtcNow;
        var a1 = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now);
        var a2 = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now);
        var b1 = registry.Add(new FakeSession("deck-b"), "Deck B", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now);

        var removed = registry.RemoveForDeck("deck-a");

        Assert.Equal(new[] { a1.Id, a2.Id }.OrderBy(id => id), removed.Select(e => e.Id).OrderBy(id => id));
        Assert.Null(registry.Get(a1.Id, now));
        Assert.Null(registry.Get(a2.Id, now));
        Assert.Same(b1, registry.Get(b1.Id, now));
    }

    [Fact]
    public void RemoveForDeckOnAnUntouchedDeckReturnsEmpty()
    {
        var registry = new StudySessionRegistry();
        Assert.Empty(registry.RemoveForDeck("no-such-deck"));
    }

    [Fact]
    public void TakeExpiredRemovesOnlyWhatOutlivedTheIdleTimeoutAndLeavesTheRest()
    {
        var registry = new StudySessionRegistry();
        var started = DateTimeOffset.UtcNow;
        var stale = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, started);
        var fresh = registry.Add(new FakeSession("deck-b"), "Deck B", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, started);

        var sweepAt = started + StudySessionRegistry.IdleTimeout + TimeSpan.FromSeconds(1);
        fresh.Touch(sweepAt - TimeSpan.FromMinutes(1));

        var expired = registry.TakeExpired(sweepAt);

        Assert.Equal(new[] { stale.Id }, expired.Select(e => e.Id));
        Assert.Null(registry.Get(stale.Id, sweepAt));
        Assert.Same(fresh, registry.Get(fresh.Id, sweepAt));
    }

    [Fact]
    public void TakeExpiredLeavesEverythingWhenNothingHasGoneStaleYet()
    {
        var registry = new StudySessionRegistry();
        var now = DateTimeOffset.UtcNow;
        registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now);

        Assert.Empty(registry.TakeExpired(now + TimeSpan.FromMinutes(1)));
    }

    [Fact]
    public async Task MutateAsyncSerializesTwoMutationsOnTheSameEntry()
    {
        var registry = new StudySessionRegistry();
        var entry = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, DateTimeOffset.UtcNow);
        var inside = 0;
        var overlapped = false;

        Task Mutate() => entry.MutateAsync(async () =>
        {
            if (Interlocked.Increment(ref inside) > 1)
                overlapped = true;
            await Task.Delay(30);
            Interlocked.Decrement(ref inside);
        }, CancellationToken.None);

        await Task.WhenAll(Mutate(), Mutate());

        Assert.False(overlapped, "two mutations on the same session ran at the same time");
    }

    [Fact]
    public async Task MutateAsyncOnDifferentEntriesDoesNotWaitOnEachOther()
    {
        var registry = new StudySessionRegistry();
        var now = DateTimeOffset.UtcNow;
        var a = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now);
        var b = registry.Add(new FakeSession("deck-b"), "Deck B", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, now);

        var clock = System.Diagnostics.Stopwatch.StartNew();
        var first = a.MutateAsync(() => Task.Delay(250), CancellationToken.None);
        var second = b.MutateAsync(() => Task.Delay(250), CancellationToken.None);
        await Task.WhenAll(first, second);
        clock.Stop();

        Assert.True(clock.ElapsedMilliseconds < 450,
            $"two different sessions waited on each other's gate ({clock.ElapsedMilliseconds}ms)");
    }

    [Fact]
    public void RecordGradeAndRecordUndoTrackOneCounterAndNeverGoNegative()
    {
        var registry = new StudySessionRegistry();
        var entry = registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, DateTimeOffset.UtcNow);

        entry.RecordGrade();
        entry.RecordGrade();
        entry.RecordUndo();
        Assert.Equal(1, entry.Graded);

        entry.RecordUndo();
        entry.RecordUndo();
        Assert.Equal(0, entry.Graded);
    }

    private sealed class FakeSession(string deckId) : IFlashcardSession
    {
        public FlashcardSessionMode Mode => FlashcardSessionMode.Review;
        public string DeckId { get; } = deckId;
        public bool WritesSchedule => true;
        public bool IsFinished => false;
        public FlashcardView? Current => null;
        public FlashcardSessionProgress Progress => FlashcardSessionProgress.Empty;
        public string DescribeInterval(FlashcardReviewGrade grade) => "";
        public Task GradeAsync(FlashcardReviewGrade grade, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<bool> UndoAsync(CancellationToken cancellationToken = default) => Task.FromResult(false);
    }
}
