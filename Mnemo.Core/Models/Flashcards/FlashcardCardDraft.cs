using Mnemo.Core.Models;

namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Input for creating a card. The service assigns the id, timestamps and initial (New) schedule;
/// callers supply content only. Enables O(changes) bulk creation for AI/MCP tools.
/// </summary>
public sealed record FlashcardCardDraft(
    string DeckId,
    FlashcardType Type,
    string Front,
    string Back,
    IReadOnlyList<string> Tags,
    IReadOnlyList<FlashcardAttachment> Attachments,
    FlashcardSourceInfo? SourceInfo = null,
    IReadOnlyList<Block>? FrontBlocks = null,
    IReadOnlyList<Block>? BackBlocks = null);
