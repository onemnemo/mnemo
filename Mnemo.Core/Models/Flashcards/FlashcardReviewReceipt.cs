using System.Collections.Generic;

namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// What recording a grade wrote: the review log row's id, the leech mark that landed on the
/// card, or null when the grade marked nothing, and the sibling cards the grade put on hold,
/// empty when every sibling was already held or there were none. Together they are exactly what
/// an undo has to take back.
/// </summary>
public sealed record FlashcardReviewReceipt(long ReviewId, FlashcardLeechMark? Leech, IReadOnlyList<string> SiblingsHeld);
