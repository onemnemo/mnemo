namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// The complete outcome of grading one card in a scheduled Review, written atomically to the
/// schedule, the review log and the daily-stats counter. The scheduler computes
/// <see cref="UpdatedSchedule"/>; the study service persists all three tables in one transaction.
/// </summary>
public sealed record FlashcardReviewEntry(
    FlashcardSchedule UpdatedSchedule,
    FlashcardReviewLog Review,
    bool IntroducedNewCard,
    string LocalDay);
