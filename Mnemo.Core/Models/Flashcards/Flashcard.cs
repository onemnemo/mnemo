using Mnemo.Core.Models;

namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Content-only flashcard record: the surface AI/MCP tools touch. Scheduling lives separately in
/// <see cref="FlashcardSchedule"/>; the two are joined in <see cref="FlashcardView"/> for callers
/// that need both. The canonical body is the plaintext/markdown <see cref="Front"/>/<see cref="Back"/>;
/// <see cref="FrontBlocks"/>/<see cref="BackBlocks"/> are a derived convenience for rich rendering.
/// </summary>
public sealed record Flashcard(
    string Id,
    string DeckId,
    FlashcardType Type,
    string Front,
    string Back,
    IReadOnlyList<string> Tags,
    FlashcardCardState State,
    bool IsFlagged,
    IReadOnlyList<FlashcardAttachment> Attachments,
    FlashcardSourceInfo? SourceInfo = null,
    IReadOnlyList<Block>? FrontBlocks = null,
    IReadOnlyList<Block>? BackBlocks = null,
    DateTimeOffset CreatedAt = default,
    DateTimeOffset UpdatedAt = default);
