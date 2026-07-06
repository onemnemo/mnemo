namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// One deck's position after a drag-and-drop reorder in the library (10a): its (possibly new)
/// folder and sort index. Persisted in a single batch by the library service.
/// </summary>
public sealed record FlashcardOrderEntry(
    string DeckId,
    string? FolderId,
    int SortOrder);
