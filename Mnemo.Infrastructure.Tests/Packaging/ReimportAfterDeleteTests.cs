using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Mindmap;
using Mnemo.Infrastructure.Tests.Notes;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Packaging;

/// <summary>
/// Export an item, delete it the way the app does (into the trash), then import the package back.
/// The deleted original is invisible to the user, so the import has to land the content as a live
/// item rather than colliding with the held row and writing nothing.
/// </summary>
public sealed class ReimportAfterDeleteTests
{
    [Theory]
    [InlineData(ImportConflictPolicy.KeepBoth)]
    [InlineData(ImportConflictPolicy.Skip)]
    [InlineData(ImportConflictPolicy.Replace)]
    public async Task A_deck_deleted_after_export_comes_back_with_its_cards(ImportConflictPolicy policy)
    {
        await using var h = new FlashcardStoreHarness();
        await h.SeedDeckAsync();
        await h.AddCardAsync(
            FlashcardStoreHarness.Card("c1", "deck-1", "gg", "ggg"),
            Core.Models.Flashcards.FlashcardSchedule.NewFor("c1", h.Time.GetUtcNow()));
        var handler = FlashcardPackageFixture.Handler(h);
        var exported = await handler.ExportAsync(FlashcardPackageFixture.ExportContext(MnemoPackageKinds.Export));
        Assert.Equal(1, exported.ItemCount);

        await new FlashcardDeckTrashSource(h.Store).CaptureAsync("deck-1", "e1");

        var evidence = await handler.InspectAsync(FlashcardPackageFixture.ImportContext(exported, policy));
        Assert.Equal(1, evidence.NewHere);
        Assert.Equal(0, evidence.AlreadyHere);

        var result = await handler.ImportAsync(FlashcardPackageFixture.ImportContext(exported, policy));

        var decks = await h.Store.ReadAsync((conn, ct) => h.Decks.ListHeadersAsync(conn, ct));
        var deck = Assert.Single(decks);
        Assert.NotEqual("deck-1", deck.Id);
        var cards = await h.Store.ReadAsync((conn, ct) => h.Cards.ListByDeckAsync(conn, deck.Id, ct));
        Assert.Equal("gg", Assert.Single(cards).Front);
        Assert.Equal(1, result.ImportedCount);

        // The deleted deck is still in the trash as it was, with its card, ready to be restored.
        Assert.Equal(1, await CountHeldAsync(h, "SELECT COUNT(*) FROM FlashcardDecks WHERE Id = 'deck-1' AND TrashId IS NOT NULL;"));
        Assert.Equal(1, await CountHeldAsync(h, "SELECT COUNT(*) FROM FlashcardCards WHERE Id = 'c1' AND DeckId = 'deck-1' AND TrashId IS NOT NULL;"));
    }

    [Theory]
    [InlineData(ImportConflictPolicy.KeepBoth)]
    [InlineData(ImportConflictPolicy.Skip)]
    [InlineData(ImportConflictPolicy.Replace)]
    public async Task A_map_deleted_after_export_comes_back_with_its_nodes(ImportConflictPolicy policy)
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("Alpha", new[]
        {
            new MindmapNodeSpec { Text = "R", Children = new[] { new MindmapNodeSpec { Text = "C" } } },
        })).Value!;
        var handler = new MindmapsMnemoPayloadHandler(h.Service, h.Store, h.Store, new TestLogger());
        var exported = await handler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });

        await h.Store.CaptureMapAsync(map.Id, "e1");

        var result = await handler.ImportAsync(new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "mindmaps", Path = "payloads/mindmaps", SchemaVersion = exported.SchemaVersion },
            Options = new MnemoPackageImportOptions { ConflictPolicy = policy },
            Files = exported.Files,
        });

        var library = await h.Store.ListAsync();
        var entry = Assert.Single(library);
        Assert.NotEqual(map.Id, entry.Id);
        var restored = (await h.Service.GetAsync(entry.Id)).Value!;
        Assert.Equal(2, restored.Elements.Count(e => e.Kind == ElementKind.Node));
        Assert.Equal(1, result.ImportedCount);
        Assert.Null(await h.Store.LoadAsync(map.Id));
        Assert.Equal(map.Revision, (await h.Store.LoadAllOwnedAsync(map.Id))!.Revision);
    }

    [Theory]
    [InlineData(ImportConflictPolicy.KeepBoth)]
    [InlineData(ImportConflictPolicy.Skip)]
    [InlineData(ImportConflictPolicy.Replace)]
    public async Task A_note_deleted_after_export_comes_back(ImportConflictPolicy policy)
    {
        await using var h = new NoteSidMigrationHarness();
        var note = new Note { NoteId = Guid.NewGuid().ToString(), Title = "Rocks", Content = "granite" };
        Assert.True((await h.Notes.SaveNoteAsync(note)).IsSuccess);
        var packaged = BuildNotesDb(note);

        await h.Store.CaptureNoteAsync(note.NoteId, "e1");
        Assert.Empty(await h.Notes.GetAllNotesAsync());

        var result = await new NotesMnemoPayloadHandler(h.Notes, h.Folders, h.Store).ImportAsync(NotesContext(packaged, policy));

        var live = Assert.Single(await h.Notes.GetAllNotesAsync());
        Assert.Equal("Rocks", live.Title);
        Assert.NotEqual(note.NoteId, live.NoteId);
        Assert.Equal(1, result.ImportedCount);
        Assert.Equal(live.NoteId, result.RemappedIds[note.NoteId]);
        Assert.Equal("granite", (await h.Storage.LoadAsync<Note>($"note_{note.NoteId}")).Value?.Content);
    }

    [Fact]
    public async Task A_map_whose_folder_was_deleted_after_export_comes_back_filed_under_a_live_folder()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        var map = (await h.Service.CreateAsync("Alpha", new[] { new MindmapNodeSpec { Text = "R" } })).Value!;
        await h.Store.SetFolderAsync(map.Id, "f1");
        var handler = new MindmapsMnemoPayloadHandler(h.Service, h.Store, h.Store, new TestLogger());
        var exported = await handler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });

        await h.Store.CaptureFolderAsync("f1", "e1");

        var result = await handler.ImportAsync(new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "mindmaps", Path = "payloads/mindmaps", SchemaVersion = exported.SchemaVersion },
            Options = new MnemoPackageImportOptions { ConflictPolicy = ImportConflictPolicy.KeepBoth },
            Files = exported.Files,
        });

        var folder = Assert.Single(await h.Store.GetFoldersAsync());
        Assert.NotEqual("f1", folder.Id);
        Assert.Equal("Geology", folder.Name);
        var entry = Assert.Single((await h.Service.GetLibraryAsync()).Value!);
        Assert.Equal(folder.Id, entry.FolderId);
        Assert.Equal(1, result.ImportedCount);
        Assert.Contains("f1", await h.Store.HeldFolderIdsAsync());
    }

    [Fact]
    public async Task A_note_whose_folder_was_deleted_after_export_comes_back_filed_under_a_live_folder()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = new NoteFolder { FolderId = "f1", Name = "Geology" };
        Assert.True((await h.Folders.SaveFolderAsync(folder)).IsSuccess);
        var note = new Note { NoteId = Guid.NewGuid().ToString(), Title = "Rocks", FolderId = "f1" };
        Assert.True((await h.Notes.SaveNoteAsync(note)).IsSuccess);
        var packaged = BuildNotesDb(note, folder);

        await h.Store.CaptureFolderAsync("f1", "e1");

        var result = await new NotesMnemoPayloadHandler(h.Notes, h.Folders, h.Store)
            .ImportAsync(NotesContext(packaged, ImportConflictPolicy.KeepBoth));

        Assert.Empty(result.Warnings);
        var liveFolder = Assert.Single(await h.Folders.GetAllFoldersAsync());
        Assert.NotEqual("f1", liveFolder.FolderId);
        Assert.Equal("Geology", liveFolder.Name);
        Assert.Equal(liveFolder.FolderId, Assert.Single(await h.Notes.GetAllNotesAsync()).FolderId);
        Assert.True((await h.Store.HeldFolderIdsAsync()).ContainsKey("f1"));
    }

    [Fact]
    public async Task A_note_save_that_fails_for_another_reason_is_not_retried_under_a_new_id()
    {
        await using var h = new NoteSidMigrationHarness();
        var notes = new RefusingNoteService();
        var note = new Note { NoteId = Guid.NewGuid().ToString(), Title = "Rocks" };

        var result = await new NotesMnemoPayloadHandler(notes, h.Folders, h.Store)
            .ImportAsync(NotesContext(BuildNotesDb(note), ImportConflictPolicy.KeepBoth));

        Assert.Equal([note.NoteId], notes.Attempts);
        Assert.Equal(0, result.ImportedCount);
        Assert.Empty(result.RemappedIds);
        Assert.Equal("NoteImportFailed", Assert.Single(result.Warnings).Key);
    }

    private static MnemoPayloadImportContext NotesContext(byte[] packaged, ImportConflictPolicy policy) => new()
    {
        Entry = new MnemoPackageEntry { PayloadType = "notes", Path = "payloads/notes" },
        Options = new MnemoPackageImportOptions { ConflictPolicy = policy },
        Files = new Dictionary<string, byte[]> { ["notes.db"] = packaged },
    };

    /// <summary>A note service whose every save fails the way a busy or broken database would.</summary>
    private sealed class RefusingNoteService : INoteService
    {
        public List<string> Attempts { get; } = [];

        public Task<IEnumerable<Note>> GetAllNotesAsync() => Task.FromResult(Enumerable.Empty<Note>());

        public Task<IReadOnlyList<NoteSummary>> GetAllNoteSummariesAsync() =>
            Task.FromResult<IReadOnlyList<NoteSummary>>(Array.Empty<NoteSummary>());

        public Task<Note?> GetNoteAsync(string noteId) => Task.FromResult<Note?>(null);

        public Task<Result> SaveNoteAsync(Note note)
        {
            Attempts.Add(note.NoteId);
            return Task.FromResult(Result.Failure("database is locked"));
        }

        public Task<Result> DeleteNoteAsync(string noteId) => Task.FromResult(Result.Success());
    }

    private static Task<int> CountHeldAsync(FlashcardStoreHarness h, string sql) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0);
        });

    private static byte[] BuildNotesDb(Note note, NoteFolder? folder = null)
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo-reimport-notes-{Guid.NewGuid():N}.db");
        try
        {
            using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
            {
                connection.Open();
                using var cmd = connection.CreateCommand();
                cmd.CommandText = """
                    CREATE TABLE Notes (NoteId TEXT PRIMARY KEY, Json TEXT NOT NULL);
                    CREATE TABLE Folders (FolderId TEXT PRIMARY KEY, Json TEXT NOT NULL);
                    INSERT INTO Notes (NoteId, Json) VALUES ($id, $json);
                    """;
                cmd.Parameters.AddWithValue("$id", note.NoteId);
                cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(note));
                cmd.ExecuteNonQuery();

                if (folder is not null)
                {
                    using var insertFolder = connection.CreateCommand();
                    insertFolder.CommandText = "INSERT INTO Folders (FolderId, Json) VALUES ($id, $json);";
                    insertFolder.Parameters.AddWithValue("$id", folder.FolderId);
                    insertFolder.Parameters.AddWithValue("$json", JsonSerializer.Serialize(folder));
                    insertFolder.ExecuteNonQuery();
                }
            }

            return File.ReadAllBytes(path);
        }
        finally
        {
            File.Delete(path);
        }
    }
}
