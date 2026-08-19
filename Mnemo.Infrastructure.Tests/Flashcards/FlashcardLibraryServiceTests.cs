using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

public sealed class FlashcardLibraryServiceTests
{
    [Fact]
    public async Task DeleteFolder_ReparentsChildFoldersAndDecksToRoot_ThenDeletesTheFolder()
    {
        await using var h = new FlashcardStoreHarness();
        var lib = NewLibrary(h);

        var parent = await SaveFolderAsync(lib, "parent", null, 0);
        var child = await SaveFolderAsync(lib, "child", parent.Id, 0);
        await SaveFolderAsync(lib, "sibling-root", null, 0);
        var deck = await lib.CreateDeckAsync("Geology", parent.Id);

        var deleted = await lib.DeleteFolderAsync(parent.Id);

        Assert.True(deleted);
        var folders = await lib.ListFoldersAsync();
        Assert.DoesNotContain(folders, f => f.Id == parent.Id);
        var reparentedChild = Assert.Single(folders, f => f.Id == child.Id);
        Assert.Null(reparentedChild.ParentId);

        var summary = await lib.GetDeckAsync(deck.Id);
        Assert.NotNull(summary);
        Assert.Null(summary!.Header.FolderId);
    }

    [Fact]
    public async Task DeleteFolder_ReturnsFalse_WhenTheFolderDoesNotExist()
    {
        await using var h = new FlashcardStoreHarness();
        var lib = NewLibrary(h);

        var deleted = await lib.DeleteFolderAsync("no-such-folder");

        Assert.False(deleted);
    }

    [Fact]
    public async Task DeleteFolder_IsAtomic_RollsBackReparentingWhenTheMoveStepFails()
    {
        await using var h = new FlashcardStoreHarness();
        var throwingDecks = new ThrowingMoveDeckRepository(h.Decks);
        var lib = new FlashcardLibraryService(h.Store, h.Folders, throwingDecks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

        var parent = await SaveFolderAsync(lib, "parent", null, 0);
        var child = await SaveFolderAsync(lib, "child", parent.Id, 0);
        var deck = await lib.CreateDeckAsync("Geology", parent.Id);

        await Assert.ThrowsAsync<InvalidOperationException>(() => lib.DeleteFolderAsync(parent.Id));

        // Nothing committed: the folder, its child's parent link and the deck's folder are all
        // exactly as they were before the failed delete, because reparenting and the delete itself
        // ran inside one transaction.
        var folders = await lib.ListFoldersAsync();
        Assert.Contains(folders, f => f.Id == parent.Id);
        var untouchedChild = Assert.Single(folders, f => f.Id == child.Id);
        Assert.Equal(parent.Id, untouchedChild.ParentId);

        var summary = await lib.GetDeckAsync(deck.Id);
        Assert.NotNull(summary);
        Assert.Equal(parent.Id, summary!.Header.FolderId);
    }

    // --- helpers ---

    private static async Task<FlashcardFolder> SaveFolderAsync(FlashcardLibraryService lib, string id, string? parentId, int order)
    {
        var folder = new FlashcardFolder(id, id, parentId, order);
        await lib.SaveFolderAsync(folder);
        return folder;
    }

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    /// <summary>Forwards to a real repository except on <see cref="MoveAsync"/>, which always fails,
    /// to prove a folder delete rolls back completely rather than leaving a partial reparent.</summary>
    private sealed class ThrowingMoveDeckRepository : IDeckRepository
    {
        private readonly IDeckRepository _inner;

        public ThrowingMoveDeckRepository(IDeckRepository inner) => _inner = inner;

        public Task<System.Collections.Generic.IReadOnlyList<FlashcardDeckHeader>> ListHeadersAsync(SqliteConnection conn, CancellationToken cancellationToken) =>
            _inner.ListHeadersAsync(conn, cancellationToken);

        public Task<FlashcardDeckHeader?> GetHeaderAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken) =>
            _inner.GetHeaderAsync(conn, deckId, cancellationToken);

        public Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardDeckHeader deck, CancellationToken cancellationToken) =>
            _inner.UpsertAsync(conn, tx, deck, cancellationToken);

        public Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, CancellationToken cancellationToken) =>
            _inner.DeleteAsync(conn, tx, deckId, cancellationToken);

        public Task MoveAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string? folderId, int sortOrder, DateTimeOffset now, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("simulated move failure");

        public Task SetPresetAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string presetId, DateTimeOffset now, CancellationToken cancellationToken) =>
            _inner.SetPresetAsync(conn, tx, deckId, presetId, now, cancellationToken);

        public Task SetLastStudiedAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, DateTimeOffset when, CancellationToken cancellationToken) =>
            _inner.SetLastStudiedAsync(conn, tx, deckId, when, cancellationToken);
    }
}
