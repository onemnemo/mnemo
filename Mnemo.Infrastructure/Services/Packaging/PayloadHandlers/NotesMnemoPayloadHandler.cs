using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

public sealed class NotesMnemoPayloadHandler : IMnemoPayloadHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly INoteService _noteService;
    private readonly INoteFolderService _folderService;

    public NotesMnemoPayloadHandler(INoteService noteService, INoteFolderService folderService)
    {
        _noteService = noteService;
        _folderService = folderService;
    }

    public string PayloadType => "notes";

    public async Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default)
    {
        var notes = (await _noteService.GetAllNotesAsync().ConfigureAwait(false)).ToList();
        var folders = (await _folderService.GetAllFoldersAsync().ConfigureAwait(false)).ToList();
        var selectedNoteIds = ResolveSelectedNoteIds(context.Options);
        if (selectedNoteIds.Count > 0)
        {
            notes = notes.Where(n => selectedNoteIds.Contains(n.NoteId)).ToList();
            var usedFolderIds = new HashSet<string>(notes.Where(n => !string.IsNullOrWhiteSpace(n.FolderId)).Select(n => n.FolderId!), StringComparer.Ordinal);
            folders = folders.Where(f => usedFolderIds.Contains(f.FolderId)).ToList();
        }
        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        files["notes.db"] = BuildNotesSqlite(notes, folders);
        AddImageAssets(files);

        return new MnemoPayloadExportData
        {
            ItemCount = notes.Count,
            SchemaVersion = 1,
            Files = files
        };
    }

    public async Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
    {
        if (!context.Files.TryGetValue("notes.db", out var bytes))
            return new MnemoPayloadImportResult { Warnings = { "Notes payload missing notes.db file." } };

        var snapshot = ReadNotesSqlite(bytes);
        var existingNotes = (await _noteService.GetAllNotesAsync().ConfigureAwait(false)).ToDictionary(n => n.NoteId, StringComparer.Ordinal);
        var existingFolders = (await _folderService.GetAllFoldersAsync().ConfigureAwait(false)).ToDictionary(f => f.FolderId, StringComparer.Ordinal);

        var folderIdMap = new Dictionary<string, string>(StringComparer.Ordinal);
        var result = new MnemoPayloadImportResult();
        var policy = context.Options.ConflictPolicy;
        var usedTitles = new HashSet<string>(existingNotes.Values.Select(n => n.Title), StringComparer.OrdinalIgnoreCase);

        foreach (var folder in snapshot.Folders)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var imported = CloneFolder(folder);
            if (existingFolders.ContainsKey(imported.FolderId))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    folderIdMap[folder.FolderId] = imported.FolderId;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    imported.FolderId = Guid.NewGuid().ToString();
                    result.DuplicatedCount++;
                }
            }

            folderIdMap[folder.FolderId] = imported.FolderId;
            if (!string.IsNullOrWhiteSpace(imported.ParentId) && folderIdMap.TryGetValue(imported.ParentId, out var remappedParent))
                imported.ParentId = remappedParent;

            var save = await _folderService.SaveFolderAsync(imported).ConfigureAwait(false);
            if (!save.IsSuccess)
                result.Warnings.Add($"Failed to import folder '{folder.Name}': {save.ErrorMessage}");
        }

        foreach (var note in snapshot.Notes)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var imported = CloneNote(note);
            if (existingNotes.ContainsKey(imported.NoteId))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    result.SkippedCount++;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    imported.NoteId = Guid.NewGuid().ToString();
                    imported.Title = ImportNaming.NextAvailableName(imported.Title, usedTitles);
                    result.DuplicatedCount++;
                }
            }

            usedTitles.Add(imported.Title);
            if (!string.IsNullOrWhiteSpace(imported.FolderId) && folderIdMap.TryGetValue(imported.FolderId, out var remappedFolder))
                imported.FolderId = remappedFolder;

            var save = await _noteService.SaveNoteAsync(imported).ConfigureAwait(false);
            if (!save.IsSuccess)
            {
                result.Warnings.Add($"Failed to import note '{note.Title}': {save.ErrorMessage}");
                continue;
            }

            result.ImportedCount++;
        }

        RestoreImageAssets(context.Files);
        return result;
    }

    private static HashSet<string> ResolveSelectedNoteIds(MnemoPackageExportOptions options)
    {
        if (!options.PayloadOptions.TryGetValue("notes.noteIds", out var value))
            return new HashSet<string>(StringComparer.Ordinal);
        if (value is IEnumerable<string> ids)
            return new HashSet<string>(ids.Where(v => !string.IsNullOrWhiteSpace(v)), StringComparer.Ordinal);
        return new HashSet<string>(StringComparer.Ordinal);
    }

    private static Note CloneNote(Note note)
    {
        var json = JsonSerializer.Serialize(note, JsonOptions);
        return JsonSerializer.Deserialize<Note>(json, JsonOptions) ?? new Note();
    }

    private static NoteFolder CloneFolder(NoteFolder folder)
    {
        return new NoteFolder
        {
            FolderId = folder.FolderId,
            Name = folder.Name,
            ParentId = folder.ParentId,
            Order = folder.Order
        };
    }

    private static byte[] BuildNotesSqlite(IReadOnlyList<Note> notes, IReadOnlyList<NoteFolder> folders)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-notes-{Guid.NewGuid():N}.db");
        try
        {
            using (var connection = new SqliteConnection($"Data Source={tempPath}"))
            {
                connection.Open();
                using var cmd = connection.CreateCommand();
                cmd.CommandText = """
                                  CREATE TABLE IF NOT EXISTS Notes (
                                      NoteId TEXT PRIMARY KEY,
                                      Json TEXT NOT NULL
                                  );
                                  CREATE TABLE IF NOT EXISTS Folders (
                                      FolderId TEXT PRIMARY KEY,
                                      Json TEXT NOT NULL
                                  );
                                  """;
                cmd.ExecuteNonQuery();

                using var tx = connection.BeginTransaction();
                foreach (var note in notes)
                {
                    using var insert = connection.CreateCommand();
                    insert.Transaction = tx;
                    insert.CommandText = "INSERT OR REPLACE INTO Notes (NoteId, Json) VALUES ($id, $json)";
                    insert.Parameters.AddWithValue("$id", note.NoteId);
                    insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(note, JsonOptions));
                    insert.ExecuteNonQuery();
                }

                foreach (var folder in folders)
                {
                    using var insert = connection.CreateCommand();
                    insert.Transaction = tx;
                    insert.CommandText = "INSERT OR REPLACE INTO Folders (FolderId, Json) VALUES ($id, $json)";
                    insert.Parameters.AddWithValue("$id", folder.FolderId);
                    insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(folder, JsonOptions));
                    insert.ExecuteNonQuery();
                }

                tx.Commit();
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

    private static NoteSnapshot ReadNotesSqlite(byte[] dbBytes)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-notes-import-{Guid.NewGuid():N}.db");
        try
        {
            File.WriteAllBytes(tempPath, dbBytes);
            var snapshot = new NoteSnapshot();
            using var connection = new SqliteConnection($"Data Source={tempPath}");
            connection.Open();

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT Json FROM Notes";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var note = JsonSerializer.Deserialize<Note>(reader.GetString(0), JsonOptions);
                    if (note != null)
                        snapshot.Notes.Add(note);
                }
            }

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT Json FROM Folders";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var folder = JsonSerializer.Deserialize<NoteFolder>(reader.GetString(0), JsonOptions);
                    if (folder != null)
                        snapshot.Folders.Add(folder);
                }
            }

            SqliteConnection.ClearAllPools();
            return snapshot;
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }

    private static void AddImageAssets(IDictionary<string, byte[]> files)
    {
        var imageDir = MnemoAppPaths.GetImagesDirectory();
        if (!Directory.Exists(imageDir))
            return;

        foreach (var filePath in Directory.EnumerateFiles(imageDir, "*", SearchOption.TopDirectoryOnly))
        {
            var fileName = Path.GetFileName(filePath);
            files[$"assets/images/{fileName}"] = File.ReadAllBytes(filePath);
        }
    }

    private static void RestoreImageAssets(IReadOnlyDictionary<string, byte[]> files)
    {
        var imageDir = MnemoAppPaths.GetImagesDirectory();
        Directory.CreateDirectory(imageDir);
        foreach (var pair in files.Where(p => p.Key.StartsWith("assets/images/", StringComparison.OrdinalIgnoreCase)))
        {
            var fileName = Path.GetFileName(pair.Key.Replace('\\', '/'));
            if (string.IsNullOrWhiteSpace(fileName))
                continue;
            var destination = Path.Combine(imageDir, fileName);
            File.WriteAllBytes(destination, pair.Value);
        }
    }

    private sealed class NoteSnapshot
    {
        public List<Note> Notes { get; set; } = new();

        public List<NoteFolder> Folders { get; set; } = new();
    }
}
