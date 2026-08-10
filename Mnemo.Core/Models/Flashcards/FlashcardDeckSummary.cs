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
    int RetentionPercent,
    /// <summary>
    /// Reviews the retention percentage was measured over. Zero means the window held
    /// none of them, which is not the same fact as a measured 0%: a deck nobody has
    /// touched lately has no score, and a surface that draws one is inventing it.
    /// </summary>
    int RetentionSampleSize = 0)
{
    /// <summary>Deck id (delegates to the header).</summary>
    public string Id => Header.Id;

    /// <summary>Deck display name (delegates to the header).</summary>
    public string Name => Header.Name;
}
