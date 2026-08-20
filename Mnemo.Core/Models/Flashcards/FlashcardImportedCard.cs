namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// What another app already knew about one of the cards a piece of material makes.
/// </summary>
/// <remarks>
/// Content is deliberately absent. The card type decides what each card says, so an import that
/// carried the rendered text would fight the generator on the first edit. Only the history belongs
/// to the card itself.
/// </remarks>
/// <param name="Schedule">
/// Scheduling the other app recorded, or null to start the card New and due now. A deletion the
/// package happened to have no card for gets null, which is what a card nobody has seen deserves.
/// </param>
/// <param name="State">Whether the card arrives suspended.</param>
public sealed record FlashcardImportedCard(
    FlashcardImportedSchedule? Schedule = null,
    FlashcardCardState State = FlashcardCardState.Active);
