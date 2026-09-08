namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// What saving a proposed card type would cost the collection, worked out without writing
/// anything.
/// </summary>
/// <remarks>
/// The editor cannot answer this on its own. It knows which layouts a draft still lists, but the
/// cards a save sweeps are the ones the material owns and no longer generates, which also covers a
/// layout that is still there and has stopped firing, and a card somebody restored from the trash
/// under a layout that has since gone.
/// </remarks>
/// <param name="RemovedCardCount">Cards the save would move to the trash.</param>
/// <param name="AffectedFactCount">Pieces of material that would lose at least one card.</param>
public sealed record FlashcardCardTypePreflight(int RemovedCardCount, int AffectedFactCount);
