using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// Content CRUD for cards — the surface AI/MCP tools mirror. Every mutation is a small,
/// addressable, single-row or bounded-batch operation; no whole-deck rewrites.
/// </summary>
public interface IFlashcardCardService
{
    Task<FlashcardCardPage> ListCardsAsync(FlashcardCardQuery query, CancellationToken cancellationToken = default);
    Task<Flashcard?> GetCardAsync(string cardId, CancellationToken cancellationToken = default);

    Task<Flashcard> CreateCardAsync(FlashcardCardDraft draft, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Flashcard>> CreateCardsAsync(string deckId, IReadOnlyList<FlashcardCardDraft> drafts, CancellationToken cancellationToken = default);
    Task UpdateCardAsync(Flashcard card, CancellationToken cancellationToken = default);

    Task DeleteCardsAsync(IReadOnlyList<string> cardIds, CancellationToken cancellationToken = default);
    Task MoveCardsAsync(IReadOnlyList<string> cardIds, string targetDeckId, CancellationToken cancellationToken = default);
    Task SetSuspendedAsync(IReadOnlyList<string> cardIds, bool suspended, CancellationToken cancellationToken = default);
    Task SetFlaggedAsync(IReadOnlyList<string> cardIds, bool flagged, CancellationToken cancellationToken = default);
    Task AddTagAsync(IReadOnlyList<string> cardIds, string tag, CancellationToken cancellationToken = default);

    /// <summary>FTS5 search ranked by relevance then recency; suspended excluded unless the scope asks.</summary>
    Task<IReadOnlyList<Flashcard>> SearchAsync(string query, FlashcardSearchScope scope, CancellationToken cancellationToken = default);

    /// <summary>Maximum image attachments allowed per side of a card.</summary>
    const int MaxAttachmentsPerSide = 3;
}
