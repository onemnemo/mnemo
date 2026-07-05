using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

namespace Mnemo.Infrastructure.Tests;

public sealed class NotesMnemoPayloadHandlerTests
{
    [Fact]
    public async Task ImportAsync_KeepBoth_GeneratesNewIdsAndSuffixesTitle()
    {
        var (handler, noteService, _) = await CreateHandlerWithExistingItemsAsync().ConfigureAwait(false);
        var bytes = BuildNotesDb(
            [new Note { NoteId = "n1", Title = "Existing" }],
            [new NoteFolder { FolderId = "f1", Name = "Folder" }]);

        var result = await handler.ImportAsync(BuildContext(bytes, ImportConflictPolicy.KeepBoth)).ConfigureAwait(false);

        Assert.Equal(1, result.ImportedCount);
        Assert.Equal(2, result.DuplicatedCount);
        Assert.Equal(0, result.SkippedCount);
        var all = (await noteService.GetAllNotesAsync().ConfigureAwait(false)).ToList();
        Assert.Equal(2, all.Count);
        Assert.Contains(all, n => n.Title == "Existing (2)");
    }

    [Fact]
    public async Task ImportAsync_Skip_LeavesExistingNoteUntouched()
    {
        var (handler, noteService, _) = await CreateHandlerWithExistingItemsAsync().ConfigureAwait(false);
        var bytes = BuildNotesDb(
            [new Note { NoteId = "n1", Title = "Incoming", Content = "new content" }],
            []);

        var result = await handler.ImportAsync(BuildContext(bytes, ImportConflictPolicy.Skip)).ConfigureAwait(false);

        Assert.Equal(0, result.ImportedCount);
        Assert.Equal(1, result.SkippedCount);
        var existing = await noteService.GetNoteAsync("n1").ConfigureAwait(false);
        Assert.Equal("Existing", existing?.Title);
    }

    [Fact]
    public async Task ImportAsync_Replace_OverwritesExistingNote()
    {
        var (handler, noteService, _) = await CreateHandlerWithExistingItemsAsync().ConfigureAwait(false);
        var bytes = BuildNotesDb(
            [new Note { NoteId = "n1", Title = "Incoming", Content = "new content" }],
            []);

        var result = await handler.ImportAsync(BuildContext(bytes, ImportConflictPolicy.Replace)).ConfigureAwait(false);

        Assert.Equal(1, result.ImportedCount);
        Assert.Equal(0, result.SkippedCount);
        Assert.Equal(0, result.DuplicatedCount);
        var replaced = await noteService.GetNoteAsync("n1").ConfigureAwait(false);
        Assert.Equal("Incoming", replaced?.Title);
        var all = await noteService.GetAllNotesAsync().ConfigureAwait(false);
        Assert.Single(all);
    }

    private static async Task<(NotesMnemoPayloadHandler Handler, INoteService NoteService, INoteFolderService FolderService)> CreateHandlerWithExistingItemsAsync()
    {
        var noteService = new InMemoryNoteService();
        var folderService = new InMemoryFolderService();
        await noteService.SaveNoteAsync(new Note { NoteId = "n1", Title = "Existing" }).ConfigureAwait(false);
        await folderService.SaveFolderAsync(new NoteFolder { FolderId = "f1", Name = "Existing" }).ConfigureAwait(false);
        return (new NotesMnemoPayloadHandler(noteService, folderService), noteService, folderService);
    }

    private static MnemoPayloadImportContext BuildContext(byte[] bytes, ImportConflictPolicy policy) => new()
    {
        Entry = new MnemoPackageEntry { PayloadType = "notes", Path = "payloads/notes" },
        Options = new MnemoPackageImportOptions { ConflictPolicy = policy },
        Files = new Dictionary<string, byte[]> { ["notes.db"] = bytes }
    };

    private static byte[] BuildNotesDb(IReadOnlyList<Note> notes, IReadOnlyList<NoteFolder> folders)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"test-notes-{Guid.NewGuid():N}.db");
        try
        {
            using (var connection = new SqliteConnection($"Data Source={tempPath}"))
            {
                connection.Open();
                using var create = connection.CreateCommand();
                create.CommandText = """
                                     CREATE TABLE Notes (NoteId TEXT PRIMARY KEY, Json TEXT NOT NULL);
                                     CREATE TABLE Folders (FolderId TEXT PRIMARY KEY, Json TEXT NOT NULL);
                                     """;
                create.ExecuteNonQuery();

                foreach (var note in notes)
                {
                    using var cmd = connection.CreateCommand();
                    cmd.CommandText = "INSERT INTO Notes (NoteId, Json) VALUES ($id, $json)";
                    cmd.Parameters.AddWithValue("$id", note.NoteId);
                    cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(note));
                    cmd.ExecuteNonQuery();
                }

                foreach (var folder in folders)
                {
                    using var cmd = connection.CreateCommand();
                    cmd.CommandText = "INSERT INTO Folders (FolderId, Json) VALUES ($id, $json)";
                    cmd.Parameters.AddWithValue("$id", folder.FolderId);
                    cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(folder));
                    cmd.ExecuteNonQuery();
                }
            }

            SqliteConnection.ClearAllPools();
            return File.ReadAllBytes(tempPath);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }

    private sealed class InMemoryNoteService : INoteService
    {
        private readonly Dictionary<string, Note> _notes = new(StringComparer.Ordinal);

        public Task<IEnumerable<Note>> GetAllNotesAsync() => Task.FromResult<IEnumerable<Note>>(_notes.Values.ToArray());

        public Task<Note?> GetNoteAsync(string noteId)
            => Task.FromResult(_notes.TryGetValue(noteId, out var note) ? note : null);

        public Task<Result> SaveNoteAsync(Note note)
        {
            _notes[note.NoteId] = note;
            return Task.FromResult(Result.Success());
        }

        public Task<Result> DeleteNoteAsync(string noteId)
        {
            _notes.Remove(noteId);
            return Task.FromResult(Result.Success());
        }
    }

    private sealed class InMemoryFolderService : INoteFolderService
    {
        private readonly Dictionary<string, NoteFolder> _folders = new(StringComparer.Ordinal);

        public Task<IEnumerable<NoteFolder>> GetAllFoldersAsync()
            => Task.FromResult<IEnumerable<NoteFolder>>(_folders.Values.ToArray());

        public Task<NoteFolder?> GetFolderAsync(string folderId)
            => Task.FromResult(_folders.TryGetValue(folderId, out var folder) ? folder : null);

        public Task<Result> SaveFolderAsync(NoteFolder folder)
        {
            _folders[folder.FolderId] = folder;
            return Task.FromResult(Result.Success());
        }

        public Task<Result> DeleteFolderAsync(string folderId)
        {
            _folders.Remove(folderId);
            return Task.FromResult(Result.Success());
        }
    }
}
