namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Scheduling an import carries in from another app, before the card it belongs to has an id.
/// </summary>
/// <param name="DueDate">When the card next comes up, kept rather than reset to now.</param>
/// <param name="Stability">Imported or derived FSRS stability, or null when the source knows none.</param>
/// <param name="Difficulty">Imported or derived FSRS difficulty, or null when the source knows none.</param>
/// <param name="LastReviewedAt">
/// When it was last answered, so the first review measures the right elapsed time.
/// </param>
public sealed record FlashcardImportedSchedule(
    DateTimeOffset DueDate,
    double? Stability,
    double? Difficulty,
    int Reps,
    int Lapses,
    FlashcardFsrsState FsrsState,
    DateTimeOffset? LastReviewedAt)
{
    /// <summary>The schedule as a card in the store holds it, once the card has an id.</summary>
    public FlashcardSchedule ToSchedule(string cardId) =>
        new(cardId, DueDate, Stability, Difficulty, Reps, Lapses, FsrsState, 0, LastReviewedAt);
}
