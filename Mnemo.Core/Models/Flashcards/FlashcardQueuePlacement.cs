namespace Mnemo.Core.Models.Flashcards;

/// <summary>Where a set of new cards is put in its deck's new queue.</summary>
public enum FlashcardQueuePlacement
{
    /// <summary>Ahead of every other new card in the deck.</summary>
    Start = 0,

    /// <summary>Behind every other new card in the deck.</summary>
    End = 1,

    /// <summary>At a one-based position counted from the front of the queue.</summary>
    At = 2
}
