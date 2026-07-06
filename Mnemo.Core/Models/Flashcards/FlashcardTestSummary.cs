namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Rollup of a deck's Test history for the end-of-session score screen and widgets: latest score,
/// the previous attempt (for the "better than last time" delta), and the best score to date.
/// </summary>
public sealed record FlashcardTestSummary(
    bool HasAttempts,
    double LatestScorePct,
    double? PreviousScorePct,
    double BestScorePct,
    int AttemptCount,
    FlashcardTestAttempt? Latest)
{
    /// <summary>Empty summary for a deck that has never been tested.</summary>
    public static FlashcardTestSummary None { get; } = new(false, 0, null, 0, 0, null);

    /// <summary>Score change versus the previous attempt, or null when there is no prior attempt.</summary>
    public double? DeltaVsPrevious => PreviousScorePct is { } prev ? LatestScorePct - prev : null;
}
