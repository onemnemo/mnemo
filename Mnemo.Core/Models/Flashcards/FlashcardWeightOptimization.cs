namespace Mnemo.Core.Models.Flashcards;

/// <summary>How a request to fit FSRS weights ended.</summary>
public enum FlashcardOptimizationStatus
{
    /// <summary>A vector was fitted. It may still be the one already in use, if nothing beat it.</summary>
    Fitted = 0,

    /// <summary>The preset's decks have not been reviewed enough for a fit to mean anything.</summary>
    NotEnoughReviews = 1
}

/// <summary>
/// The result of fitting FSRS weights to a preset's own review history. Nothing here is stored:
/// the caller decides whether to keep the fitted vector.
/// </summary>
/// <param name="Status">Whether a vector was fitted at all.</param>
/// <param name="CurrentWeights">The vector scheduling runs on today, so it can be restored.</param>
/// <param name="Weights">The fitted vector, or the current one when nothing scored better.</param>
/// <param name="ReviewsAvailable">Reviews found for the preset's decks.</param>
/// <param name="ReviewsUsed">Reviews the fit replayed, including same-day answers it did not score.</param>
/// <param name="ReviewsScored">Reviews the fit measured itself against.</param>
/// <param name="MinimumReviews">Scored reviews needed before a fit is offered.</param>
/// <param name="LossBefore">Prediction error of the current vector on this history. Lower is better.</param>
/// <param name="LossAfter">Prediction error of the fitted vector on the same history.</param>
public sealed record FlashcardWeightOptimization(
    FlashcardOptimizationStatus Status,
    IReadOnlyList<double> CurrentWeights,
    IReadOnlyList<double> Weights,
    int ReviewsAvailable,
    int ReviewsUsed,
    int ReviewsScored,
    int MinimumReviews,
    double LossBefore,
    double LossAfter);
