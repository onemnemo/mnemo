namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// FSRS scheduling state for a single card, held 1:1 with its <see cref="Flashcard"/> content.
/// Deliberately holds no cross-algorithm union — only FSRS fields.
/// </summary>
public sealed record FlashcardSchedule(
    string CardId,
    DateTimeOffset DueDate,
    double? Stability,
    double? Difficulty,
    int Reps,
    int Lapses,
    FlashcardFsrsState FsrsState,
    int LearningStepIndex,
    DateTimeOffset? LastReviewedAt,
    DateTimeOffset? BuriedUntil = null)
{
    /// <summary>Creates the initial schedule for a freshly created card (New, due now).</summary>
    public static FlashcardSchedule NewFor(string cardId, DateTimeOffset now) =>
        new(cardId, now, null, null, 0, 0, FlashcardFsrsState.New, 0, null);

    /// <summary>Whether the card is currently held back for another card off the same material.</summary>
    public bool IsBuriedAt(DateTimeOffset instant) => BuriedUntil is { } until && until > instant;
}
