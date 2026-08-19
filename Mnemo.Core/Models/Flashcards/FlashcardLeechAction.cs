namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// What happens to a card that keeps being forgotten once it has lapsed as often as its preset
/// allows. A card at that point is usually badly written rather than badly scheduled, and no
/// interval fixes that, so the scheduler stops trying and says so.
/// </summary>
public enum FlashcardLeechAction
{
    /// <summary>Nothing at all. The card keeps coming back on its ordinary schedule.</summary>
    None = 0,

    /// <summary>The card is tagged so it can be found and rewritten, and stays in the queue.</summary>
    Tag = 1,

    /// <summary>The card is tagged and suspended, so it stops appearing until it is dealt with.</summary>
    Suspend = 2
}
