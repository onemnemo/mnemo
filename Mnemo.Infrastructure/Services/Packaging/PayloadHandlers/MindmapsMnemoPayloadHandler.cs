using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// Reads/writes the mindmaps payload of a <c>.mnemo</c> package. The wire format is a SQLite database with
/// <c>Maps</c> (canonical document JSON + folder membership), <c>Folders</c>, and <c>Templates</c> tables,
/// plus referenced image assets under <c>assets/images/</c>. Maps stay portable: a snapshot of every
/// referenced user style template is embedded, while built-in templates (which ship with the app) are
/// referenced by id only.
/// </summary>
/// <remarks>
/// Import recreates each map verbatim, regenerating the map id only when it collides with a local map;
/// element short ids are document-local and are never rewritten. Restored assets skip files that already
/// exist, and a template whose id already exists locally is left untouched so imported data can never
/// overwrite the user's own templates.
/// </remarks>
public sealed class MindmapsMnemoPayloadHandler : IMnemoPayloadHandler
{
    private const string DatabaseFileName = "mindmaps.db";
    private const string AssetPrefix = "assets/images/";

    private readonly IMindmapService _mindmaps;
    private readonly IMindmapStore _store;
    private readonly ILoggerService _logger;

    public MindmapsMnemoPayloadHandler(IMindmapService mindmaps, IMindmapStore store, ILoggerService logger)
    {
        _mindmaps = mindmaps;
        _store = store;
        _logger = logger;
    }

    public string PayloadType => "mindmaps";

    public async Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default)
    {
        var library = await _mindmaps.GetLibraryAsync(cancellationToken).ConfigureAwait(false);
        var entries = library.IsSuccess && library.Value is not null
            ? library.Value
            : (IReadOnlyList<MindmapLibraryEntry>)Array.Empty<MindmapLibraryEntry>();

        var foldersResult = await _mindmaps.GetFoldersAsync(cancellationToken).ConfigureAwait(false);
        var allFolders = foldersResult.IsSuccess && foldersResult.Value is not null
            ? foldersResult.Value
            : (IReadOnlyList<MindmapFolder>)Array.Empty<MindmapFolder>();

        var selected = ResolveSelectedMapIds(context.Options);
        var chosen = selected.Count > 0
            ? entries.Where(e => selected.Contains(e.Document.Id)).ToList()
            : entries.ToList();

        var maps = new List<MapSnapshotDto>(chosen.Count);
        foreach (var entry in chosen)
        {
            cancellationToken.ThrowIfCancellationRequested();
            maps.Add(new MapSnapshotDto
            {
                Id = entry.Document.Id,
                FolderId = entry.FolderId,
                Json = MindmapDocumentSerializer.Serialize(entry.Document),
            });
        }

        var folders = (selected.Count > 0 ? CollectReferencedFolders(chosen, allFolders) : allFolders)
            .Select(f => new FolderSnapshotDto { Id = f.Id, Name = f.Name, ParentId = f.ParentId, Order = f.Order })
            .ToList();

        var templates = await CollectUserTemplatesAsync(chosen, cancellationToken).ConfigureAwait(false);

        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase)
        {
            [DatabaseFileName] = BuildSqlite(maps, folders, templates),
        };
        AddImageAssets(files, chosen);

        return new MnemoPayloadExportData
        {
            ItemCount = maps.Count,
            SchemaVersion = 1,
            Files = files,
        };
    }

    public async Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
    {
        if (!context.Files.TryGetValue(DatabaseFileName, out var bytes))
            return new MnemoPayloadImportResult { Warnings = { "Mindmaps payload missing mindmaps.db file." } };

        var snapshot = ReadSqlite(bytes);
        var result = new MnemoPayloadImportResult();
        var policy = context.Options.ConflictPolicy;

        var listed = await _mindmaps.ListAsync(cancellationToken).ConfigureAwait(false);
        var existingMapIds = new HashSet<string>(
            listed.IsSuccess && listed.Value is not null ? listed.Value.Select(m => m.Id) : Enumerable.Empty<string>(),
            StringComparer.Ordinal);
        var usedTitles = new HashSet<string>(
            listed.IsSuccess && listed.Value is not null ? listed.Value.Select(m => m.Title) : Enumerable.Empty<string>(),
            StringComparer.OrdinalIgnoreCase);

        // Assets and templates come first so a restored map's asset/template references resolve immediately.
        RestoreImageAssets(context.Files);
        await RestoreTemplatesAsync(snapshot.Templates, cancellationToken).ConfigureAwait(false);
        var folderIdMap = await RestoreFoldersAsync(snapshot.Folders, policy, result, cancellationToken).ConfigureAwait(false);

        foreach (var map in snapshot.Maps)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var document = MindmapDocumentSerializer.Deserialize(map.Json);
            if (document is null)
            {
                result.Warnings.Add("Skipped a mindmap that failed to deserialize.");
                continue;
            }

            if (existingMapIds.Contains(document.Id))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    result.SkippedCount++;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    document = document with
                    {
                        Id = Guid.NewGuid().ToString(),
                        Title = ImportNaming.NextAvailableName(document.Title, usedTitles),
                    };
                    result.DuplicatedCount++;
                }
                // Replace keeps the id; the service stores it as the next revision of what is there.
            }

            existingMapIds.Add(document.Id);
            usedTitles.Add(document.Title);

            var folderId = map.FolderId;
            if (!string.IsNullOrWhiteSpace(folderId) && folderIdMap.TryGetValue(folderId, out var remapped))
                folderId = remapped;

            // Through the service, not the store. An import is a write like any other: it has to take the
            // per-map write gate so it cannot land in the middle of an edit batch, it has to move the
            // revision forward so an editor open on the map notices, and its result has to be recorded in
            // the change log so a batch composed before it is refused rather than rebased onto a document
            // that no longer resembles the one it was written against.
            var stored = await _mindmaps.ReplaceAsync(document, cancellationToken).ConfigureAwait(false);
            if (!stored.IsSuccess || stored.Value is null)
            {
                result.Warnings.Add($"Skipped mindmap '{document.Title}': {stored.ErrorMessage ?? "it could not be stored."}");
                continue;
            }

            if (!stored.Value.Success)
            {
                result.Warnings.Add($"Skipped mindmap '{document.Title}': {stored.Value.Error?.Message ?? "it failed validation."}");
                continue;
            }

            if (!string.IsNullOrWhiteSpace(folderId))
                await _mindmaps.MoveToFolderAsync(document.Id, folderId, cancellationToken).ConfigureAwait(false);

            result.ImportedCount++;
        }

        return result;
    }

    // ---- Export helpers -------------------------------------------------------------------------

    private static HashSet<string> ResolveSelectedMapIds(MnemoPackageExportOptions options)
    {
        if (options.PayloadOptions.TryGetValue("mindmaps.mapIds", out var value) && value is IEnumerable<string> ids)
            return new HashSet<string>(ids.Where(v => !string.IsNullOrWhiteSpace(v)), StringComparer.Ordinal);
        return new HashSet<string>(StringComparer.Ordinal);
    }

    // Every folder that a chosen map lives in, plus its ancestor chain, so the restored folder tree resolves.
    private static IReadOnlyList<MindmapFolder> CollectReferencedFolders(
        IReadOnlyList<MindmapLibraryEntry> chosen, IReadOnlyList<MindmapFolder> allFolders)
    {
        var byId = allFolders.ToDictionary(f => f.Id, StringComparer.Ordinal);
        var kept = new Dictionary<string, MindmapFolder>(StringComparer.Ordinal);
        foreach (var entry in chosen)
        {
            var folderId = entry.FolderId;
            while (!string.IsNullOrWhiteSpace(folderId) && byId.TryGetValue(folderId, out var folder) && kept.TryAdd(folder.Id, folder))
                folderId = folder.ParentId;
        }

        return kept.Values.ToList();
    }

    private async Task<IReadOnlyList<StyleTemplate>> CollectUserTemplatesAsync(
        IReadOnlyList<MindmapLibraryEntry> chosen, CancellationToken cancellationToken)
    {
        var referenced = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in chosen)
        {
            AddIfPresent(referenced, entry.Document.Canvas.DefaultTemplateId);
            foreach (var cluster in entry.Document.Clusters)
                AddIfPresent(referenced, cluster.TemplateId);
        }

        if (referenced.Count == 0)
            return Array.Empty<StyleTemplate>();

        // The store holds only user templates (built-ins live in code with ids like "dawn-classic", and are
        // referenced by id). Embedding the referenced ids present in the store therefore embeds exactly the
        // user templates a map depends on.
        var userTemplates = await _store.GetStyleTemplatesAsync(cancellationToken).ConfigureAwait(false);
        return userTemplates.Where(t => referenced.Contains(t.Id)).ToList();
    }

    private void AddImageAssets(IDictionary<string, byte[]> files, IReadOnlyList<MindmapLibraryEntry> chosen)
    {
        var imagesDirectory = MnemoAppPaths.GetImagesDirectory();
        foreach (var entry in chosen)
        {
            foreach (var assetId in ReferencedAssetIds(entry.Document))
            {
                var path = Path.IsPathRooted(assetId) ? assetId : Path.Combine(imagesDirectory, assetId);
                var fileName = Path.GetFileName(path);
                if (string.IsNullOrWhiteSpace(fileName))
                    continue;

                var key = AssetPrefix + fileName;
                if (files.ContainsKey(key))
                    continue;

                if (!File.Exists(path))
                {
                    // A gone asset must never fail the export; warn and continue.
                    _logger.Warning("Mindmap", $"Skipping missing image asset '{assetId}' while exporting map '{entry.Document.Id}'.");
                    continue;
                }

                files[key] = File.ReadAllBytes(path);
            }
        }
    }

    private static IEnumerable<string> ReferencedAssetIds(MindmapDocument document)
    {
        foreach (var element in document.Elements)
        {
            var assetId = element.Content switch
            {
                CanvasImageContent canvas => canvas.AssetId,
                ImageContent image => image.AssetId,
                _ => null,
            };
            if (!string.IsNullOrWhiteSpace(assetId))
                yield return assetId;
        }
    }

    // ---- Import helpers -------------------------------------------------------------------------

    private async Task RestoreTemplatesAsync(IReadOnlyList<StyleTemplate> templates, CancellationToken cancellationToken)
    {
        if (templates.Count == 0)
            return;

        var existing = new HashSet<string>(
            (await _store.GetStyleTemplatesAsync(cancellationToken).ConfigureAwait(false)).Select(t => t.Id),
            StringComparer.Ordinal);

        foreach (var template in templates)
        {
            cancellationToken.ThrowIfCancellationRequested();
            // Ids are preserved so a document's template cascade resolves; a local template of the same id
            // wins so imported data never overwrites the user's own template.
            if (!existing.Add(template.Id))
                continue;
            await _store.SaveStyleTemplateAsync(template, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<Dictionary<string, string>> RestoreFoldersAsync(
        IReadOnlyList<FolderSnapshotDto> folders,
        ImportConflictPolicy policy,
        MnemoPayloadImportResult result,
        CancellationToken cancellationToken)
    {
        var folderIdMap = new Dictionary<string, string>(StringComparer.Ordinal);
        if (folders.Count == 0)
            return folderIdMap;

        var existingResult = await _mindmaps.GetFoldersAsync(cancellationToken).ConfigureAwait(false);
        var existingIds = new HashSet<string>(
            existingResult.IsSuccess && existingResult.Value is not null ? existingResult.Value.Select(f => f.Id) : Enumerable.Empty<string>(),
            StringComparer.Ordinal);

        foreach (var folder in folders)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var id = folder.Id;
            if (existingIds.Contains(id))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    folderIdMap[folder.Id] = id;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    id = Guid.NewGuid().ToString();
                    result.DuplicatedCount++;
                }
            }

            var parentId = folder.ParentId;
            if (!string.IsNullOrWhiteSpace(parentId) && folderIdMap.TryGetValue(parentId, out var remappedParent))
                parentId = remappedParent;

            folderIdMap[folder.Id] = id;
            existingIds.Add(id);
            await _mindmaps.SaveFolderAsync(new MindmapFolder(id, folder.Name, parentId, folder.Order), cancellationToken).ConfigureAwait(false);
        }

        return folderIdMap;
    }

    private void RestoreImageAssets(IReadOnlyDictionary<string, byte[]> files)
    {
        string? imagesDirectory = null;
        foreach (var pair in files)
        {
            if (!pair.Key.StartsWith(AssetPrefix, StringComparison.OrdinalIgnoreCase))
                continue;

            var fileName = Path.GetFileName(pair.Key.Replace('\\', '/'));
            if (string.IsNullOrWhiteSpace(fileName))
                continue;

            if (imagesDirectory is null)
            {
                imagesDirectory = MnemoAppPaths.GetImagesDirectory();
                Directory.CreateDirectory(imagesDirectory);
            }

            var destination = Path.Combine(imagesDirectory, fileName);
            if (File.Exists(destination))
                continue; // never clobber a local asset

            File.WriteAllBytes(destination, pair.Value);
        }
    }

    private static void AddIfPresent(HashSet<string> set, string? id)
    {
        if (!string.IsNullOrWhiteSpace(id))
            set.Add(id);
    }

    // ---- SQLite wire format ---------------------------------------------------------------------

    private static byte[] BuildSqlite(
        IReadOnlyList<MapSnapshotDto> maps,
        IReadOnlyList<FolderSnapshotDto> folders,
        IReadOnlyList<StyleTemplate> templates)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-mindmaps-{Guid.NewGuid():N}.db");
        try
        {
            // Pooling is off so disposing the connection releases the temp file immediately (allowing the
            // read/delete below) without a process-global SqliteConnection.ClearAllPools(), which would
            // disrupt other stores' live connections when tests run in parallel.
            using (var connection = new SqliteConnection($"Data Source={tempPath};Pooling=False"))
            {
                connection.Open();
                using (var create = connection.CreateCommand())
                {
                    create.CommandText = """
                                         CREATE TABLE IF NOT EXISTS Maps (
                                             MapId TEXT PRIMARY KEY,
                                             FolderId TEXT NULL,
                                             Json TEXT NOT NULL
                                         );
                                         CREATE TABLE IF NOT EXISTS Folders (
                                             FolderId TEXT PRIMARY KEY,
                                             Json TEXT NOT NULL
                                         );
                                         CREATE TABLE IF NOT EXISTS Templates (
                                             TemplateId TEXT PRIMARY KEY,
                                             Json TEXT NOT NULL
                                         );
                                         """;
                    create.ExecuteNonQuery();
                }

                using var tx = connection.BeginTransaction();
                foreach (var map in maps)
                {
                    using var insert = connection.CreateCommand();
                    insert.Transaction = tx;
                    insert.CommandText = "INSERT OR REPLACE INTO Maps (MapId, FolderId, Json) VALUES ($id, $folder, $json)";
                    insert.Parameters.AddWithValue("$id", map.Id);
                    insert.Parameters.AddWithValue("$folder", (object?)map.FolderId ?? DBNull.Value);
                    insert.Parameters.AddWithValue("$json", map.Json);
                    insert.ExecuteNonQuery();
                }

                foreach (var folder in folders)
                {
                    using var insert = connection.CreateCommand();
                    insert.Transaction = tx;
                    insert.CommandText = "INSERT OR REPLACE INTO Folders (FolderId, Json) VALUES ($id, $json)";
                    insert.Parameters.AddWithValue("$id", folder.Id);
                    insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(folder, MindmapDocumentSerializer.Options));
                    insert.ExecuteNonQuery();
                }

                foreach (var template in templates)
                {
                    using var insert = connection.CreateCommand();
                    insert.Transaction = tx;
                    insert.CommandText = "INSERT OR REPLACE INTO Templates (TemplateId, Json) VALUES ($id, $json)";
                    insert.Parameters.AddWithValue("$id", template.Id);
                    insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(template, MindmapDocumentSerializer.Options));
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

    private MindmapSnapshot ReadSqlite(byte[] dbBytes)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-mindmaps-import-{Guid.NewGuid():N}.db");
        try
        {
            File.WriteAllBytes(tempPath, dbBytes);
            var snapshot = new MindmapSnapshot();
            using var connection = new SqliteConnection($"Data Source={tempPath};Pooling=False");
            connection.Open();

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT MapId, FolderId, Json FROM Maps";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    snapshot.Maps.Add(new MapSnapshotDto
                    {
                        Id = reader.GetString(0),
                        FolderId = reader.IsDBNull(1) ? null : reader.GetString(1),
                        Json = reader.GetString(2),
                    });
                }
            }

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT Json FROM Folders";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var folder = JsonSerializer.Deserialize<FolderSnapshotDto>(reader.GetString(0), MindmapDocumentSerializer.Options);
                    if (folder is not null)
                        snapshot.Folders.Add(folder);
                }
            }

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT Json FROM Templates";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var template = JsonSerializer.Deserialize<StyleTemplate>(reader.GetString(0), MindmapDocumentSerializer.Options);
                    if (template is not null)
                        snapshot.Templates.Add(template);
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

    private sealed class MindmapSnapshot
    {
        public List<MapSnapshotDto> Maps { get; } = new();

        public List<FolderSnapshotDto> Folders { get; } = new();

        public List<StyleTemplate> Templates { get; } = new();
    }

    private sealed class MapSnapshotDto
    {
        public string Id { get; set; } = string.Empty;

        public string? FolderId { get; set; }

        public string Json { get; set; } = string.Empty;
    }

    private sealed class FolderSnapshotDto
    {
        public string Id { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;

        public string? ParentId { get; set; }

        public int Order { get; set; }
    }
}
