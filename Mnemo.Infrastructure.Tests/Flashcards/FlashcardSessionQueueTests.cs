using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// How the session queue behaves between grades: when a card waiting on a step comes back, when it
/// stops being this session's problem, and what a shuffle is allowed to reorder.
/// </summary>
public sealed class FlashcardSessionQueueTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    [Fact]
    public async Task ACardWaitingOnAStep_GoesBehindEverythingAnswerableNow()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, new[] { 10, 20 });
        await AddNewCardsAsync(h, deckId, 5);
        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));

        // The first card steps out to ten minutes from now, so everything still answerable comes
        // first rather than the card reappearing a fixed number of positions along.
        Assert.Equal("c1", session.Current!.Card.Id);
        await session.GradeAsync(FlashcardReviewGrade.Good);

        foreach (var id in new[] { "c2", "c3", "c4", "c5" })
        {
            Assert.Equal(id, session.Current!.Card.Id);
            await session.GradeAsync(FlashcardReviewGrade.Easy);
        }

        Assert.Equal("c1", session.Current!.Card.Id);
    }

    [Theory]
    // Twenty minutes is the window, so a ten minute step is a wait and an hour is a later sitting.
    [InlineData(10, false)]
    [InlineData(60, true)]
    public async Task AStepPastTheLearnAheadWindow_EndsTheCardsSession(int stepMinutes, bool leaves)
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, new[] { stepMinutes });
        await AddNewCardsAsync(h, deckId, 1);
        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));

        await session.GradeAsync(FlashcardReviewGrade.Good);

        Assert.Equal(leaves, session.IsFinished);
    }

    [Fact]
    public async Task WaitingCards_ComeBackInTheOrderTheirStepsFallDue()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, new[] { 1, 10 });

        // Both are already in learning, one on the one minute step and one on the ten minute step,
        // so grading each Hard repeats its own step and the two land at different times.
        await AddScheduledAsync(h, deckId, "slow", FlashcardFsrsState.Learning, stepIndex: 1);
        await AddScheduledAsync(h, deckId, "quick", FlashcardFsrsState.Learning, stepIndex: 0);
        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));

        Assert.Equal("quick", session.Current!.Card.Id);
        await session.GradeAsync(FlashcardReviewGrade.Hard); // back in one minute
        Assert.Equal("slow", session.Current!.Card.Id);
        await session.GradeAsync(FlashcardReviewGrade.Hard); // back in ten

        Assert.Equal("quick", session.Current!.Card.Id);
    }

    [Fact]
    public async Task Shuffle_ReordersInsideABandAndNotAcrossThem()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, new[] { 1, 10 }, shuffle: true);

        for (var i = 0; i < 2; i++)
            await AddScheduledAsync(h, deckId, $"learn{i}", FlashcardFsrsState.Learning, stepIndex: 0);
        for (var i = 0; i < 3; i++)
            await AddScheduledAsync(h, deckId, $"review{i}", FlashcardFsrsState.Review, stepIndex: 0);
        await AddNewCardsAsync(h, deckId, 4);

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));

        // Easy graduates whatever it is given, so every card is answered once and the queue drains
        // in the order it was built.
        var seen = new List<FlashcardFsrsState>();
        while (!session.IsFinished)
        {
            seen.Add(session.Current!.Schedule.FsrsState);
            await session.GradeAsync(FlashcardReviewGrade.Easy);
        }

        Assert.Equal(
            new[]
            {
                FlashcardFsrsState.Learning, FlashcardFsrsState.Learning,
                FlashcardFsrsState.Review, FlashcardFsrsState.Review, FlashcardFsrsState.Review,
                FlashcardFsrsState.New, FlashcardFsrsState.New, FlashcardFsrsState.New, FlashcardFsrsState.New,
            },
            seen);
    }

    // --- helpers ---

    private static async Task<string> SeedAsync(FlashcardStoreHarness h, int[] steps, bool shuffle = false)
    {
        var deckId = await h.SeedDeckAsync();
        await h.Store.WriteAsync((conn, tx, ct) => h.Presets.UpsertAsync(
            conn, tx, FlashcardPreset.CreateStandard(Now) with { LearningSteps = steps, ShuffleOrder = shuffle }, ct));
        return deckId;
    }

    private static async Task AddNewCardsAsync(FlashcardStoreHarness h, string deckId, int count)
    {
        for (var i = 1; i <= count; i++)
            await h.AddCardAsync(
                FlashcardStoreHarness.Card($"c{i}", deckId, $"Q{i}", "A"),
                FlashcardSchedule.NewFor($"c{i}", Now));
    }

    private static Task AddScheduledAsync(
        FlashcardStoreHarness h, string deckId, string cardId, FlashcardFsrsState state, int stepIndex) =>
        h.AddCardAsync(
            FlashcardStoreHarness.Card(cardId, deckId, cardId, "A"),
            new FlashcardSchedule(cardId, Now.AddMinutes(-1), 6d, 5d, 3, 0, state, stepIndex, Now.AddMinutes(-11)));

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, new FsrsScheduler(h.Clock), h.Clock);
}
