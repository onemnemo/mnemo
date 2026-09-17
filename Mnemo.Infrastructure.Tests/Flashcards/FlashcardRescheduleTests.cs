using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Moving cards in time without grading them. Each mode is checked against a selection that
/// mixes new, learning, review and suspended cards, because the point of the dialog behind
/// this is saying exactly which of those it will and will not touch.
/// </summary>
public sealed class FlashcardRescheduleTests
{
    /// <summary>Half past nine in the morning, UTC, so the study day (which starts at four) is unambiguous.</summary>
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset LastReview = Now.AddDays(-10);

    private const string Deck = "deck-1";

    // --- due date ---

    [Fact]
    public async Task A_review_card_moves_to_the_start_of_the_asked_study_day_and_keeps_its_memory()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));

        await Service(h).SetDueAsync(["r1"], 3, matchInterval: false);

        var after = await ScheduleAsync(h, "r1");
        Assert.Equal(new DateTimeOffset(2026, 3, 8, 4, 0, 0, TimeSpan.Zero), after.DueDate);
        Assert.Equal(FlashcardFsrsState.Review, after.FsrsState);
        Assert.Equal(30d, after.Stability);
        Assert.Equal(6d, after.Difficulty);
        Assert.Equal(5, after.Reps);
        Assert.Equal(1, after.Lapses);
        Assert.Equal(LastReview, after.LastReviewedAt);
    }

    [Fact]
    public async Task Today_means_the_card_is_due_now()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));

        await Service(h).SetDueAsync(["r1"], 0, matchInterval: false);

        var after = await ScheduleAsync(h, "r1");
        Assert.Equal(new DateTimeOffset(2026, 3, 5, 4, 0, 0, TimeSpan.Zero), after.DueDate);
        Assert.True(after.DueDate <= Now);
    }

    [Fact]
    public async Task A_learning_card_graduates_to_review_on_that_day_with_its_memory_intact()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await h.AddCardAsync(
            FlashcardStoreHarness.Card("l1", Deck, "Q", "A"),
            new FlashcardSchedule("l1", Now.AddMinutes(5), 2.5d, 5.5d, 1, 0, FlashcardFsrsState.Learning, 1, Now.AddMinutes(-5)));

        await Service(h).SetDueAsync(["l1"], 1, matchInterval: false);

        var after = await ScheduleAsync(h, "l1");
        Assert.Equal(FlashcardFsrsState.Review, after.FsrsState);
        Assert.Equal(0, after.LearningStepIndex);
        Assert.Equal(2.5d, after.Stability);
        Assert.Equal(5.5d, after.Difficulty);
        Assert.Equal(new DateTimeOffset(2026, 3, 6, 4, 0, 0, TimeSpan.Zero), after.DueDate);
    }

    [Fact]
    public async Task A_new_card_leaves_the_new_queue_as_a_review_card_with_no_memory_yet()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewAsync(h, "n1", Now);

        await Service(h).SetDueAsync(["n1"], 2, matchInterval: false);

        var after = await ScheduleAsync(h, "n1");
        Assert.Equal(FlashcardFsrsState.Review, after.FsrsState);
        Assert.Null(after.Stability);
        Assert.Null(after.Difficulty);
        Assert.Null(after.LastReviewedAt);
        Assert.Equal(0, after.Reps);
        Assert.Equal(new DateTimeOffset(2026, 3, 7, 4, 0, 0, TimeSpan.Zero), after.DueDate);
        Assert.Equal(0, await Service(h).CountNewQueueAsync(Deck));
    }

    [Fact]
    public async Task Matching_the_interval_rewrites_stability_from_the_last_review_to_the_new_date()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));

        await Service(h).SetDueAsync(["r1"], 3, matchInterval: true);

        // Reviewed ten days before Now, due three days out at four in the morning: the spacing the
        // card is told it earned is that whole span, and at the standard 0.9 retention the
        // stability is the spacing itself.
        var after = await ScheduleAsync(h, "r1");
        var expected = (after.DueDate - LastReview).TotalDays;
        Assert.Equal(expected, after.Stability!.Value, precision: 9);
        Assert.Equal(6d, after.Difficulty);
        Assert.Equal(LastReview, after.LastReviewedAt);
    }

    [Fact]
    public async Task Matching_the_interval_on_a_card_never_reviewed_counts_from_now()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewAsync(h, "n1", Now);

        await Service(h).SetDueAsync(["n1"], 5, matchInterval: true);

        var after = await ScheduleAsync(h, "n1");
        Assert.Equal((after.DueDate - Now).TotalDays, after.Stability!.Value, precision: 9);
        Assert.Null(after.Difficulty);
    }

    [Fact]
    public async Task Matching_the_interval_never_writes_a_spacing_under_a_day()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await h.AddCardAsync(
            FlashcardStoreHarness.Card("r1", Deck, "Q", "A"),
            new FlashcardSchedule("r1", Now.AddDays(3), 8d, 5d, 2, 0, FlashcardFsrsState.Review, 0, Now.AddHours(-1)));

        await Service(h).SetDueAsync(["r1"], 0, matchInterval: true);

        Assert.Equal(1d, (await ScheduleAsync(h, "r1")).Stability!.Value, precision: 9);
    }

    [Fact]
    public async Task A_mixed_selection_moves_everything_but_the_suspended_card()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewAsync(h, "n1", Now);
        await h.AddCardAsync(
            FlashcardStoreHarness.Card("l1", Deck, "Q", "A"),
            new FlashcardSchedule("l1", Now.AddMinutes(5), 2.5d, 5.5d, 1, 0, FlashcardFsrsState.Learning, 1, Now.AddMinutes(-5)));
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));
        var suspended = new FlashcardSchedule("s1", Now.AddDays(40), 12d, 7d, 4, 2, FlashcardFsrsState.Review, 0, LastReview);
        await h.AddCardAsync(FlashcardStoreHarness.Card("s1", Deck, "Q", "A", FlashcardCardState.Suspended), suspended);

        await Service(h).SetDueAsync(["n1", "l1", "r1", "s1", "missing"], 1, matchInterval: false);

        var day = new DateTimeOffset(2026, 3, 6, 4, 0, 0, TimeSpan.Zero);
        foreach (var id in new[] { "n1", "l1", "r1" })
        {
            var after = await ScheduleAsync(h, id);
            Assert.Equal(FlashcardFsrsState.Review, after.FsrsState);
            Assert.Equal(day, after.DueDate);
        }
        Assert.Equal(suspended, await ScheduleAsync(h, "s1"));
        Assert.Equal(FlashcardCardState.Suspended, (await CardAsync(h, "s1")).State);
    }

    [Fact]
    public async Task A_due_date_lifts_a_hold_and_a_start_over_keeps_it()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));
        await AddReviewAsync(h, "r2", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));
        var held = Now.AddHours(18);
        await h.Store.WriteAsync((conn, tx, ct) => h.Schedules.SetBuriedAsync(conn, tx, ["r1", "r2"], held, ct));

        await Service(h).SetDueAsync(["r1"], 0, matchInterval: false);
        await Service(h).ResetAsync(["r2"], keepCounts: true);

        // The reader asked for r1 today by name; r2 went back to new and its hold stands.
        Assert.Null((await ScheduleAsync(h, "r1")).BuriedUntil);
        Assert.Equal(held, (await ScheduleAsync(h, "r2")).BuriedUntil);
    }

    [Fact]
    public async Task A_card_the_trash_holds_is_left_alone()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));
        var before = await ScheduleAsync(h, "r1");
        await h.Trash.DeleteAsync([new TrashDeleteRequest("card", "r1")]);

        await Service(h).SetDueAsync(["r1"], 1, matchInterval: false);

        Assert.Equal(before, await ScheduleAsync(h, "r1"));
    }

    [Fact]
    public async Task The_due_date_follows_the_deck_presets_day_start()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck, presetId: "late");
        await h.Store.WriteAsync((conn, tx, ct) => h.Presets.UpsertAsync(
            conn, tx, FlashcardPreset.CreateStandard(Now) with { Id = "late", NextDayStartsAtHour = 8 }, ct));
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));

        await Service(h).SetDueAsync(["r1"], 1, matchInterval: false);

        Assert.Equal(new DateTimeOffset(2026, 3, 6, 8, 0, 0, TimeSpan.Zero), (await ScheduleAsync(h, "r1")).DueDate);
    }

    // --- start over ---

    [Fact]
    public async Task Starting_over_returns_the_card_to_new_and_keeps_its_counts()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));

        await Service(h).ResetAsync(["r1"], keepCounts: true);

        var after = await ScheduleAsync(h, "r1");
        Assert.Equal(FlashcardFsrsState.New, after.FsrsState);
        Assert.Null(after.Stability);
        Assert.Null(after.Difficulty);
        Assert.Equal(0, after.LearningStepIndex);
        Assert.Equal(Now, after.DueDate);
        Assert.Equal(5, after.Reps);
        Assert.Equal(1, after.Lapses);
        Assert.Equal(LastReview, after.LastReviewedAt);
    }

    [Fact]
    public async Task Starting_over_without_the_counts_clears_them_and_keeps_the_review_log()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));
        await h.Store.WriteAsync((conn, tx, ct) => h.Reviews.AppendAsync(conn, tx, new FlashcardReviewLog(
            FlashcardReviewLog.Unassigned, "r1", Deck, "session", FlashcardReviewGrade.Good,
            LastReview, 8d, 8d, 30d, 6d, FlashcardFsrsState.Review, FlashcardFsrsState.Review), ct));

        await Service(h).ResetAsync(["r1"], keepCounts: false);

        var after = await ScheduleAsync(h, "r1");
        Assert.Equal(FlashcardFsrsState.New, after.FsrsState);
        Assert.Equal(0, after.Reps);
        Assert.Equal(0, after.Lapses);
        Assert.Null(after.LastReviewedAt);
        Assert.Equal(1, await h.Store.ReadAsync((conn, ct) => h.Reviews.CountForDeckAsync(conn, Deck, ct)));
    }

    [Fact]
    public async Task Starting_over_skips_new_and_suspended_cards_and_puts_the_rest_at_the_back_of_the_queue()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewAsync(h, "n1", Now.AddDays(-2));
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));
        var suspended = new FlashcardSchedule("s1", Now.AddDays(40), 12d, 7d, 4, 2, FlashcardFsrsState.Review, 0, LastReview);
        await h.AddCardAsync(FlashcardStoreHarness.Card("s1", Deck, "Q", "A", FlashcardCardState.Suspended), suspended);
        var freshBefore = await ScheduleAsync(h, "n1");

        await Service(h).ResetAsync(["n1", "r1", "s1"], keepCounts: true);

        Assert.Equal(freshBefore, await ScheduleAsync(h, "n1"));
        Assert.Equal(suspended, await ScheduleAsync(h, "s1"));
        Assert.Equal(new[] { "n1", "r1" }, await NewQueueAsync(h));
    }

    // --- queue position ---

    [Fact]
    public async Task First_puts_the_cards_ahead_of_every_other_new_card_in_their_own_order()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewQueueAsync(h, "a", "b", "c", "d");

        await Service(h).RepositionAsync(["d", "c"], FlashcardQueuePlacement.Start, 1);

        Assert.Equal(new[] { "c", "d", "a", "b" }, await NewQueueAsync(h));
    }

    [Fact]
    public async Task Last_puts_the_cards_behind_every_other_new_card()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewQueueAsync(h, "a", "b", "c", "d");

        await Service(h).RepositionAsync(["a"], FlashcardQueuePlacement.End, 1);

        Assert.Equal(new[] { "b", "c", "d", "a" }, await NewQueueAsync(h));
    }

    [Theory]
    [InlineData(1, new[] { "d", "a", "b", "c" })]
    [InlineData(2, new[] { "a", "d", "b", "c" })]
    [InlineData(3, new[] { "a", "b", "d", "c" })]
    [InlineData(4, new[] { "a", "b", "c", "d" })]
    [InlineData(99, new[] { "a", "b", "c", "d" })]
    public async Task At_counts_from_the_front_and_clamps_past_the_end(int position, string[] expected)
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewQueueAsync(h, "a", "b", "c", "d");

        await Service(h).RepositionAsync(["d"], FlashcardQueuePlacement.At, position);

        Assert.Equal(expected, await NewQueueAsync(h));
    }

    [Fact]
    public async Task Cards_created_in_one_go_can_still_be_placed_between_each_other()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        // One instant for all four, the way a bulk add or an import writes them, so only the id
        // decides the order before the reposition.
        foreach (var id in new[] { "a", "b", "c", "d" })
            await AddNewAsync(h, id, Now.AddDays(-1));
        Assert.Equal(new[] { "a", "b", "c", "d" }, await NewQueueAsync(h));

        await Service(h).RepositionAsync(["d"], FlashcardQueuePlacement.At, 2);

        Assert.Equal(new[] { "a", "d", "b", "c" }, await NewQueueAsync(h));
    }

    [Fact]
    public async Task Repositioning_leaves_scheduled_and_suspended_cards_alone_and_keeps_every_due_date_in_the_past()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewQueueAsync(h, "a", "b", "c");
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));
        var suspended = FlashcardSchedule.NewFor("s1", Now.AddDays(-5));
        await h.AddCardAsync(FlashcardStoreHarness.Card("s1", Deck, "Q", "A", FlashcardCardState.Suspended), suspended);
        var review = await ScheduleAsync(h, "r1");

        await Service(h).RepositionAsync(["c", "r1", "s1"], FlashcardQueuePlacement.Start, 1);

        Assert.Equal(new[] { "c", "a", "b" }, await NewQueueAsync(h));
        Assert.Equal(review, await ScheduleAsync(h, "r1"));
        Assert.Equal(suspended, await ScheduleAsync(h, "s1"));
        foreach (var id in new[] { "a", "b", "c" })
            Assert.True((await ScheduleAsync(h, id)).DueDate <= Now);
    }

    [Fact]
    public async Task Cards_from_two_decks_are_each_placed_in_their_own_queue()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await h.SeedDeckAsync("deck-2");
        await AddNewQueueAsync(h, "a", "b", "c");
        await AddNewAsync(h, "x", Now.AddMinutes(-30), "deck-2");
        await AddNewAsync(h, "y", Now.AddMinutes(-20), "deck-2");

        await Service(h).RepositionAsync(["c", "y"], FlashcardQueuePlacement.Start, 1);

        Assert.Equal(new[] { "c", "a", "b" }, await NewQueueAsync(h));
        Assert.Equal(new[] { "y", "x" }, await NewQueueAsync(h, "deck-2"));
    }

    [Fact]
    public async Task The_study_queue_draws_new_cards_in_the_repositioned_order()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewQueueAsync(h, "a", "b", "c");

        await Service(h).RepositionAsync(["b"], FlashcardQueuePlacement.Start, 1);

        var band = await h.Store.ReadAsync((conn, ct) =>
            h.Cards.GetActiveViewsAsync(conn, Deck, new[] { 0 }, null, int.MaxValue, Now, ct));
        Assert.Equal(new[] { "b", "a", "c" }, band.Select(view => view.Card.Id));
    }

    [Fact]
    public async Task The_queue_count_is_the_active_new_cards_only()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync(Deck);
        await AddNewQueueAsync(h, "a", "b");
        await AddReviewAsync(h, "r1", stability: 30d, difficulty: 6d, reps: 5, lapses: 1, due: Now.AddDays(20));
        await h.AddCardAsync(
            FlashcardStoreHarness.Card("s1", Deck, "Q", "A", FlashcardCardState.Suspended),
            FlashcardSchedule.NewFor("s1", Now));

        Assert.Equal(2, await Service(h).CountNewQueueAsync(Deck));
        Assert.Equal(0, await Service(h).CountNewQueueAsync("no-such-deck"));
    }

    [Fact]
    public void Renumbering_only_returns_the_entries_whose_date_moves()
    {
        var first = Now.AddDays(-1);
        var queue = new[]
        {
            new FlashcardQueueEntry("a", first),
            new FlashcardQueueEntry("b", first.AddTicks(1)),
            new FlashcardQueueEntry("c", first.AddTicks(2)),
        };
        var reordered = FlashcardRescheduleService.Reorder(queue, new HashSet<string> { "c" }, FlashcardQueuePlacement.At, 2);

        var changed = FlashcardRescheduleService.Renumber(queue, reordered);

        Assert.Equal(
            new[] { new FlashcardQueueEntry("c", first.AddTicks(1)), new FlashcardQueueEntry("b", first.AddTicks(2)) },
            changed);
    }

    // --- helpers ---

    private static FlashcardRescheduleService Service(FlashcardStoreHarness h) =>
        new(h.Store, h.Cards, h.Schedules, h.Decks, h.Presets, new FsrsScheduler(h.Clock), h.Clock);

    private static Task AddNewAsync(FlashcardStoreHarness h, string id, DateTimeOffset createdAt, string deckId = Deck) =>
        h.AddCardAsync(FlashcardStoreHarness.Card(id, deckId, "Q", "A"), FlashcardSchedule.NewFor(id, createdAt));

    /// <summary>New cards a minute apart, so the queue order is the argument order.</summary>
    private static async Task AddNewQueueAsync(FlashcardStoreHarness h, params string[] ids)
    {
        for (var i = 0; i < ids.Length; i++)
            await AddNewAsync(h, ids[i], Now.AddMinutes(-60 + i));
    }

    private static Task AddReviewAsync(FlashcardStoreHarness h, string id, double stability, double difficulty, int reps, int lapses, DateTimeOffset due) =>
        h.AddCardAsync(
            FlashcardStoreHarness.Card(id, Deck, "Q", "A"),
            new FlashcardSchedule(id, due, stability, difficulty, reps, lapses, FlashcardFsrsState.Review, 0, LastReview));

    private static Task<FlashcardSchedule> ScheduleAsync(FlashcardStoreHarness h, string id) =>
        h.Store.ReadAsync(async (conn, ct) => (await h.Schedules.GetAsync(conn, id, ct))!);

    private static Task<Flashcard> CardAsync(FlashcardStoreHarness h, string id) =>
        h.Store.ReadAsync(async (conn, ct) => (await h.Cards.GetAsync(conn, id, ct))!);

    private static async Task<string[]> NewQueueAsync(FlashcardStoreHarness h, string deckId = Deck)
    {
        var queue = await h.Store.ReadAsync((conn, ct) => h.Schedules.ListNewQueueAsync(conn, deckId, ct));
        return queue.Select(entry => entry.CardId).ToArray();
    }
}
