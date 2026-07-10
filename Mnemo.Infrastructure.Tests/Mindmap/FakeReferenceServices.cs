using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>An in-memory note service whose only meaningful behavior is existence: ids passed to the
/// constructor resolve, everything else is a dangling reference.</summary>
internal sealed class FakeNoteService : INoteService
{
    private readonly HashSet<string> _ids;

    public FakeNoteService(params string[] existingIds) => _ids = new HashSet<string>(existingIds, StringComparer.Ordinal);

    public Task<IEnumerable<Note>> GetAllNotesAsync() =>
        Task.FromResult<IEnumerable<Note>>(_ids.Select(id => new Note { NoteId = id }).ToArray());

    public Task<Note?> GetNoteAsync(string noteId) =>
        Task.FromResult(_ids.Contains(noteId) ? new Note { NoteId = noteId } : null);

    public Task<Result> SaveNoteAsync(Note note) => Task.FromResult(Result.Success());

    public Task<Result> DeleteNoteAsync(string noteId) => Task.FromResult(Result.Success());
}

/// <summary>A flashcard library whose only meaningful behavior is deck existence via
/// <see cref="GetDeckAsync"/>; all other members are inert.</summary>
internal sealed class FakeDeckLibrary : IFlashcardLibraryService
{
    private readonly HashSet<string> _ids;

    public FakeDeckLibrary(params string[] existingIds) => _ids = new HashSet<string>(existingIds, StringComparer.Ordinal);

    public Task<FlashcardDeckSummary?> GetDeckAsync(string deckId, CancellationToken cancellationToken = default)
    {
        if (!_ids.Contains(deckId))
            return Task.FromResult<FlashcardDeckSummary?>(null);

        var header = new FlashcardDeckHeader(deckId, null, "preset", "Deck", null, Array.Empty<string>(), 0, null);
        return Task.FromResult<FlashcardDeckSummary?>(new FlashcardDeckSummary(header, 0, 0, 0, FlashcardDueCounts.Empty, 0));
    }

    public Task<IReadOnlyList<FlashcardFolder>> ListFoldersAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<FlashcardFolder>>(Array.Empty<FlashcardFolder>());

    public Task<IReadOnlyList<FlashcardDeckSummary>> ListDecksAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<FlashcardDeckSummary>>(Array.Empty<FlashcardDeckSummary>());

    public Task SaveFolderAsync(FlashcardFolder folder, CancellationToken cancellationToken = default) => Task.CompletedTask;

    public Task<FlashcardDeckHeader> CreateDeckAsync(string name, string? folderId = null, string? presetId = null, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public Task SaveDeckAsync(FlashcardDeckHeader deck, CancellationToken cancellationToken = default) => Task.CompletedTask;

    public Task MoveDeckAsync(string deckId, string? folderId, int sortOrder, CancellationToken cancellationToken = default) => Task.CompletedTask;

    public Task ReorderAsync(IReadOnlyList<FlashcardOrderEntry> entries, CancellationToken cancellationToken = default) => Task.CompletedTask;

    public Task<bool> DeleteDeckAsync(string deckId, CancellationToken cancellationToken = default) => Task.FromResult(false);

    public Task<bool> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default) => Task.FromResult(false);
}
