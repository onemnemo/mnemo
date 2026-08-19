using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Mindmap.Persistence;

/// <summary>
/// SQLite-backed <see cref="IMindmapStore"/>. Holds one owned writer connection (WAL) guarded by a
/// single-writer semaphore so every save commits as one atomic transaction covering both the document
/// row and its FTS mirror rows; reads open short-lived pooled connections and run concurrently. Mirrors
/// the flashcard store's connection design.
/// </summary>
public sealed partial class MindmapStore : IMindmapStore, IAsyncDisposable
{
    private const string DateFormat = "O";

    private readonly string _connectionString;
    private readonly ILoggerService _logger;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly SemaphoreSlim _initGate = new(1, 1);

    private SqliteConnection? _writer;
    private bool _initialized;

    /// <param name="databasePath">Optional absolute DB path (tests). Defaults to app user data <c>mnemo.db</c>.</param>
    public MindmapStore(ILoggerService logger, string? databasePath = null)
    {
        _logger = logger;
        var dbPath = databasePath ?? MnemoAppPaths.GetLocalUserDataFile("mnemo.db");
        var dbDir = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrWhiteSpace(dbDir))
            Directory.CreateDirectory(dbDir);
        _connectionString = $"Data Source={dbPath}";
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (_initialized)
            return;

        await _initGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_initialized)
                return;

            var writer = new SqliteConnection(_connectionString);
            await writer.OpenAsync(cancellationToken).ConfigureAwait(false);
            await ApplyPragmasAsync(writer, isWriter: true, cancellationToken).ConfigureAwait(false);

            await using (var cmd = writer.CreateCommand())
            {
                cmd.CommandText = MindmapStoreSchema.CreateSql;
                await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await EnsureSchemaVersionAsync(writer, cancellationToken).ConfigureAwait(false);
            await ExecuteAsync(writer, MindmapStoreSchema.TrashIndexSql, cancellationToken).ConfigureAwait(false);

            _writer = writer;
            _initialized = true;
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Mindmap store initialization failed.", ex);
            throw;
        }
        finally
        {
            _initGate.Release();
        }
    }

    public async Task<MindmapDocument?> LoadAsync(string id, CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, isWriter: false, cancellationToken).ConfigureAwait(false);

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT Doc FROM Mindmaps WHERE Id = $id AND TrashId IS NULL;";
        cmd.Parameters.AddWithValue("$id", id);

        var json = (string?)await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        if (json is null)
            return null;

        return MindmapDocumentSerializer.Deserialize(json);
    }

    public async Task<IReadOnlyList<MindmapDocumentSummary>> ListAsync(CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, isWriter: false, cancellationToken).ConfigureAwait(false);

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT Id, Title, Revision, ModifiedAt FROM Mindmaps WHERE TrashId IS NULL ORDER BY ModifiedAt DESC;";

        var results = new List<MindmapDocumentSummary>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var id = reader.IsDBNull(0) ? null : reader.GetString(0);
            if (id is null)
                continue;

            results.Add(new MindmapDocumentSummary
            {
                Id = id,
                Title = reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                Revision = reader.IsDBNull(2) ? 0 : reader.GetInt64(2),
                ModifiedAt = ReadDate(reader, 3),
            });
        }

        return results;
    }

    public Task SaveAsync(MindmapDocument document, MindmapSearchDelta searchDelta, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            int applied;
            await using (var upsert = writer.CreateCommand())
            {
                upsert.Transaction = tx;
                // The guard on the update half is what stops an editor still open on a deleted map from
                // writing through the trash. It answers zero rows rather than failing, and the caller
                // has already been told the map is gone by the read that returned nothing.
                upsert.CommandText = """
                    INSERT INTO Mindmaps (Id, Title, SchemaVersion, Revision, Doc, CreatedAt, ModifiedAt)
                    VALUES ($id, $title, $schema, $revision, $doc, $created, $modified)
                    ON CONFLICT(Id) DO UPDATE SET
                        Title = excluded.Title,
                        SchemaVersion = excluded.SchemaVersion,
                        Revision = excluded.Revision,
                        Doc = excluded.Doc,
                        ModifiedAt = excluded.ModifiedAt
                    WHERE Mindmaps.TrashId IS NULL;
                    """;
                upsert.Parameters.AddWithValue("$id", document.Id);
                upsert.Parameters.AddWithValue("$title", document.Title);
                upsert.Parameters.AddWithValue("$schema", document.SchemaVersion);
                upsert.Parameters.AddWithValue("$revision", document.Revision);
                upsert.Parameters.AddWithValue("$doc", MindmapDocumentSerializer.Serialize(document));
                upsert.Parameters.AddWithValue("$created", document.CreatedAt.ToString(DateFormat, CultureInfo.InvariantCulture));
                upsert.Parameters.AddWithValue("$modified", document.ModifiedAt.ToString(DateFormat, CultureInfo.InvariantCulture));
                applied = await upsert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            // Nothing was written, so nothing is reindexed either: the mirror keeps the held map's rows
            // as they stood when it was deleted, ready for a restore.
            if (applied == 0)
                return;

            await ApplySearchDeltaAsync(writer, tx, document.Id, searchDelta, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task DeleteAsync(string id, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;
            // Live only, so a direct delete cannot destroy a map the trash is holding on someone's
            // behalf. Permanent deletion of a held map goes through the trash instead.
            cmd.CommandText = """
                DELETE FROM MindmapSearch WHERE MapId = $id
                    AND EXISTS (SELECT 1 FROM Mindmaps WHERE Id = $id AND TrashId IS NULL);
                DELETE FROM Mindmaps WHERE Id = $id AND TrashId IS NULL;
                """;
            cmd.Parameters.AddWithValue("$id", id);
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public async Task<IReadOnlyList<MindmapSearchHit>> SearchAsync(string mapId, string query, int limit, CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        var match = BuildMatchQuery(query);
        if (match is null)
            return Array.Empty<MindmapSearchHit>();

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, isWriter: false, cancellationToken).ConfigureAwait(false);

        await using var cmd = connection.CreateCommand();
        // The FTS mirror keeps a held map's rows so that restoring one does not have to rebuild the
        // index, so search joins the document row to answer only for a map the library still shows.
        cmd.CommandText = """
            SELECT s.ElementId, s.Text FROM MindmapSearch s
            JOIN Mindmaps m ON m.Id = s.MapId
            WHERE s.MapId = $map AND s.Text MATCH $q AND m.TrashId IS NULL
            LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$map", mapId);
        cmd.Parameters.AddWithValue("$q", match);
        cmd.Parameters.AddWithValue("$limit", limit <= 0 ? 50 : limit);

        var hits = new List<MindmapSearchHit>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            hits.Add(new MindmapSearchHit(reader.GetString(0), reader.GetString(1)));

        return hits;
    }

    // ---- Library organization (folders, folder membership, linked decks) ------------------------

    public async Task<IReadOnlyList<MindmapLibraryEntry>> GetLibraryAsync(CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, isWriter: false, cancellationToken).ConfigureAwait(false);

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT Doc, FolderId, LinkedDecksJson, Id FROM Mindmaps WHERE TrashId IS NULL;";

        var entries = new List<MindmapLibraryEntry>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            // One row the reader cannot make sense of costs the library that map, not the library. A
            // truncated write, a hand-edited database or a document from a build that stored a shape this
            // one cannot read would otherwise take down the gallery for every other map the user has.
            var document = TryReadDocument(reader);
            if (document is null)
                continue;

            entries.Add(new MindmapLibraryEntry
            {
                Document = document,
                FolderId = reader.IsDBNull(1) ? null : reader.GetString(1),
                LinkedDeckIds = reader.IsDBNull(2) ? Array.Empty<string>() : ParseDeckIds(reader.GetString(2)),
            });
        }

        return entries;
    }

    /// <summary>
    /// The document in the current row, or null when it cannot be read. Logged with the row's id so an
    /// unreadable map is findable rather than merely absent.
    /// </summary>
    private MindmapDocument? TryReadDocument(SqliteDataReader reader)
    {
        var id = reader.IsDBNull(3) ? "(no id)" : reader.GetString(3);
        try
        {
            if (reader.IsDBNull(0))
            {
                _logger.Warning("Mindmap", $"Mindmap '{id}' has no stored document and was left out of the library.");
                return null;
            }

            var document = MindmapDocumentSerializer.Deserialize(reader.GetString(0));
            if (document is null)
                _logger.Warning("Mindmap", $"Mindmap '{id}' deserialized to nothing and was left out of the library.");
            return document;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or NotSupportedException)
        {
            _logger.Warning("Mindmap", $"Mindmap '{id}' could not be read and was left out of the library: {ex.Message}");
            return null;
        }
    }

    public async Task<IReadOnlyList<MindmapFolder>> GetFoldersAsync(CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, isWriter: false, cancellationToken).ConfigureAwait(false);

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT Id, Name, ParentId, SortOrder FROM MindmapFolders WHERE TrashId IS NULL ORDER BY SortOrder;";

        var folders = new List<MindmapFolder>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            folders.Add(new MindmapFolder(
                reader.GetString(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetInt32(3)));
        }

        return folders;
    }

    public Task SaveFolderAsync(MindmapFolder folder, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT INTO MindmapFolders (Id, ParentId, Name, SortOrder)
                VALUES ($id, $parent, $name, $order)
                ON CONFLICT(Id) DO UPDATE SET
                    ParentId = excluded.ParentId,
                    Name = excluded.Name,
                    SortOrder = excluded.SortOrder
                WHERE MindmapFolders.TrashId IS NULL;
                """;
            cmd.Parameters.AddWithValue("$id", folder.Id);
            cmd.Parameters.AddWithValue("$parent", (object?)folder.ParentId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$name", folder.Name);
            cmd.Parameters.AddWithValue("$order", folder.Order);
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task DeleteFolderAsync(string id, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            // The cascade below reaches held rows as readily as live ones, so anything the trash is
            // holding underneath moves out of its path first.
            await LiftHeldDescendantsAsync(writer, tx, id, cancellationToken).ConfigureAwait(false);

            // Subfolders cascade (FK); maps keep their now-dangling FolderId and surface at the root.
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM MindmapFolders WHERE Id = $id AND TrashId IS NULL;";
            cmd.Parameters.AddWithValue("$id", id);
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task SetFolderAsync(string mapId, string? folderId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE Mindmaps SET FolderId = $folder WHERE Id = $id AND TrashId IS NULL;";
            cmd.Parameters.AddWithValue("$id", mapId);
            cmd.Parameters.AddWithValue("$folder", (object?)folderId ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    // ---- User style templates (global, shared across all maps) -----------------------------------

    public async Task<IReadOnlyList<StyleTemplate>> GetStyleTemplatesAsync(CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, isWriter: false, cancellationToken).ConfigureAwait(false);

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT Json FROM MindmapStyleTemplates ORDER BY CreatedAt, Name;";

        var templates = new List<StyleTemplate>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var template = JsonSerializer.Deserialize<StyleTemplate>(reader.GetString(0), MindmapDocumentSerializer.Options);
            if (template is not null)
                templates.Add(template);
        }

        return templates;
    }

    public Task SaveStyleTemplateAsync(StyleTemplate template, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;
            // CreatedAt is set on insert only; the update path omits it so first-saved time is preserved.
            cmd.CommandText = """
                INSERT INTO MindmapStyleTemplates (Id, Name, Json, CreatedAt)
                VALUES ($id, $name, $json, $created)
                ON CONFLICT(Id) DO UPDATE SET
                    Name = excluded.Name,
                    Json = excluded.Json;
                """;
            cmd.Parameters.AddWithValue("$id", template.Id);
            cmd.Parameters.AddWithValue("$name", template.Name);
            cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(template, MindmapDocumentSerializer.Options));
            cmd.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToString(DateFormat, CultureInfo.InvariantCulture));
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task DeleteStyleTemplateAsync(string id, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM MindmapStyleTemplates WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", id);
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    private static IReadOnlyList<string> ParseDeckIds(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Array.Empty<string>();

        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? (IReadOnlyList<string>)Array.Empty<string>();
        }
        catch (JsonException)
        {
            return Array.Empty<string>();
        }
    }

    private static async Task ApplySearchDeltaAsync(
        SqliteConnection writer, SqliteTransaction tx, string mapId, MindmapSearchDelta delta, CancellationToken cancellationToken)
    {
        if (delta.FullReplace)
        {
            await using var clear = writer.CreateCommand();
            clear.Transaction = tx;
            clear.CommandText = "DELETE FROM MindmapSearch WHERE MapId = $map;";
            clear.Parameters.AddWithValue("$map", mapId);
            await clear.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
        else if (delta.Removed.Count > 0 || delta.Upserts.Count > 0)
        {
            // Upserted rows are cleared first so re-inserting yields a single current row per element.
            var stale = new List<string>(delta.Removed.Count + delta.Upserts.Count);
            stale.AddRange(delta.Removed);
            foreach (var entry in delta.Upserts)
                stale.Add(entry.ElementId);

            await ClearSearchRowsAsync(writer, tx, mapId, stale, cancellationToken).ConfigureAwait(false);
        }

        if (delta.Upserts.Count == 0)
            return;

        await using var insert = writer.CreateCommand();
        insert.Transaction = tx;
        insert.CommandText = "INSERT INTO MindmapSearch (MapId, ElementId, Text) VALUES ($map, $element, $text);";
        var insMap = insert.Parameters.Add("$map", SqliteType.Text);
        var insElement = insert.Parameters.Add("$element", SqliteType.Text);
        var insText = insert.Parameters.Add("$text", SqliteType.Text);
        insMap.Value = mapId;

        foreach (var entry in delta.Upserts)
        {
            insElement.Value = entry.ElementId;
            insText.Value = entry.Text;
            await insert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Drops the mirror rows for a set of elements, a chunk of ids per statement.
    /// <para>
    /// The mirror's MapId and ElementId are unindexed, so every delete reads the whole table. One
    /// statement per element therefore costs a scan per element, which is what made deleting a branch of
    /// a few thousand nodes take seconds. Naming many ids in one statement pays for one scan instead.
    /// </para>
    /// </summary>
    private static async Task ClearSearchRowsAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string mapId,
        IReadOnlyList<string> elementIds,
        CancellationToken cancellationToken)
    {
        // Well under SQLite's parameter ceiling, so the chunk count is the only thing that varies.
        const int ChunkSize = 400;

        for (var start = 0; start < elementIds.Count; start += ChunkSize)
        {
            var count = Math.Min(ChunkSize, elementIds.Count - start);
            var names = new string[count];

            await using var remove = writer.CreateCommand();
            remove.Transaction = tx;
            remove.Parameters.AddWithValue("$map", mapId);
            for (var i = 0; i < count; i++)
            {
                names[i] = $"$e{i}";
                remove.Parameters.AddWithValue(names[i], elementIds[start + i]);
            }

            remove.CommandText =
                $"DELETE FROM MindmapSearch WHERE MapId = $map AND ElementId IN ({string.Join(", ", names)});";
            await remove.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private Task WriteAsync(Func<SqliteConnection, SqliteTransaction, Task> write, CancellationToken cancellationToken) =>
        WriteAsync<object?>(async (writer, tx) =>
        {
            await write(writer, tx).ConfigureAwait(false);
            return null;
        }, cancellationToken);

    /// <summary>
    /// Runs one unit of work inside the store's single write transaction, on the store's own writer
    /// connection, and hands back what it produced.
    /// </summary>
    /// <remarks>
    /// The trash goes through here rather than opening a second writer, so taking a map and the
    /// content it carries is one commit that an ordinary save cannot interleave with.
    /// </remarks>
    private async Task<T> WriteAsync<T>(Func<SqliteConnection, SqliteTransaction, Task<T>> write, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var writer = _writer ?? throw new InvalidOperationException("Mindmap store writer connection is not available.");
            await using var tx = (SqliteTransaction)await writer.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var result = await write(writer, tx).ConfigureAwait(false);
                await tx.CommitAsync(cancellationToken).ConfigureAwait(false);
                return result;
            }
            catch
            {
                await tx.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
                throw;
            }
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>Runs one read on a short lived pooled connection with the store's pragmas applied.</summary>
    private async Task<T> ReadAsync<T>(Func<SqliteConnection, Task<T>> read, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, isWriter: false, cancellationToken).ConfigureAwait(false);
        return await read(connection).ConfigureAwait(false);
    }

    private static async Task ApplyPragmasAsync(SqliteConnection connection, bool isWriter, CancellationToken cancellationToken)
    {
        await using var cmd = connection.CreateCommand();
        // foreign_keys must be on per connection so MindmapFolders' ON DELETE CASCADE fires.
        cmd.CommandText = isWriter
            ? "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"
            : "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;";
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureSchemaVersionAsync(SqliteConnection writer, CancellationToken cancellationToken)
    {
        await using var check = writer.CreateCommand();
        check.CommandText = "SELECT MAX(Version) FROM MindmapSchemaVersion;";
        var current = await check.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        var version = current is null || current == DBNull.Value ? 0 : Convert.ToInt32(current);
        if (version >= MindmapStoreSchema.TargetVersion)
            return;

        // v1 → v2: add the library columns to an existing Mindmaps table (the folders table and any
        // fresh table already carry them via CreateSql). Guarded so re-runs are safe.
        if (!await ColumnExistsAsync(writer, "Mindmaps", "FolderId", cancellationToken).ConfigureAwait(false))
            await ExecuteAsync(writer, MindmapStoreSchema.AddFolderIdColumnSql, cancellationToken).ConfigureAwait(false);
        if (!await ColumnExistsAsync(writer, "Mindmaps", "LinkedDecksJson", cancellationToken).ConfigureAwait(false))
            await ExecuteAsync(writer, MindmapStoreSchema.AddLinkedDecksColumnSql, cancellationToken).ConfigureAwait(false);

        // v3 → v4: the trash column on both tables. Existing rows get NULL, which is what live means,
        // so an upgraded library reads exactly as it did before.
        if (!await ColumnExistsAsync(writer, "Mindmaps", "TrashId", cancellationToken).ConfigureAwait(false))
            await ExecuteAsync(writer, MindmapStoreSchema.AddMapTrashIdColumnSql, cancellationToken).ConfigureAwait(false);
        if (!await ColumnExistsAsync(writer, "MindmapFolders", "TrashId", cancellationToken).ConfigureAwait(false))
            await ExecuteAsync(writer, MindmapStoreSchema.AddFolderTrashIdColumnSql, cancellationToken).ConfigureAwait(false);

        await using var insert = writer.CreateCommand();
        insert.CommandText = "INSERT OR IGNORE INTO MindmapSchemaVersion (Version, AppliedAt) VALUES ($v, $at);";
        insert.Parameters.AddWithValue("$v", MindmapStoreSchema.TargetVersion);
        insert.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString(DateFormat, CultureInfo.InvariantCulture));
        await insert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<bool> ColumnExistsAsync(SqliteConnection connection, string table, string column, CancellationToken cancellationToken)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({table});";
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            // table_info column 1 is the column name.
            if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static async Task ExecuteAsync(SqliteConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Turns a user query into a safe FTS5 MATCH expression: each whitespace token becomes a quoted phrase
    /// (embedded quotes doubled) joined by implicit AND, so punctuation can never break FTS5 syntax.
    /// Returns null when the query has no searchable tokens.
    /// </summary>
    private static string? BuildMatchQuery(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
            return null;

        var tokens = query.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);

        var builder = new StringBuilder();
        foreach (var token in tokens)
        {
            // Skip pure-punctuation tokens: the FTS5 tokenizer would reduce them to an empty phrase.
            if (!ContainsLetterOrDigit(token))
                continue;

            if (builder.Length > 0)
                builder.Append(' ');
            builder.Append('"').Append(token.Replace("\"", "\"\"")).Append('"');
        }

        return builder.Length == 0 ? null : builder.ToString();
    }

    private static bool ContainsLetterOrDigit(string token)
    {
        foreach (var c in token)
        {
            if (char.IsLetterOrDigit(c))
                return true;
        }

        return false;
    }

    /// <summary>
    /// The timestamp in a column, or <see cref="DateTime.MinValue"/> when it is absent or unparseable. A
    /// header list sorts and labels by this; a map with a damaged timestamp belongs at the bottom of the
    /// list, not missing from it.
    /// </summary>
    private static DateTime ReadDate(SqliteDataReader reader, int ordinal)
    {
        if (reader.IsDBNull(ordinal))
            return DateTime.MinValue;

        return DateTime.TryParse(
            reader.GetString(ordinal),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out var parsed)
            ? parsed
            : DateTime.MinValue;
    }

    public async ValueTask DisposeAsync()
    {
        if (_writer is not null)
        {
            await _writer.DisposeAsync().ConfigureAwait(false);
            _writer = null;
        }

        _writeGate.Dispose();
        _initGate.Dispose();
    }
}
