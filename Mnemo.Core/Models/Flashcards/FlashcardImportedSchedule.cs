namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Scheduling an import carries in from another app, before the card it belongs to has an id.
/// </summary>
/// <remarks>
/// Only the facts the other app actually recorded. There is deliberately no stability or difficulty
/// here: no published mapping turns another algorithm's numbers into FSRS memory state, and a made
/// up one would look like measured knowledge of the user's memory. Left unset, the scheduler treats
/// the first real review as the cold start it is, which is what the card's own history deserves.
/// </remarks>
/// <param name="DueDate">When the card next comes up, kept rather than reset to now.</param>
/// <param name="LastReviewedAt">
/// When it was last answered, so the first review measures the right elapsed time.
/// </param>
public sealed record FlashcardImportedSchedule(
    DateTimeOffset DueDate,
    int Reps,
    int Lapses,
    FlashcardFsrsState FsrsState,
    DateTimeOffset? LastReviewedAt)
{
    /// <summary>The schedule as a card in the store holds it, once the card has an id.</summary>
    public FlashcardSchedule ToSchedule(string cardId) =>
        new(cardId, DueDate, null, null, Reps, Lapses, FsrsState, 0, LastReviewedAt);
}
