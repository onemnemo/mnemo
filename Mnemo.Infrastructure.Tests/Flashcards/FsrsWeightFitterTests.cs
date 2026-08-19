using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Fitting weights to a history: that it reproduces the scheduler, that it repeats itself, and
/// that it cannot hand back a vector the scheduler is not safe to run.
/// </summary>
public sealed class FsrsWeightFitterTests
{
    private static readonly DateTimeOffset Start = new(2026, 2, 1, 6, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// The trainer keeps its own copy of the memory equations so it can reach retrievability and
    /// run without building a schedule per answer. This is what stops the two drifting apart.
    /// </summary>
    [Fact]
    public void The_forward_model_tracks_the_scheduler_answer_for_answer()
    {
        var weights = TrueWeights();
        var preset = FlashcardPreset.CreateStandard(Start) with
        {
            Weights = weights,
            LearningSteps = Array.Empty<int>(),
            RelearnSteps = Array.Empty<int>()
        };
        var scheduler = new FsrsScheduler(new FlashcardClock(new TestTimeProvider(Start)));

        var grades = new[]
        {
            FlashcardReviewGrade.Good, FlashcardReviewGrade.Good, FlashcardReviewGrade.Again,
            FlashcardReviewGrade.Hard, FlashcardReviewGrade.Good, FlashcardReviewGrade.Easy,
            FlashcardReviewGrade.Good, FlashcardReviewGrade.Again, FlashcardReviewGrade.Good
        };
        var gaps = new[] { 0d, 3d, 12d, 0.02d, 1d, 20d, 45d, 7d, 2d };

        var schedule = FlashcardSchedule.NewFor("card-1", Start);
        var at = Start;
        var state = default(FsrsForwardModel.MemoryState);

        for (var i = 0; i < grades.Length; i++)
        {
            at = at.AddDays(gaps[i]);
            schedule = scheduler.ApplyGrade(schedule, grades[i], at, preset);
            state = i == 0
                ? FsrsForwardModel.First(grades[i], weights)
                : FsrsForwardModel.Next(state, gaps[i], grades[i], weights);

            Assert.Equal(schedule.Stability!.Value, state.Stability);
            Assert.Equal(schedule.Difficulty!.Value, state.Difficulty);
        }
    }

    [Fact]
    public void The_same_history_and_the_same_start_fit_the_same_vector()
    {
        var set = Synthesize(cards: 40, reviewsPerCard: 8);

        var first = FsrsWeightFitter.Fit(set, FsrsWeightRules.Defaults(), CancellationToken.None);
        var second = FsrsWeightFitter.Fit(set, FsrsWeightRules.Defaults(), CancellationToken.None);

        Assert.Equal(first.Weights, second.Weights);
        Assert.Equal(first.LossAfter, second.LossAfter);
        Assert.Equal(first.Evaluations, second.Evaluations);
    }

    [Fact]
    public void A_fit_learns_a_history_written_by_other_weights()
    {
        var set = Synthesize(cards: 120, reviewsPerCard: 12);

        var result = FsrsWeightFitter.Fit(set, FsrsWeightRules.Defaults(), CancellationToken.None);

        Assert.True(result.LossAfter < result.LossBefore);
        Assert.True(FsrsWeightRules.TryValidate(result.Weights, out _));
    }

    [Fact]
    public void A_fit_never_hands_back_something_worse_than_what_is_running()
    {
        var set = Synthesize(cards: 20, reviewsPerCard: 6);
        var running = FsrsWeightRules.Clip(TrueWeights());

        var result = FsrsWeightFitter.Fit(set, running, CancellationToken.None);

        Assert.True(result.LossAfter <= result.LossBefore);
    }

    [Fact]
    public void A_fit_from_an_unusable_start_still_lands_inside_the_parameter_box()
    {
        var set = Synthesize(cards: 20, reviewsPerCard: 6);
        var wild = FsrsWeightRules.Defaults();
        wild[0] = double.NaN;
        wild[4] = 900d;
        wild[20] = -5d;

        var result = FsrsWeightFitter.Fit(set, wild, CancellationToken.None);

        Assert.True(FsrsWeightRules.TryValidate(result.Weights, out _));
        Assert.True(double.IsFinite(result.LossAfter));
    }

    [Fact]
    public void A_cancelled_fit_stops()
    {
        var set = Synthesize(cards: 40, reviewsPerCard: 8);
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        Assert.Throws<OperationCanceledException>(() => FsrsWeightFitter.Fit(set, FsrsWeightRules.Defaults(), cancelled.Token));
    }

    [Fact]
    public async Task A_preset_with_barely_any_history_is_told_so_rather_than_fitted()
    {
        await using var h = new FlashcardStoreHarness(Start);
        var deckId = await h.SeedDeckAsync();
        await SeedHistoryAsync(h, deckId, cards: 3, reviewsPerCard: 5);

        var result = await Optimizer(h).OptimizePresetAsync(FlashcardPreset.StandardPresetId);

        Assert.NotNull(result);
        Assert.Equal(FlashcardOptimizationStatus.NotEnoughReviews, result!.Status);
        Assert.Equal(FsrsWeightFitter.MinimumScoredReviews, result.MinimumReviews);
        Assert.True(result.ReviewsScored < result.MinimumReviews);
        Assert.True(double.IsNaN(result.LossBefore));
    }

    [Fact]
    public async Task A_preset_with_a_real_history_gets_a_vector_it_can_be_given()
    {
        await using var h = new FlashcardStoreHarness(Start);
        var deckId = await h.SeedDeckAsync();
        await SeedHistoryAsync(h, deckId, cards: 120, reviewsPerCard: 12);

        var result = await Optimizer(h).OptimizePresetAsync(FlashcardPreset.StandardPresetId);

        Assert.NotNull(result);
        Assert.Equal(FlashcardOptimizationStatus.Fitted, result!.Status);
        Assert.True(result.ReviewsScored >= result.MinimumReviews);
        Assert.True(result.LossAfter < result.LossBefore);
        Assert.Equal(FlashcardFsrsParameters.Default.Weights, result.CurrentWeights);
        Assert.True(FsrsWeightRules.TryValidate(result.Weights, out _));

        var presets = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var stored = await presets.GetPresetAsync(FlashcardPreset.StandardPresetId);
        Assert.Null(stored!.Weights);
    }

    [Fact]
    public async Task An_unknown_preset_has_nothing_to_fit()
    {
        await using var h = new FlashcardStoreHarness(Start);
        await h.SeedDeckAsync();

        Assert.Null(await Optimizer(h).OptimizePresetAsync("preset-missing"));
    }

    private static FlashcardOptimizerService Optimizer(FlashcardStoreHarness h) =>
        new(h.Store, h.Presets, h.Reviews);

    /// <summary>
    /// A history written by <see cref="TrueWeights"/>, so a fit starting from the published
    /// defaults has something real to find. Grades come from a fixed generator rather than a random
    /// one, so every run reads the same collection.
    /// </summary>
    private static IReadOnlyList<FlashcardReviewRow> SynthesizeRows(int cards, int reviewsPerCard)
    {
        var weights = TrueWeights();
        var rows = new List<FlashcardReviewRow>(cards * reviewsPerCard);
        var seed = 20260201u;
        long id = 0;

        for (var card = 0; card < cards; card++)
        {
            var cardId = $"card-{card:D4}";
            var at = Start.AddHours(card);
            var state = FsrsForwardModel.First(FlashcardReviewGrade.Good, weights);
            rows.Add(new FlashcardReviewRow(++id, cardId, FlashcardReviewGrade.Good, at, 0d,
                FlashcardFsrsState.New, FlashcardFsrsState.Review));

            for (var step = 1; step < reviewsPerCard; step++)
            {
                var days = Math.Max(1d, Math.Round(state.Stability));
                at = at.AddDays(days);
                var recalled = FsrsForwardModel.Retrievability(days, state.Stability, weights);
                var grade = NextUnit(ref seed) < recalled ? FlashcardReviewGrade.Good : FlashcardReviewGrade.Again;
                rows.Add(new FlashcardReviewRow(++id, cardId, grade, at, days,
                    FlashcardFsrsState.Review, FlashcardFsrsState.Review));
                state = FsrsForwardModel.Next(state, days, grade, weights);
            }
        }

        return rows;
    }

    private static FsrsTrainingSet Synthesize(int cards, int reviewsPerCard) =>
        FsrsTrainingSetBuilder.Build(SynthesizeRows(cards, reviewsPerCard), FsrsWeightFitter.ScoredReviewBudget);

    private static Task SeedHistoryAsync(FlashcardStoreHarness h, string deckId, int cards, int reviewsPerCard) =>
        h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            foreach (var row in SynthesizeRows(cards, reviewsPerCard))
            {
                await h.Reviews.AppendAsync(conn, tx, new FlashcardReviewLog(
                    FlashcardReviewLog.Unassigned, row.CardId, deckId, "session", row.Grade, row.ReviewedAt,
                    row.ElapsedDays, row.ElapsedDays, 1d, 5d, row.StateBefore, row.StateAfter), ct);
            }
        });

    /// <summary>The defaults, moved far enough that a fit starting from them has work to do.</summary>
    private static double[] TrueWeights()
    {
        var weights = FsrsWeightRules.Defaults();
        weights[1] = 2.6d;
        weights[8] = 2.4d;
        weights[9] = 0.35d;
        weights[10] = 1.4d;
        weights[20] = 0.35d;
        return FsrsWeightRules.Clip(weights);
    }

    private static double NextUnit(ref uint seed)
    {
        seed = (seed * 1664525u) + 1013904223u;
        return seed / 4294967296d;
    }
}
