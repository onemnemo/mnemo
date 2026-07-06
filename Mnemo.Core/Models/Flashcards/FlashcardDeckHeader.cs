namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Deck metadata without its cards. This is the write surface for deck properties; the library
/// and deck view consume <see cref="FlashcardDeckSummary"/> (header + counts) instead
/// of ever loading the full card list.
/// </summary>
public sealed record FlashcardDeckHeader(
    string Id,
    string? FolderId,
    string PresetId,
    string Name,
    string? Description,
    IReadOnlyList<string> Tags,
    int SortOrder,
    DateTimeOffset? LastStudied,
    DateTimeOffset CreatedAt = default,
    DateTimeOffset UpdatedAt = default);
