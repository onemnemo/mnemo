namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// The new / learning / due split for a deck, honouring the preset's daily caps. Drives the
/// coloured counters in the review shell and the DUE column in the library.
/// </summary>
public sealed record FlashcardDueCounts(int New, int Learning, int Due)
{
    /// <summary>Total cards awaiting study across all three buckets.</summary>
    public int Total => New + Learning + Due;

    /// <summary>An all-zero count (nothing scheduled).</summary>
    public static FlashcardDueCounts Empty { get; } = new(0, 0, 0);

    /// <summary>Component-wise sum, used to aggregate across decks for the library banner.</summary>
    public FlashcardDueCounts Add(FlashcardDueCounts other) =>
        new(New + other.New, Learning + other.Learning, Due + other.Due);
}
