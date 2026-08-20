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
        AddImageAssets(files, notes);

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
            return new MnemoPayloadImportResult { Warnings = { TransferWarning.Of("NotesPayloadMissingFile") } };

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
                result.Warnings.Add(TransferWarning.Of("NoteFolderImportFailed", ("folderName", folder.Name), ("error", save.ErrorMessage ?? string.Empty)));
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
                result.Warnings.Add(TransferWarning.Of("NoteImportFailed", ("noteTitle", note.Title), ("error", save.ErrorMessage ?? string.Empty)));
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
            // Pooling is off so disposing the connection releases the temp file immediately (allowing the
            // read/delete below) without a process-global SqliteConnection.ClearAllPools(), which would
            // disrupt other stores' live connections. Matches the mindmap and flashcard payload writers.
            using (var connection = new SqliteConnection($"Data Source={tempPath};Pooling=False"))
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
            // Pooling off for the same reason the writer above has it off: the temp file has to be
            // deletable the moment this connection is disposed, without a process wide pool clear.
            using var connection = new SqliteConnection($"Data Source={tempPath};Pooling=False");
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

    private const string AttachmentPrefix = "attachment:";

    /// <summary>Marks a cover that names an uploaded image rather than a preset banner.</summary>
    private const string CoverAssetPrefix = "asset:";

    private const string NoteAssetsArchivePrefix = "assets/note-assets/";

    private const string LegacyImagesArchivePrefix = "assets/images/";

    /// <summary>
    /// Bundles only the images the exported notes actually reference, from both the web host's
    /// note-owned <c>note-assets/</c> store and the legacy shared <c>images/</c> directory.
    /// <para>
    /// The old behaviour dumped every file in <c>images/</c> regardless of selection, which both
    /// leaked unrelated flashcard and mindmap images into a notes package and missed the newer
    /// managed store entirely, so any web-uploaded note image was silently lost on the round trip.
    /// Walking references fixes both: nothing unrelated is carried, and every era of reference is
    /// resolved to its real file.
    /// </para>
    /// </summary>
    private static void AddImageAssets(IDictionary<string, byte[]> files, IReadOnlyList<Note> notes)
    {
        var references = new HashSet<string>(StringComparer.Ordinal);
        foreach (var note in notes)
            CollectNoteReferences(note, references);
        if (references.Count == 0)
            return;

        var noteAssetsDir = MnemoAppPaths.GetNoteAssetsDirectory();
        var imagesDir = MnemoAppPaths.GetImagesDirectory();

        foreach (var reference in references)
        {
            if (ResolveAssetFile(reference, noteAssetsDir, imagesDir) is not { } asset)
                continue;
            // Two references can resolve to one file (a managed id and an attachment: form of the
            // same guid); the first write wins and the rest are the same bytes anyway.
            if (!files.ContainsKey(asset.ArchivePath))
                files[asset.ArchivePath] = File.ReadAllBytes(asset.SourcePath);
        }
    }

    /// <summary>
    /// Every field of a note that can name a stored image: its blocks, and a cover that names an
    /// uploaded one. A field missed here exports as a live reference with no file behind it, so
    /// the imported note points at an image the package never carried.
    /// </summary>
    private static void CollectNoteReferences(Note note, HashSet<string> into)
    {
        CollectImageReferences(note.Blocks, into);
        if (CoverAssetId(note.Cover) is { } cover)
            into.Add(cover);
    }

    /// <summary>The asset id an uploaded cover names, or null for a preset, which stores no file.</summary>
    private static string? CoverAssetId(string? cover)
    {
        if (cover is null || !cover.StartsWith(CoverAssetPrefix, StringComparison.OrdinalIgnoreCase))
            return null;
        var id = cover[CoverAssetPrefix.Length..];
        return string.IsNullOrWhiteSpace(id) ? null : id;
    }

    private static void CollectImageReferences(IReadOnlyList<Block>? blocks, HashSet<string> into)
    {
        if (blocks is null)
            return;

        foreach (var block in blocks)
        {
            if (block.Payload is ImagePayload image && !string.IsNullOrWhiteSpace(image.Path))
                into.Add(image.Path!);
            CollectImageReferences(block.Children, into);
        }
    }

    /// <summary>
    /// The real file a stored image path points at, tagged with the archive entry it should be
    /// bundled under so import can send it back to the directory it came from. Null when the
    /// reference points at no managed file (a remote URL, or a file that is no longer on disk).
    /// </summary>
    private static ResolvedAsset? ResolveAssetFile(string reference, string noteAssetsDir, string imagesDir)
    {
        var path = reference.Trim();
        if (path.Length == 0)
            return null;

        // attachment:{guid}:{name} is the oldest shape, resolved by its filename or bare guid.
        if (path.StartsWith(AttachmentPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var rest = path[AttachmentPrefix.Length..];
            var end = rest.IndexOf(':');
            var guid = end >= 0 ? rest[..end] : rest;
            var name = end >= 0 ? rest[(end + 1)..] : string.Empty;
            return FindByFileName(name, noteAssetsDir, imagesDir)
                ?? FindByGuidStem(guid, noteAssetsDir, imagesDir);
        }

        // A desktop-era absolute path, bundled only when it lands inside a managed directory.
        if (Path.IsPathRooted(path))
        {
            if (MnemoAppPaths.IsPathUnderNoteAssetsDirectory(path) && File.Exists(path))
                return new ResolvedAsset(path, NoteAssetsArchivePrefix + Path.GetFileName(path));
            if (MnemoAppPaths.IsPathUnderImagesDirectory(path) && File.Exists(path))
                return new ResolvedAsset(path, LegacyImagesArchivePrefix + Path.GetFileName(path));
            return null;
        }

        // A URL or any other multi-segment or scheme-bearing reference is not a managed file.
        if (path.Contains('/') || path.Contains('\\') || path.Contains(':'))
            return null;

        // A bare managed asset id, in the note store first, then the legacy shared directory.
        return FindByFileName(path, noteAssetsDir, imagesDir);
    }

    private static ResolvedAsset? FindByFileName(string? name, string noteAssetsDir, string imagesDir)
    {
        if (string.IsNullOrWhiteSpace(name))
            return null;

        var fileName = Path.GetFileName(name);
        if (string.IsNullOrWhiteSpace(fileName))
            return null;

        var managed = Path.Combine(noteAssetsDir, fileName);
        if (File.Exists(managed))
            return new ResolvedAsset(managed, NoteAssetsArchivePrefix + fileName);

        var legacy = Path.Combine(imagesDir, fileName);
        if (File.Exists(legacy))
            return new ResolvedAsset(legacy, LegacyImagesArchivePrefix + fileName);

        return null;
    }

    private static ResolvedAsset? FindByGuidStem(string guid, string noteAssetsDir, string imagesDir)
    {
        if (string.IsNullOrWhiteSpace(guid))
            return null;

        var managed = FindFileByStem(noteAssetsDir, guid);
        if (managed != null)
            return new ResolvedAsset(managed, NoteAssetsArchivePrefix + Path.GetFileName(managed));

        var legacy = FindFileByStem(imagesDir, guid);
        if (legacy != null)
            return new ResolvedAsset(legacy, LegacyImagesArchivePrefix + Path.GetFileName(legacy));

        return null;
    }

    /// <summary>The first file in <paramref name="dir"/> whose name (with or without extension) is the guid.</summary>
    private static string? FindFileByStem(string dir, string guid)
    {
        if (!Directory.Exists(dir))
            return null;

        foreach (var file in Directory.EnumerateFiles(dir, "*", SearchOption.TopDirectoryOnly))
        {
            var name = Path.GetFileName(file);
            if (string.Equals(name, guid, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(Path.GetFileNameWithoutExtension(file), guid, StringComparison.OrdinalIgnoreCase))
            {
                return file;
            }
        }

        return null;
    }

    private static void RestoreImageAssets(IReadOnlyDictionary<string, byte[]> files)
    {
        // Each set goes back to the directory it was collected from. Legacy packages only ever
        // carry the images/ prefix, so nothing new is required to keep reading them.
        RestoreArchivePrefix(files, NoteAssetsArchivePrefix, MnemoAppPaths.GetNoteAssetsDirectory());
        RestoreArchivePrefix(files, LegacyImagesArchivePrefix, MnemoAppPaths.GetImagesDirectory());
    }

    private static void RestoreArchivePrefix(IReadOnlyDictionary<string, byte[]> files, string prefix, string targetDir)
    {
        var matches = files.Where(p => p.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)).ToList();
        if (matches.Count == 0)
            return;

        Directory.CreateDirectory(targetDir);
        foreach (var pair in matches)
        {
            var fileName = Path.GetFileName(pair.Key.Replace('\\', '/'));
            if (string.IsNullOrWhiteSpace(fileName))
                continue;
            File.WriteAllBytes(Path.Combine(targetDir, fileName), pair.Value);
        }
    }

    private readonly record struct ResolvedAsset(string SourcePath, string ArchivePath);

    private sealed class NoteSnapshot
    {
        public List<Note> Notes { get; set; } = new();

        public List<NoteFolder> Folders { get; set; } = new();
    }
}
