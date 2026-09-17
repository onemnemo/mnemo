using System;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// A session draws its queue when it starts. A card rescheduled from the deck page while it waits
/// its turn in that queue has to be graded from what the store now says, and an undo of that
/// grade has to put the rescheduled state back, not the one the queue remembered.
/// </summary>
public sealed class FlashcardRescheduleSessionTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);
    private const string Deck = "deck-1";

    [Fact]
    public async Task A_card_started_over_while_queued_is_graded_as_a_new_card()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, reps: 5);
        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(Deck, FlashcardSessionMode.Review));
        Assert.Equal("r1", session.Current!.Card.Id);

        await Reschedule(h).ResetAsync(["r1"], keepCounts: false);
        await session.GradeAsync(FlashcardReviewGrade.Good);

        // Good on a new card walks the first learning step; on the stale review snapshot it would
        // have graduated straight to a review weeks out with six reps on the record.
        var after = await ScheduleAsync(h, "r1");
        Assert.Equal(FlashcardFsrsState.Learning, after.FsrsState);
        Assert.Equal(1, after.Reps);
        var log = await h.Store.ReadAsync((conn, ct) => h.Reviews.ListAllForDeckAsync(conn, Deck, ct));
        Assert.Equal(FlashcardFsrsState.New, Assert.Single(log).StateBefore);
    }

    [Fact]
    public async Task Undoing_that_grade_restores_the_rescheduled_card_not_the_queue_snapshot()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, reps: 5);
        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(Deck, FlashcardSessionMode.Review));

        await Reschedule(h).ResetAsync(["r1"], keepCounts: false);
        await session.GradeAsync(FlashcardReviewGrade.Good);
        Assert.True(await session.UndoAsync());

        var after = await ScheduleAsync(h, "r1");
        Assert.Equal(FlashcardFsrsState.New, after.FsrsState);
        Assert.Equal(0, after.Reps);
        Assert.Null(after.Stability);
    }

    [Fact]
    public async Task A_rewritten_spacing_is_what_the_next_grade_builds_on()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, reps: 5);
        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(Deck, FlashcardSessionMode.Review));

        // Due today with the interval matched: the spacing becomes the ten days since the last
        // review rather than the thirty the queue copy still carries, and the grade has to grow
        // the stability from that.
        await Reschedule(h).SetDueAsync(["r1"], 0, matchInterval: true);
        var rescheduled = await ScheduleAsync(h, "r1");
        var expected = new FsrsScheduler(h.Clock).ApplyGrade(rescheduled, FlashcardReviewGrade.Good, Now, FlashcardPreset.CreateStandard(Now));
        await session.GradeAsync(FlashcardReviewGrade.Good);

        var after = await ScheduleAsync(h, "r1");
        Assert.Equal(expected.Stability!.Value, after.Stability!.Value, precision: 9);
        Assert.Equal(expected.DueDate, after.DueDate);
    }

    // --- helpers ---

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, h.Facts, new FsrsScheduler(h.Clock), h.Clock);

    private static FlashcardRescheduleService Reschedule(FlashcardStoreHarness h) =>
        new(h.Store, h.Cards, h.Schedules, h.Decks, h.Presets, new FsrsScheduler(h.Clock), h.Clock);

    /// <summary>A review card due now, last answered ten days ago.</summary>
    private static Task AddReviewAsync(FlashcardStoreHarness h, string id, double stability, int reps) =>
        h.AddCardAsync(
            FlashcardStoreHarness.Card(id, Deck, "Q", "A"),
            new FlashcardSchedule(id, Now.AddHours(-1), stability, 5d, reps, 0, FlashcardFsrsState.Review, 0, Now.AddDays(-10)));

    private static Task<FlashcardSchedule> ScheduleAsync(FlashcardStoreHarness h, string id) =>
        h.Store.ReadAsync(async (conn, ct) => (await h.Schedules.GetAsync(conn, id, ct))!);
}
