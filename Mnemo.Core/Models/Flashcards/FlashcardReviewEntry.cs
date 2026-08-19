namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// The complete outcome of grading one card in a scheduled Review, written atomically to the
/// schedule, the review log and the daily-stats counter. The scheduler computes
/// <see cref="UpdatedSchedule"/>; the study service persists all of it in one transaction.
/// </summary>
/// <remarks>
/// <see cref="LeechedCard"/> is set only on the grade that pushes a card past its preset's lapse
/// threshold, and carries the card with its tag and state already applied. It rides along in the
/// same transaction so a card can never end up counted as a lapse without being marked for it.
///
/// <see cref="BurySiblingsUntil"/> is set when the deck's preset asks for related cards to wait
/// their turn. It travels with the grade so the answer and the hold on the rest of the material
/// land together.
/// </remarks>
public sealed record FlashcardReviewEntry(
    FlashcardSchedule UpdatedSchedule,
    FlashcardReviewLog Review,
    bool IntroducedNewCard,
    string LocalDay,
    Flashcard? LeechedCard = null,
    DateTimeOffset? BurySiblingsUntil = null);
