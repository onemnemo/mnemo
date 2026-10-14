using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// The export half reads the real note assets directory, so this joins the collection that
/// owns the data-root override rather than resolving a live profile under test.
/// </summary>
[Collection(DataRootCollection.Name)]
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

    [Fact]
    public async Task InspectAsync_CountsNotesAlreadyInTheLibrary()
    {
        var (handler, noteService, _) = await CreateHandlerWithExistingItemsAsync().ConfigureAwait(false);
        var bytes = BuildNotesDb(
            [new Note { NoteId = "n1", Title = "Existing" }, new Note { NoteId = "n2", Title = "New" }],
            []);

        var evidence = await handler.InspectAsync(BuildContext(bytes, ImportConflictPolicy.KeepBoth)).ConfigureAwait(false);

        Assert.Equal(2, evidence.InPackage);
        Assert.Equal(1, evidence.AlreadyHere);
        Assert.Equal(1, evidence.NewHere);
        Assert.Equal(1, evidence.ReplaceWouldDiscard);
        Assert.Single(await noteService.GetAllNotesAsync().ConfigureAwait(false));
    }

    [Fact]
    public async Task InspectAsync_ReportsAPayloadFromANewerBuildAsUnreadable()
    {
        var (handler, _, _) = await CreateHandlerWithExistingItemsAsync().ConfigureAwait(false);
        var context = BuildContext(BuildNotesDb([new Note { NoteId = "n1", Title = "Existing" }], []), ImportConflictPolicy.KeepBoth);
        context.Entry.SchemaVersion = 2;

        var evidence = await handler.InspectAsync(context).ConfigureAwait(false);

        Assert.False(evidence.CanRead);
        Assert.Equal(0, evidence.AlreadyHere);
    }

    [Fact]
    public async Task ExportAsync_BundlesTheImageAnUploadedCoverNames()
    {
        // A cover is the only asset reference a note can carry outside its blocks, so an export
        // that only walked blocks would ship a live token with no file behind it.
        using var profile = new TempDataRoot();
        var bytes = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x42 };
        profile.WriteNoteAsset("cover-abc.png", bytes);
        var handler = CreateHandler(new Note { NoteId = "n1", Title = "Covered", Cover = "asset:cover-abc.png" });

        var data = await handler.ExportAsync(ExportContext()).ConfigureAwait(false);

        Assert.True(data.Files.ContainsKey("assets/note-assets/cover-abc.png"));
        Assert.Equal(bytes, data.Files["assets/note-assets/cover-abc.png"]);
    }

    [Fact]
    public async Task ExportAsync_CarriesNoAsset_ForAPresetCover()
    {
        using var profile = new TempDataRoot();
        profile.WriteNoteAsset("sunset", [1, 2, 3]);
        var handler = CreateHandler(new Note { NoteId = "n1", Title = "Preset", Cover = "sunset" });

        var data = await handler.ExportAsync(ExportContext()).ConfigureAwait(false);

        // A preset names a gradient, not a file. The file planted under the preset's own name
        // is the trap: an export that read any cover as an asset id would bundle it.
        Assert.Equal(new[] { "notes.db" }, data.Files.Keys.Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public async Task ExportAsync_CarriesNoAsset_WhenTheCoverFileIsGone()
    {
        using var profile = new TempDataRoot();
        var handler = CreateHandler(new Note { NoteId = "n1", Title = "Dangling", Cover = "asset:missing.png" });

        var data = await handler.ExportAsync(ExportContext()).ConfigureAwait(false);

        Assert.Equal(new[] { "notes.db" }, data.Files.Keys.Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public async Task ExportAsync_BundlesASharedImageWhereBuildsBeforeTheSharedDirectoryLook()
    {
        using var profile = new TempDataRoot();
        var png = Png(1);
        var name = ContentName(png);
        profile.WriteAsset(MnemoAppPaths.GetImageAssetsDirectory(), name, png);
        var handler = CreateHandler(new Note { NoteId = "n1", Title = "Shared", Cover = "asset:" + name });

        var data = await handler.ExportAsync(ExportContext()).ConfigureAwait(false);

        Assert.Equal(["assets/note-assets/" + name, "notes.db"], data.Files.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(png, data.Files["assets/note-assets/" + name]);
    }

    [Fact]
    public async Task ImportAsync_PlacesAContentNameInTheSharedDirectoryAndNeverOverwrites()
    {
        using var profile = new TempDataRoot();
        var png = Png(2);
        var shared = ContentName(png);
        var forged = ContentName(Png(3));
        profile.WriteAsset(MnemoAppPaths.GetNoteAssetsDirectory(), "old.png", [1]);
        var context = new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "notes", Path = "payloads/notes" },
            Options = new MnemoPackageImportOptions { ConflictPolicy = ImportConflictPolicy.KeepBoth },
            Files = new Dictionary<string, byte[]>
            {
                ["notes.db"] = BuildNotesDb([], []),
                ["assets/note-assets/" + shared] = png,
                ["assets/note-assets/" + forged] = Png(4),
                ["assets/note-assets/old.png"] = [2],
                ["assets/note-assets/new.png"] = [3],
            },
        };

        await CreateHandler().ImportAsync(context).ConfigureAwait(false);

        Assert.Equal(png, File.ReadAllBytes(Path.Combine(MnemoAppPaths.GetImageAssetsDirectory(), shared)));
        Assert.False(File.Exists(Path.Combine(MnemoAppPaths.GetNoteAssetsDirectory(), shared)));
        Assert.Equal(Png(4), File.ReadAllBytes(Path.Combine(MnemoAppPaths.GetNoteAssetsDirectory(), forged)));
        Assert.Equal(new byte[] { 1 }, File.ReadAllBytes(Path.Combine(MnemoAppPaths.GetNoteAssetsDirectory(), "old.png")));
        Assert.Equal(new byte[] { 3 }, File.ReadAllBytes(Path.Combine(MnemoAppPaths.GetNoteAssetsDirectory(), "new.png")));
    }

    private static byte[] Png(byte marker) => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, marker];

    private static string ContentName(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes)) + ".png";

    private static NotesMnemoPayloadHandler CreateHandler(params Note[] notes)
    {
        var noteService = new InMemoryNoteService();
        foreach (var note in notes)
            noteService.SaveNoteAsync(note).GetAwaiter().GetResult();
        return new NotesMnemoPayloadHandler(noteService, new InMemoryFolderService(), TestImages.Store());
    }

    private static MnemoPayloadExportContext ExportContext() => new() { Options = new MnemoPackageExportOptions() };

    /// <summary>
    /// A throwaway data root for the duration of a test, so an export that reads the note
    /// assets directory never touches the real profile. Restores the override and removes
    /// the directory on dispose.
    /// </summary>
    private sealed class TempDataRoot : IDisposable
    {
        private readonly string? _previous;
        private readonly string _root;

        public TempDataRoot()
        {
            _root = Path.Combine(Path.GetTempPath(), $"mnemo-export-{Guid.NewGuid():N}");
            Directory.CreateDirectory(_root);
            _previous = Environment.GetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable);
            Environment.SetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable, _root);
        }

        public void WriteNoteAsset(string fileName, byte[] bytes) =>
            WriteAsset(MnemoAppPaths.GetNoteAssetsDirectory(), fileName, bytes);

        public void WriteAsset(string dir, string fileName, byte[] bytes)
        {
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(Path.Combine(dir, fileName), bytes);
        }

        public void Dispose()
        {
            Environment.SetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable, _previous);
            try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
        }
    }

    private static async Task<(NotesMnemoPayloadHandler Handler, INoteService NoteService, INoteFolderService FolderService)> CreateHandlerWithExistingItemsAsync()
    {
        var noteService = new InMemoryNoteService();
        var folderService = new InMemoryFolderService();
        await noteService.SaveNoteAsync(new Note { NoteId = "n1", Title = "Existing" }).ConfigureAwait(false);
        await folderService.SaveFolderAsync(new NoteFolder { FolderId = "f1", Name = "Existing" }).ConfigureAwait(false);
        return (new NotesMnemoPayloadHandler(noteService, folderService, TestImages.Store()), noteService, folderService);
    }

    private static MnemoPayloadImportContext BuildContext(byte[] bytes, ImportConflictPolicy policy) => new()
    {
        Entry = new MnemoPackageEntry { PayloadType = "notes", Path = "payloads/notes" },
        Options = new MnemoPackageImportOptions { ConflictPolicy = policy },
        Files = new Dictionary<string, byte[]> { ["notes.db"] = bytes }
    };

    internal static byte[] BuildNotesDb(IReadOnlyList<Note> notes, IReadOnlyList<NoteFolder> folders)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"test-notes-{Guid.NewGuid():N}.db");
        try
        {
            // Pooling is off so disposing the connection releases the temp file for the read and
            // delete below, without a process wide pool clear that would disrupt other
            // collections' live connections.
            using (var connection = new SqliteConnection($"Data Source={tempPath};Pooling=False"))
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

    internal sealed class InMemoryNoteService : INoteService
    {
        private readonly Dictionary<string, Note> _notes = new(StringComparer.Ordinal);

        public Task<IEnumerable<Note>> GetAllNotesAsync() => Task.FromResult<IEnumerable<Note>>(_notes.Values.ToArray());

        public Task<IReadOnlyList<NoteSummary>> GetAllNoteSummariesAsync()
            => Task.FromResult<IReadOnlyList<NoteSummary>>([.. _notes.Values.Select(NoteSummary.FromNote)]);

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

    internal sealed class InMemoryFolderService : INoteFolderService
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
