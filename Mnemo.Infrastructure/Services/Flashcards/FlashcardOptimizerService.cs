using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <inheritdoc />
public sealed class FlashcardOptimizerService : IFlashcardOptimizerService
{
    private readonly IFlashcardStore _store;
    private readonly IPresetRepository _presets;
    private readonly IReviewRepository _reviews;

    public FlashcardOptimizerService(IFlashcardStore store, IPresetRepository presets, IReviewRepository reviews)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(presets);
        ArgumentNullException.ThrowIfNull(reviews);
        _store = store;
        _presets = presets;
        _reviews = reviews;
    }

    public async Task<FlashcardWeightOptimization?> OptimizePresetAsync(string presetId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(presetId);

        var preset = await _store.ReadAsync((conn, ct) => _presets.GetAsync(conn, presetId, ct), cancellationToken).ConfigureAwait(false);
        if (preset is null)
            return null;

        var rows = await _store.ReadAsync(
            (conn, ct) => _reviews.ListForPresetAsync(conn, presetId, ct), cancellationToken).ConfigureAwait(false);

        var set = FsrsTrainingSetBuilder.Build(rows, FsrsWeightFitter.ScoredReviewBudget);
        var current = FsrsWeightRules.Clip(preset.Weights ?? FlashcardFsrsParameters.Default.Weights);

        if (set.ReviewsScored < FsrsWeightFitter.MinimumScoredReviews)
        {
            return new FlashcardWeightOptimization(
                FlashcardOptimizationStatus.NotEnoughReviews,
                current, current,
                set.ReviewsAvailable, set.ReviewsUsed, set.ReviewsScored,
                FsrsWeightFitter.MinimumScoredReviews,
                double.NaN, double.NaN);
        }

        var fit = await Task.Run(() => FsrsWeightFitter.Fit(set, current, cancellationToken), cancellationToken).ConfigureAwait(false);

        // The search only ever moves inside the parameter box, so a vector that fails the gate here
        // means the box and the gate have come apart rather than that the user did anything.
        if (!FsrsWeightRules.TryValidate(fit.Weights, out var error))
            throw new InvalidOperationException($"Fitted FSRS weights failed validation: {error}");

        return new FlashcardWeightOptimization(
            FlashcardOptimizationStatus.Fitted,
            current, fit.Weights,
            set.ReviewsAvailable, set.ReviewsUsed, set.ReviewsScored,
            FsrsWeightFitter.MinimumScoredReviews,
            fit.LossBefore, fit.LossAfter);
    }
}
