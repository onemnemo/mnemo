namespace Mnemo.Core.Models.Flashcards;

/// <summary>The three study modes (replaces the legacy Quick/Focused). Review persists; Cram and Test do not.</summary>
public enum FlashcardSessionMode
{
    Review = 0,
    Cram = 1,
    Test = 2
}

/// <summary>Cram scope: only cards due now, or the whole deck.</summary>
public enum FlashcardSessionScope
{
    Due = 0,
    All = 1
}

/// <summary>Request to start a study session.</summary>
public sealed record FlashcardSessionRequest(
    string DeckId,
    FlashcardSessionMode Mode,
    FlashcardSessionScope Scope = FlashcardSessionScope.Due);

/// <summary>
/// Live session counters for the review shell: the new/learning/due split of what remains,
/// plus completed/total for the progress bar.
/// </summary>
public sealed record FlashcardSessionProgress(int New, int Learning, int Due, int Completed, int Total)
{
    public static FlashcardSessionProgress Empty { get; } = new(0, 0, 0, 0, 0);
}
