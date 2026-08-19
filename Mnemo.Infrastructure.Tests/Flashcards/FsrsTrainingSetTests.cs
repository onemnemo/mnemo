using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// What the review log has to look like before a fit is allowed to learn from it.
/// </summary>
public sealed class FsrsTrainingSetTests
{
    private static readonly DateTimeOffset Start = new(2026, 1, 5, 7, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Rows_in_any_order_become_one_chronological_chain()
    {
        var rows = new[]
        {
            Row(3, "card-1", Start.AddDays(9), FlashcardReviewGrade.Good, FlashcardFsrsState.Review),
            Row(1, "card-1", Start, FlashcardReviewGrade.Good, FlashcardFsrsState.New),
            Row(2, "card-1", Start.AddDays(4), FlashcardReviewGrade.Good, FlashcardFsrsState.Review),
        };

        var set = FsrsTrainingSetBuilder.Build(rows, 0);

        var chain = Assert.Single(set.Chains);
        Assert.Equal(new[] { 0d, 4d, 5d }, chain.Reviews.Select(r => r.ElapsedDays));
    }

    /// <summary>
    /// A first answer has no interval behind it. Rows written before the log was fixed carry the
    /// card's age in that column, so the gap is taken from the timestamps and the first is zero.
    /// </summary>
    [Fact]
    public void The_first_answer_has_no_elapsed_interval()
    {
        var rows = new[]
        {
            Row(1, "card-1", Start, FlashcardReviewGrade.Good, FlashcardFsrsState.New, elapsed: 90d),
            Row(2, "card-1", Start.AddDays(3), FlashcardReviewGrade.Good, FlashcardFsrsState.Review, elapsed: 3d),
        };

        var chain = Assert.Single(FsrsTrainingSetBuilder.Build(rows, 0).Chains);

        Assert.Equal(0d, chain.Reviews[0].ElapsedDays);
        Assert.False(chain.Reviews[0].Scored);
        Assert.Equal(3d, chain.Reviews[1].ElapsedDays);
        Assert.True(chain.Reviews[1].Scored);
    }

    [Fact]
    public void A_chain_that_does_not_start_from_a_new_card_is_dropped()
    {
        var rows = new[]
        {
            Row(1, "card-1", Start, FlashcardReviewGrade.Good, FlashcardFsrsState.Review),
            Row(2, "card-1", Start.AddDays(6), FlashcardReviewGrade.Good, FlashcardFsrsState.Review),
        };

        var set = FsrsTrainingSetBuilder.Build(rows, 0);

        Assert.Empty(set.Chains);
        Assert.Equal(2, set.ReviewsAvailable);
        Assert.Equal(0, set.ReviewsUsed);
    }

    [Fact]
    public void An_answer_with_no_recorded_starting_state_cannot_open_a_chain()
    {
        var rows = new[]
        {
            Row(1, "card-1", Start, FlashcardReviewGrade.Good, before: null),
            Row(2, "card-1", Start.AddDays(6), FlashcardReviewGrade.Good, FlashcardFsrsState.Review),
        };

        Assert.Empty(FsrsTrainingSetBuilder.Build(rows, 0).Chains);
    }

    [Fact]
    public void Answers_before_the_first_new_state_are_left_behind()
    {
        var rows = new[]
        {
            Row(1, "card-1", Start, FlashcardReviewGrade.Good, before: null),
            Row(2, "card-1", Start.AddDays(2), FlashcardReviewGrade.Good, FlashcardFsrsState.New),
            Row(3, "card-1", Start.AddDays(9), FlashcardReviewGrade.Good, FlashcardFsrsState.Review),
        };

        var chain = Assert.Single(FsrsTrainingSetBuilder.Build(rows, 0).Chains);

        Assert.Equal(new[] { 0d, 7d }, chain.Reviews.Select(r => r.ElapsedDays));
    }

    [Fact]
    public void A_card_reset_back_to_new_starts_a_second_chain()
    {
        var rows = new[]
        {
            Row(1, "card-1", Start, FlashcardReviewGrade.Good, FlashcardFsrsState.New),
            Row(2, "card-1", Start.AddDays(5), FlashcardReviewGrade.Good, FlashcardFsrsState.Review),
            Row(3, "card-1", Start.AddDays(30), FlashcardReviewGrade.Good, FlashcardFsrsState.New),
            Row(4, "card-1", Start.AddDays(34), FlashcardReviewGrade.Hard, FlashcardFsrsState.Review),
        };

        var chains = FsrsTrainingSetBuilder.Build(rows, 0).Chains;

        Assert.Equal(2, chains.Count);
        Assert.All(chains, chain => Assert.Equal(0d, chain.Reviews[0].ElapsedDays));
        Assert.Equal(new[] { 0d, 5d }, chains[0].Reviews.Select(r => r.ElapsedDays));
        Assert.Equal(new[] { 0d, 4d }, chains[1].Reviews.Select(r => r.ElapsedDays));
    }

    /// <summary>
    /// A learning step comes back within the hour, where the model says recall is certain. Scoring
    /// it would hand a lapse an unbounded loss that no parameter can answer for.
    /// </summary>
    [Fact]
    public void A_same_day_answer_is_replayed_but_not_scored()
    {
        var rows = new[]
        {
            Row(1, "card-1", Start, FlashcardReviewGrade.Again, FlashcardFsrsState.New),
            Row(2, "card-1", Start.AddMinutes(10), FlashcardReviewGrade.Good, FlashcardFsrsState.Learning),
            Row(3, "card-1", Start.AddDays(2), FlashcardReviewGrade.Good, FlashcardFsrsState.Review),
        };

        var set = FsrsTrainingSetBuilder.Build(rows, 0);

        var chain = Assert.Single(set.Chains);
        Assert.Equal(new[] { false, false, true }, chain.Reviews.Select(r => r.Scored));
        Assert.Equal(3, set.ReviewsUsed);
        Assert.Equal(1, set.ReviewsScored);
    }

    [Fact]
    public void A_card_with_nothing_to_score_is_left_out()
    {
        var rows = new[]
        {
            Row(1, "card-1", Start, FlashcardReviewGrade.Again, FlashcardFsrsState.New),
            Row(2, "card-1", Start.AddMinutes(10), FlashcardReviewGrade.Good, FlashcardFsrsState.Learning),
        };

        Assert.Empty(FsrsTrainingSetBuilder.Build(rows, 0).Chains);
    }

    [Fact]
    public void The_budget_keeps_the_chains_answered_most_recently()
    {
        var rows = new List<FlashcardReviewRow>();
        for (var card = 0; card < 3; card++)
        {
            var origin = Start.AddDays(card * 100);
            rows.Add(Row(card * 10 + 1, $"card-{card}", origin, FlashcardReviewGrade.Good, FlashcardFsrsState.New));
            rows.Add(Row(card * 10 + 2, $"card-{card}", origin.AddDays(3), FlashcardReviewGrade.Good, FlashcardFsrsState.Review));
        }

        var set = FsrsTrainingSetBuilder.Build(rows, scoredReviewBudget: 1);

        var chain = Assert.Single(set.Chains);
        Assert.Equal("card-2", chain.CardId);
        Assert.Equal(6, set.ReviewsAvailable);
        Assert.Equal(2, set.ReviewsUsed);
    }

    [Fact]
    public async Task Only_scheduled_review_sessions_reach_the_training_data()
    {
        await using var h = new FlashcardStoreHarness(Start);
        var deckId = await h.SeedDeckAsync();
        await AddCardAsync(h, deckId, "card-1");
        await AddCardAsync(h, deckId, "card-2");

        var cram = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Cram, FlashcardSessionScope.All));
        while (!cram.IsFinished)
            await cram.GradeAsync(FlashcardReviewGrade.Good);

        Assert.Empty(await ReadRowsAsync(h));

        var review = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await review.GradeAsync(FlashcardReviewGrade.Good);

        var row = Assert.Single(await ReadRowsAsync(h));
        Assert.Equal(FlashcardFsrsState.New, row.StateBefore);
    }

    [Fact]
    public async Task A_typed_practice_session_never_starts_the_scheduled_flow()
    {
        await using var h = new FlashcardStoreHarness(Start);
        var deckId = await h.SeedDeckAsync();

        await Assert.ThrowsAsync<ArgumentException>(
            () => Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Test)));
    }

    [Fact]
    public async Task An_undone_answer_is_gone_from_the_training_data()
    {
        await using var h = new FlashcardStoreHarness(Start);
        var deckId = await h.SeedDeckAsync();
        await AddCardAsync(h, deckId, "card-1");

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Good);
        Assert.Single(await ReadRowsAsync(h));

        Assert.True(await session.UndoAsync());

        Assert.Empty(await ReadRowsAsync(h));
    }

    [Fact]
    public async Task Reviews_answered_under_another_preset_are_left_out()
    {
        await using var h = new FlashcardStoreHarness(Start);
        var mine = await h.SeedDeckAsync("deck-1");
        var theirs = await h.SeedDeckAsync("deck-2", "preset-other");

        await AppendAsync(h, mine, "card-1", Start);
        await AppendAsync(h, theirs, "card-2", Start);

        var rows = await ReadRowsAsync(h);

        Assert.Equal("card-1", Assert.Single(rows).CardId);
    }

    private static FlashcardReviewRow Row(
        long id, string cardId, DateTimeOffset at, FlashcardReviewGrade grade,
        FlashcardFsrsState? before, double elapsed = 0d) =>
        new(id, cardId, grade, at, elapsed, before, FlashcardFsrsState.Review);

    private static Task<IReadOnlyList<FlashcardReviewRow>> ReadRowsAsync(FlashcardStoreHarness h) =>
        h.Store.ReadAsync((conn, ct) => h.Reviews.ListForPresetAsync(conn, FlashcardPreset.StandardPresetId, ct));

    private static Task AppendAsync(FlashcardStoreHarness h, string deckId, string cardId, DateTimeOffset at) =>
        h.Store.WriteAsync(async (conn, tx, ct) => await h.Reviews.AppendAsync(conn, tx, new FlashcardReviewLog(
            FlashcardReviewLog.Unassigned, cardId, deckId, "session", FlashcardReviewGrade.Good, at,
            0d, 0d, 1d, 5d, FlashcardFsrsState.New, FlashcardFsrsState.Review), ct));

    private static Task AddCardAsync(FlashcardStoreHarness h, string deckId, string cardId) =>
        h.AddCardAsync(
            FlashcardStoreHarness.Card(cardId, deckId, "front", "back"),
            FlashcardSchedule.NewFor(cardId, Start));

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, h.Facts, new FsrsScheduler(h.Clock), h.Clock);
}
