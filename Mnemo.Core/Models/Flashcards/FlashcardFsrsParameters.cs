namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// User-facing and model parameters used by the FSRS scheduler.
/// </summary>
public sealed record FlashcardFsrsParameters(
    double DesiredRetention,
    double[] Weights)
{
    /// <summary>
    /// The published FSRS-6 defaults, as retrained in June 2025. All twenty-one slots are live under
    /// FSRS-6: w19 damps the same-day stability bump as stability grows, and w20 is the forgetting
    /// curve's decay exponent, which FSRS-6 fits per collection instead of pinning it at FSRS-5's
    /// -0.5. Replacing these wholesale changes scheduling for every card that has not stored its own.
    /// </summary>
    public static FlashcardFsrsParameters Default { get; } = new(
        0.9d,
        new[]
        {
            0.2120, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194,
            0.0010, 1.8722, 0.1666, 0.7960, 1.4835, 0.0614, 0.2629,
            1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
        });
}
