using Mnemo.Core.Models;

namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Content-only flashcard record: the surface AI/MCP tools touch. Scheduling lives separately in
/// <see cref="FlashcardSchedule"/>; the two are joined in <see cref="FlashcardView"/> for callers
/// that need both. The canonical body is the plaintext/markdown <see cref="Front"/>/<see cref="Back"/>;
/// <see cref="FrontBlocks"/>/<see cref="BackBlocks"/> are a derived convenience for rich rendering.
/// </summary>
/// <param name="FactId">
/// The material this card was made from, or null for a card that predates it. Content on a card
/// with a fact is a rendering of that material: editing it means editing the fact.
/// </param>
/// <param name="LayoutKey">
/// Which of the material's cards this one is: a layout id, or a cloze deletion written as
/// <c>c2</c>. Stable across edits, so a card keeps its schedule when the fact is saved again.
/// </param>
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
    DateTimeOffset UpdatedAt = default,
    string? FactId = null,
    string? LayoutKey = null);
