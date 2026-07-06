using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// Library-level operations for the flashcard home: folders and deck headers/summaries.
/// Deck listings return counts only, never the full card list.
/// </summary>
public interface IFlashcardLibraryService
{
    Task<IReadOnlyList<FlashcardFolder>> ListFoldersAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<FlashcardDeckSummary>> ListDecksAsync(CancellationToken cancellationToken = default);
    Task<FlashcardDeckSummary?> GetDeckAsync(string deckId, CancellationToken cancellationToken = default);

    Task SaveFolderAsync(FlashcardFolder folder, CancellationToken cancellationToken = default);
    Task<FlashcardDeckHeader> CreateDeckAsync(string name, string? folderId = null, string? presetId = null, CancellationToken cancellationToken = default);
    Task SaveDeckAsync(FlashcardDeckHeader deck, CancellationToken cancellationToken = default);

    Task MoveDeckAsync(string deckId, string? folderId, int sortOrder, CancellationToken cancellationToken = default);
    Task ReorderAsync(IReadOnlyList<FlashcardOrderEntry> entries, CancellationToken cancellationToken = default);

    Task<bool> DeleteDeckAsync(string deckId, CancellationToken cancellationToken = default);
    Task<bool> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default);
}
