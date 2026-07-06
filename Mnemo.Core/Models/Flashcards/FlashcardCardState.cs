namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Lifecycle state of a flashcard's content. Suspended cards are hidden from study
/// (queues and due counts) but remain visible, dimmed, in the deck view.
/// </summary>
public enum FlashcardCardState
{
    Active = 0,
    Suspended = 1
}
