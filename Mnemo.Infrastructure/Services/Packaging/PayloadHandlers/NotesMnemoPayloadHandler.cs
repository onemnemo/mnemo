using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Notes.Persistence;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

public sealed class NotesMnemoPayloadHandler : IMnemoPayloadHandler, IMnemoPayloadInspector
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>The layout this build writes and the newest one it reads.</summary>
    private const int PayloadSchemaVersion = 1;

    private readonly INoteService _noteService;
    private readonly INoteFolderService _folderService;
    private readonly INoteTrashStore? _trash;
    private readonly SharedImageStore _images;

    /// <summary>
    /// Builds the handler. <paramref name="trash"/> answers which note and folder ids the trash is
    /// holding; null means nothing can be held, as with services that keep no trash.
    /// </summary>
    public NotesMnemoPayloadHandler(INoteService noteService, INoteFolderService folderService, SharedImageStore images, INoteTrashStore? trash = null)
    {
        _noteService = noteService;
        _folderService = folderService;
        _images = images;
        _trash = trash;
    }

    public string PayloadType => "notes";

    public async Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default)
    {
        var notes = (await _noteService.GetAllNotesAsync().ConfigureAwait(false)).ToList();
        var folders = (await _folderService.GetAllFoldersAsync().ConfigureAwait(false)).ToList();
        var selectedNoteIds = ResolveIds(context.Options.PayloadOptions, MnemoPayloadOptionKeys.NoteIds);
        if (selectedNoteIds.Count > 0)
        {
            notes = notes.Where(n => selectedNoteIds.Contains(n.NoteId)).ToList();
            var keep = PackageFolderTree.Subtree(folders, f => f.FolderId, f => f.ParentId,
                ResolveIds(context.Options.PayloadOptions, MnemoPayloadOptionKeys.FolderIds));
            keep.UnionWith(notes.Where(n => !string.IsNullOrWhiteSpace(n.FolderId)).Select(n => n.FolderId!));
            folders = folders.Where(f => keep.Contains(f.FolderId)).ToList();
        }
        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        files["notes.db"] = BuildNotesSqlite(notes, folders);
        AddImageAssets(files, notes, _images.Directory);

        return new MnemoPayloadExportData
        {
            ItemCount = notes.Count,
            SchemaVersion = PayloadSchemaVersion,
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

        // The trash keeps a deleted note's or folder's id taken while the library no longer lists it,
        // and refuses a write under it. To the user that item is gone, so an incoming one under a held
        // id goes in under a fresh id, whatever the policy, and the held one stays in the trash.
        var heldNoteIds = await HeldIdsAsync(t => t.HeldNoteIdsAsync(cancellationToken)).ConfigureAwait(false);
        var heldFolderIds = await HeldIdsAsync(t => t.HeldFolderIdsAsync(cancellationToken)).ConfigureAwait(false);

        // An import into a folder never moves what is already there. Under KeepBoth a folder that
        // collides comes in as a copy; under Replace it is reused where it stands, and a replaced note
        // keeps its place.
        var targetFolderId = ImportExportOptionKeys.GetStringOption(context.Options.PayloadOptions, MnemoPayloadOptionKeys.TargetFolderId);
        var packageFolderIds = new HashSet<string>(snapshot.Folders.Select(f => f.FolderId), StringComparer.Ordinal);
        var packageNoteIds = new HashSet<string>(snapshot.Notes.Select(n => n.NoteId), StringComparer.Ordinal);

        foreach (var (folder, isRoot) in PackageFolderTree.ParentFirst(snapshot.Folders, f => f.FolderId, f => f.ParentId))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var imported = CloneFolder(folder);
            if (heldFolderIds.ContainsKey(imported.FolderId))
            {
                imported.FolderId = Guid.NewGuid().ToString();
            }
            else if (existingFolders.ContainsKey(imported.FolderId))
            {
                if (policy == ImportConflictPolicy.Skip || (policy == ImportConflictPolicy.Replace && targetFolderId is not null))
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
            if (isRoot)
            {
                if (targetFolderId is not null)
                    imported.ParentId = targetFolderId;
                else if (imported.ParentId is { } parent && packageFolderIds.Contains(parent))
                    imported.ParentId = null;
            }
            else if (!string.IsNullOrWhiteSpace(imported.ParentId) && folderIdMap.TryGetValue(imported.ParentId, out var remappedParent))
            {
                imported.ParentId = remappedParent;
            }

            var save = await _folderService.SaveFolderAsync(imported).ConfigureAwait(false);
            if (!save.IsSuccess)
                result.Warnings.Add(TransferWarning.Of("NoteFolderImportFailed", ("folderName", folder.Name), ("error", save.ErrorMessage ?? string.Empty)));
        }

        // Every note's id is settled before any is written, so a note that refers to another note in
        // the package follows it whichever of the two is stored first.
        var planned = new List<(Note Source, Note Imported)>(snapshot.Notes.Count);
        var noteIdMap = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var note in snapshot.Notes)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var imported = CloneNote(note);
            var keepsPlace = false;
            if (heldNoteIds.ContainsKey(imported.NoteId))
            {
                imported.NoteId = Guid.NewGuid().ToString();
            }
            else if (existingNotes.TryGetValue(imported.NoteId, out var existing))
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
                else if (targetFolderId is not null)
                {
                    imported.FolderId = existing.FolderId;
                    keepsPlace = true;
                }
            }

            usedTitles.Add(imported.Title);
            var loose = (string.IsNullOrWhiteSpace(note.FolderId) || !packageFolderIds.Contains(note.FolderId))
                        && (string.IsNullOrWhiteSpace(note.ParentNoteId) || !packageNoteIds.Contains(note.ParentNoteId));
            if (!keepsPlace)
            {
                if (loose && targetFolderId is not null)
                    imported.FolderId = targetFolderId;
                else if (!string.IsNullOrWhiteSpace(imported.FolderId) && folderIdMap.TryGetValue(imported.FolderId, out var remappedFolder))
                    imported.FolderId = remappedFolder;
            }

            if (!string.Equals(imported.NoteId, note.NoteId, StringComparison.Ordinal))
                noteIdMap[note.NoteId] = imported.NoteId;
            planned.Add((note, imported));
        }

        foreach (var (note, imported) in planned)
        {
            cancellationToken.ThrowIfCancellationRequested();
            PackageReferenceRewriter.RewriteNote(imported, noteIdMap);

            var save = await _noteService.SaveNoteAsync(imported).ConfigureAwait(false);
            if (!save.IsSuccess)
            {
                result.Warnings.Add(TransferWarning.Of("NoteImportFailed", ("noteTitle", note.Title), ("error", save.ErrorMessage ?? string.Empty)));
                continue;
            }

            // Published so the payloads keyed by note id can follow the note that moved. Recorded
            // only after the save, because an id nothing was written under points at no note.
            result.Remap(MnemoIdKinds.Notes, note.NoteId, imported.NoteId);
            result.ImportedCount++;
        }

        await RestoreImageAssetsAsync(context.Files, cancellationToken).ConfigureAwait(false);
        return result;
    }

    /// <summary>Counts package notes the library already has. Reads summaries only.</summary>
    public async Task<MnemoPayloadEvidence> InspectAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
    {
        var evidence = new MnemoPayloadEvidence
        {
            PayloadType = PayloadType,
            PayloadVersion = context.Entry.SchemaVersion,
            SupportedPayloadVersion = PayloadSchemaVersion,
            CanRead = context.Entry.SchemaVersion <= PayloadSchemaVersion,
        };
        if (!evidence.CanRead || !context.Files.TryGetValue("notes.db", out var bytes))
            return evidence;

        var packaged = ReadNotesSqlite(bytes).Notes.Select(n => n.NoteId).ToHashSet(StringComparer.Ordinal);
        evidence.InPackage = packaged.Count;
        foreach (var note in await _noteService.GetAllNoteSummariesAsync().ConfigureAwait(false))
        {
            if (packaged.Contains(note.NoteId))
                evidence.AlreadyHere++;
            else
                evidence.MissingFromPackage++;
        }

        evidence.NewHere = evidence.InPackage - evidence.AlreadyHere;
        evidence.ReplaceWouldDiscard = evidence.AlreadyHere;
        return evidence;
    }

    private async Task<IReadOnlyDictionary<string, string>> HeldIdsAsync(
        Func<INoteTrashStore, Task<IReadOnlyDictionary<string, string>>> read) =>
        _trash is null
            ? new Dictionary<string, string>(StringComparer.Ordinal)
            : await read(_trash).ConfigureAwait(false);

    private static HashSet<string> ResolveIds(IReadOnlyDictionary<string, object?> options, string key)
    {
        if (!options.TryGetValue(key, out var value) || value is null)
            return new HashSet<string>(StringComparer.Ordinal);
        if (value is IEnumerable<string> ids)
            return new HashSet<string>(ids.Where(v => !string.IsNullOrWhiteSpace(v)), StringComparer.Ordinal);
        throw new ArgumentException($"Payload option '{key}' must be a collection of ids.", nameof(options));
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

    private static void AddImageAssets(IDictionary<string, byte[]> files, IReadOnlyList<Note> notes, string sharedDir)
    {
        var references = new HashSet<string>(StringComparer.Ordinal);
        foreach (var note in notes)
            CollectNoteReferences(note, references);
        if (references.Count == 0)
            return;

        var dirs = new AssetDirectories(sharedDir, MnemoAppPaths.GetNoteAssetsDirectory(), MnemoAppPaths.GetImagesDirectory());

        foreach (var reference in references)
        {
            if (ResolveAssetFile(reference, dirs) is not { } asset)
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
    private static ResolvedAsset? ResolveAssetFile(string reference, AssetDirectories dirs)
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
            return FindByFileName(name, dirs)
                ?? FindByGuidStem(guid, dirs);
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

        return FindByFileName(path, dirs);
    }

    private static ResolvedAsset? FindByFileName(string? name, AssetDirectories dirs)
    {
        if (string.IsNullOrWhiteSpace(name))
            return null;

        var fileName = Path.GetFileName(name);
        if (string.IsNullOrWhiteSpace(fileName))
            return null;

        var shared = Path.Combine(dirs.Shared, fileName);
        if (File.Exists(shared))
            return new ResolvedAsset(shared, NoteAssetsArchivePrefix + fileName);

        var managed = Path.Combine(dirs.NoteAssets, fileName);
        if (File.Exists(managed))
            return new ResolvedAsset(managed, NoteAssetsArchivePrefix + fileName);

        var legacy = Path.Combine(dirs.Images, fileName);
        if (File.Exists(legacy))
            return new ResolvedAsset(legacy, LegacyImagesArchivePrefix + fileName);

        return null;
    }

    private static ResolvedAsset? FindByGuidStem(string guid, AssetDirectories dirs)
    {
        if (string.IsNullOrWhiteSpace(guid))
            return null;

        var managed = FindFileByStem(dirs.NoteAssets, guid);
        if (managed != null)
            return new ResolvedAsset(managed, NoteAssetsArchivePrefix + Path.GetFileName(managed));

        var legacy = FindFileByStem(dirs.Images, guid);
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

    private async Task RestoreImageAssetsAsync(IReadOnlyDictionary<string, byte[]> files, CancellationToken cancellationToken)
    {
        await RestoreArchivePrefixAsync(files, NoteAssetsArchivePrefix, MnemoAppPaths.GetNoteAssetsDirectory(), cancellationToken).ConfigureAwait(false);
        await RestoreArchivePrefixAsync(files, LegacyImagesArchivePrefix, MnemoAppPaths.GetImagesDirectory(), cancellationToken).ConfigureAwait(false);
    }

    private async Task RestoreArchivePrefixAsync(IReadOnlyDictionary<string, byte[]> files, string prefix, string targetDir, CancellationToken cancellationToken)
    {
        foreach (var pair in files.Where(p => p.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
        {
            var fileName = Path.GetFileName(pair.Key.Replace('\\', '/'));
            if (string.IsNullOrWhiteSpace(fileName))
                continue;
            if (await _images.RestoreAsync(fileName, pair.Value, cancellationToken).ConfigureAwait(false))
                continue;
            // A restore never overwrites a file this machine's notes already point at.
            Directory.CreateDirectory(targetDir);
            var target = Path.Combine(targetDir, fileName);
            if (!File.Exists(target))
                File.WriteAllBytes(target, pair.Value);
        }
    }

    private readonly record struct ResolvedAsset(string SourcePath, string ArchivePath);

    private readonly record struct AssetDirectories(string Shared, string NoteAssets, string Images);

    private sealed class NoteSnapshot
    {
        public List<Note> Notes { get; set; } = new();

        public List<NoteFolder> Folders { get; set; } = new();
    }
}
