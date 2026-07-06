namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// A deck's header plus its aggregate counts, computed from indexed SQL, never by loading cards.
/// This is what the library and deck view render.
/// </summary>
public sealed record FlashcardDeckSummary(
    FlashcardDeckHeader Header,
    int TotalCards,
    int ActiveCards,
    int SuspendedCards,
    FlashcardDueCounts DueCounts,
    int RetentionPercent)
{
    /// <summary>Deck id (delegates to the header).</summary>
    public string Id => Header.Id;

    /// <summary>Deck display name (delegates to the header).</summary>
    public string Name => Header.Name;
}
