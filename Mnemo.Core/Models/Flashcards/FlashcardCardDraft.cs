using Mnemo.Core.Models;

namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Input for creating a card. The service assigns the id and timestamps, and gives the card a New
/// schedule unless one is carried in; callers otherwise supply content only. Enables O(changes)
/// bulk creation for AI/MCP tools.
/// </summary>
/// <param name="Schedule">
/// Scheduling brought in from another app, or null to start the card New and due now. Set by an
/// import, which is the only caller that knows a card has a history.
/// </param>
/// <param name="State">
/// Whether the card arrives suspended. An import carries this; everything else creates an active
/// card, since suspending one is a separate deliberate act.
/// </param>
public sealed record FlashcardCardDraft(
    string DeckId,
    FlashcardType Type,
    string Front,
    string Back,
    IReadOnlyList<string> Tags,
    IReadOnlyList<FlashcardAttachment> Attachments,
    FlashcardSourceInfo? SourceInfo = null,
    IReadOnlyList<Block>? FrontBlocks = null,
    IReadOnlyList<Block>? BackBlocks = null,
    FlashcardImportedSchedule? Schedule = null,
    FlashcardCardState State = FlashcardCardState.Active);
