namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// The part of a leech mark a grade actually put on the card, judged against the card as it was
/// stored at that moment: the tag when the card did not already carry it, the suspension when the
/// card was active. Undo takes back only what is set here, so a tag that was there before the
/// grade and a suspension the reader made themselves both survive it.
/// </summary>
public sealed record FlashcardLeechMark(bool TagAdded, bool Suspended);
