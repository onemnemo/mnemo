using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.MindmapV2;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.MindmapV2.Persistence;

/// <summary>
/// SQLite-backed <see cref="IMindmapStore"/>. Holds one owned writer connection (WAL) guarded by a
/// single-writer semaphore so every save commits as one atomic transaction covering both the document
/// row and its FTS mirror rows; reads open short-lived pooled connections and run concurrently. Mirrors
/// the flashcard store's connection design.
/// </summary>
public sealed class MindmapStore : IMindmapStore, IAsyncDisposable
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
        cmd.CommandText = "SELECT Doc FROM Mindmaps WHERE Id = $id;";
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
        cmd.CommandText = "SELECT Id, Title, Revision, ModifiedAt FROM Mindmaps ORDER BY ModifiedAt DESC;";

        var results = new List<MindmapDocumentSummary>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            results.Add(new MindmapDocumentSummary
            {
                Id = reader.GetString(0),
                Title = reader.GetString(1),
                Revision = reader.GetInt64(2),
                ModifiedAt = ParseDate(reader.GetString(3)),
            });
        }

        return results;
    }

    public Task SaveAsync(MindmapDocument document, MindmapSearchDelta searchDelta, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await using (var upsert = writer.CreateCommand())
            {
                upsert.Transaction = tx;
                upsert.CommandText = """
                    INSERT INTO Mindmaps (Id, Title, SchemaVersion, Revision, Doc, CreatedAt, ModifiedAt)
                    VALUES ($id, $title, $schema, $revision, $doc, $created, $modified)
                    ON CONFLICT(Id) DO UPDATE SET
                        Title = excluded.Title,
                        SchemaVersion = excluded.SchemaVersion,
                        Revision = excluded.Revision,
                        Doc = excluded.Doc,
                        ModifiedAt = excluded.ModifiedAt;
                    """;
                upsert.Parameters.AddWithValue("$id", document.Id);
                upsert.Parameters.AddWithValue("$title", document.Title);
                upsert.Parameters.AddWithValue("$schema", document.SchemaVersion);
                upsert.Parameters.AddWithValue("$revision", document.Revision);
                upsert.Parameters.AddWithValue("$doc", MindmapDocumentSerializer.Serialize(document));
                upsert.Parameters.AddWithValue("$created", document.CreatedAt.ToString(DateFormat, CultureInfo.InvariantCulture));
                upsert.Parameters.AddWithValue("$modified", document.ModifiedAt.ToString(DateFormat, CultureInfo.InvariantCulture));
                await upsert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await ApplySearchDeltaAsync(writer, tx, document.Id, searchDelta, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task DeleteAsync(string id, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = """
                DELETE FROM MindmapSearch WHERE MapId = $id;
                DELETE FROM Mindmaps WHERE Id = $id;
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
        cmd.CommandText = """
            SELECT ElementId, Text FROM MindmapSearch
            WHERE MapId = $map AND Text MATCH $q
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
            await using var remove = writer.CreateCommand();
            remove.Transaction = tx;
            remove.CommandText = "DELETE FROM MindmapSearch WHERE MapId = $map AND ElementId = $element;";
            var mapParam = remove.Parameters.Add("$map", SqliteType.Text);
            var elementParam = remove.Parameters.Add("$element", SqliteType.Text);
            mapParam.Value = mapId;

            foreach (var removedId in delta.Removed)
            {
                elementParam.Value = removedId;
                await remove.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            foreach (var entry in delta.Upserts)
            {
                elementParam.Value = entry.ElementId;
                await remove.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }
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

    private async Task WriteAsync(Func<SqliteConnection, SqliteTransaction, Task> write, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var writer = _writer ?? throw new InvalidOperationException("Mindmap store writer connection is not available.");
            await using var tx = (SqliteTransaction)await writer.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await write(writer, tx).ConfigureAwait(false);
                await tx.CommitAsync(cancellationToken).ConfigureAwait(false);
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

    private static async Task ApplyPragmasAsync(SqliteConnection connection, bool isWriter, CancellationToken cancellationToken)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = isWriter
            ? "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;"
            : "PRAGMA busy_timeout=5000;";
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

        await using var insert = writer.CreateCommand();
        insert.CommandText = "INSERT OR IGNORE INTO MindmapSchemaVersion (Version, AppliedAt) VALUES ($v, $at);";
        insert.Parameters.AddWithValue("$v", MindmapStoreSchema.TargetVersion);
        insert.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString(DateFormat, CultureInfo.InvariantCulture));
        await insert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
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

    private static DateTime ParseDate(string value) =>
        DateTime.Parse(value, CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind);

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
