namespace Mnemo.Core.Models.Flashcards;

/// <summary>State filter for the deck view card table (matches the "State: Due" chip).</summary>
public enum FlashcardCardStateFilter
{
    All = 0,
    Due = 1,
    New = 2,
    Learning = 3,
    Suspended = 4,
    Flagged = 5
}

/// <summary>Sort key for the deck view card table.</summary>
public enum FlashcardCardSort
{
    Due = 0,
    Front = 1,
    Type = 2,
    Reps = 3,
    Lapses = 4,
    Created = 5
}

/// <summary>
/// A paginated, filtered query over cards. Backs the deck view, which is always paged
/// (e.g. "1 to 50 of 58") and never loads a whole deck at once, and the collection-wide browser,
/// which runs the same query with <see cref="DeckId"/> left null.
/// </summary>
public sealed record FlashcardCardQuery(
    /// <summary>Restricts to one deck; null searches every deck in the library.</summary>
    string? DeckId,
    string? Text = null,
    FlashcardCardStateFilter State = FlashcardCardStateFilter.All,
    string? Tag = null,
    FlashcardCardSort Sort = FlashcardCardSort.Due,
    bool SortDescending = false,
    int Offset = 0,
    int Limit = 50,
    /// <summary>Restricts to one card type; null leaves every type in.</summary>
    FlashcardType? Type = null,
    /// <summary>
    /// Inclusive bounds on how many times a card has been forgotten after being learned.
    /// The pair covers both directions the deck view offers: "forgotten at least n times",
    /// which finds the cards worth rewriting, and "never forgotten", which is Max 0.
    /// </summary>
    int? MinLapses = null,
    int? MaxLapses = null,
    /// <summary>
    /// Restricts to facts authored under one <see cref="FlashcardCardType"/>; null leaves every
    /// card type in. Distinct from <see cref="Type"/>, which is the classic/cloze rendering shape.
    /// </summary>
    string? CardTypeId = null);

/// <summary>One page of cards (content + schedule) plus the total row count for the query.</summary>
public sealed record FlashcardCardPage(
    IReadOnlyList<FlashcardView> Items,
    int TotalCount,
    int Offset,
    int Limit);

/// <summary>Scope for full-text card search: whether suspended cards are included.</summary>
public enum FlashcardSearchScope
{
    ActiveOnly = 0,
    IncludeSuspended = 1
}
