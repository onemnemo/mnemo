namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// The complete outcome of grading one card in a scheduled Review, written atomically to the
/// schedule, the review log and the daily-stats counter. The scheduler computes
/// <see cref="UpdatedSchedule"/>; the study service persists all of it in one transaction.
/// </summary>
/// <remarks>
/// <see cref="Leech"/> is set only on the grade that pushes a card past its preset's lapse
/// threshold, and names what the preset asks for. It rides along in the same transaction so a card
/// can never end up counted as a lapse without being marked for it. The service applies it to the
/// card as it is stored at that moment rather than to the copy the session queued, so an edit, a
/// flag or a deck move made while the session was open is not written over by the mark.
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
    FlashcardLeechAction? Leech = null,
    DateTimeOffset? BurySiblingsUntil = null);
