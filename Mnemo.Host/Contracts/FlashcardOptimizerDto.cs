using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// A fitted FSRS weight vector and what it scored, offered to the client rather than stored.
/// Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
/// <remarks>
/// The two losses are null when there was too little history to measure anything. They are mean
/// log loss over the reviews the fit scored, so lower is better and the pair is only comparable
/// within one response.
/// </remarks>
public sealed record OptimizeWeightsDto(
    string Status,
    IReadOnlyList<double> CurrentWeights,
    IReadOnlyList<double> Weights,
    int ReviewsAvailable,
    int ReviewsUsed,
    int ReviewsScored,
    int MinimumReviews,
    double? LossBefore,
    double? LossAfter)
{
    /// <summary>A vector was fitted.</summary>
    public const string FittedStatus = "fitted";

    /// <summary>Too few reviews to fit anything worth offering.</summary>
    public const string NotEnoughReviewsStatus = "not-enough-reviews";

    public static OptimizeWeightsDto FromModel(FlashcardWeightOptimization model)
        => new(
            model.Status == FlashcardOptimizationStatus.Fitted ? FittedStatus : NotEnoughReviewsStatus,
            model.CurrentWeights,
            model.Weights,
            model.ReviewsAvailable,
            model.ReviewsUsed,
            model.ReviewsScored,
            model.MinimumReviews,
            Score(model.LossBefore),
            Score(model.LossAfter));

    // JSON has no NaN, and the serializer refuses to write one rather than inventing a spelling.
    private static double? Score(double value) => double.IsFinite(value) ? value : null;
}

/// <summary>
/// Replaces a preset's FSRS weights. A null vector puts the preset back on the published defaults.
/// </summary>
/// <remarks>
/// Separate from <see cref="SavePresetDto"/> on purpose. The settings dialog saves the whole preset
/// on every edit, and weights are not something a form should be able to send by accident.
/// </remarks>
public sealed record SaveWeightsDto(IReadOnlyList<double>? Weights);
