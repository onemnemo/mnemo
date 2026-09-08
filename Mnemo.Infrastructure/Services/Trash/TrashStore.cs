using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// SQLite-backed <see cref="ITrashStore"/>.
/// </summary>
/// <remarks>
/// Every write here is a single statement, which SQLite commits atomically on its own. That is
/// deliberate: the delete protocol needs its ledger step and its source step to commit separately,
/// so an interrupted operation leaves a state reconciliation can read rather than a lost row.
/// </remarks>
public sealed class TrashStore : ITrashStore
{
    private const int ReadChunkSize = 400;
    private const int InsertChunkSize = 80;
    private const int PromoteChunkSize = 150;
    private const string Columns =
        "Id, Kind, ItemId, Title, Origin, ContainedCount, BatchId, State, DeletedAt, ExpiresAt";

    private readonly TrashDatabase _database;

    /// <param name="database">The shared trash tables.</param>
    public TrashStore(TrashDatabase database) => _database = database;

    /// <inheritdoc />
    public Task InitializeAsync(CancellationToken cancellationToken = default) =>
        _database.InitializeAsync(cancellationToken);

    /// <inheritdoc />
    public Task<TrashEntry?> FindByItemAsync(string kind, string itemId, CancellationToken cancellationToken = default) =>
        QuerySingleAsync(
            $"SELECT {Columns} FROM TrashEntries WHERE Kind = $kind AND ItemId = $itemId;",
            cmd =>
            {
                cmd.Parameters.AddWithValue("$kind", kind);
                cmd.Parameters.AddWithValue("$itemId", itemId);
            },
            cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<string, TrashEntry>> FindByItemsAsync(
        string kind,
        IReadOnlyCollection<string> itemIds,
        CancellationToken cancellationToken = default)
    {
        var ids = new List<string>(itemIds);
        var found = new Dictionary<string, TrashEntry>(StringComparer.Ordinal);
        for (var offset = 0; offset < ids.Count; offset += ReadChunkSize)
        {
            var take = Math.Min(ReadChunkSize, ids.Count - offset);
            var names = new List<string>(take);
            var rows = await _database.QueryAsync(
                BuildInQuery($"SELECT {Columns} FROM TrashEntries WHERE Kind = $kind AND ItemId IN (", ids, offset, take, names),
                cmd =>
                {
                    cmd.Parameters.AddWithValue("$kind", kind);
                    BindIds(cmd, ids, offset, take);
                },
                ReadEntry,
                cancellationToken).ConfigureAwait(false);
            foreach (var row in rows)
                found[row.ItemId] = row;
        }

        return found;
    }

    /// <inheritdoc />
    public Task<TrashEntry?> GetAsync(string entryId, CancellationToken cancellationToken = default) =>
        QuerySingleAsync(
            $"SELECT {Columns} FROM TrashEntries WHERE Id = $id;",
            cmd => cmd.Parameters.AddWithValue("$id", entryId),
            cancellationToken);

    /// <inheritdoc />
    public Task InsertAsync(TrashEntry entry, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return _database.ExecuteAsync(
            $"INSERT INTO TrashEntries ({Columns}) VALUES " +
            "($id, $kind, $itemId, $title, $origin, $contained, $batch, $state, $deletedAt, $expiresAt);",
            cmd =>
            {
                cmd.Parameters.AddWithValue("$id", entry.Id);
                cmd.Parameters.AddWithValue("$kind", entry.Kind);
                cmd.Parameters.AddWithValue("$itemId", entry.ItemId);
                cmd.Parameters.AddWithValue("$title", entry.Title);
                cmd.Parameters.AddWithValue("$origin", (object?)entry.Origin ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$contained", entry.ContainedCount);
                cmd.Parameters.AddWithValue("$batch", entry.BatchId);
                cmd.Parameters.AddWithValue("$state", ToText(entry.State));
                cmd.Parameters.AddWithValue("$deletedAt", SqlTime.Write(entry.DeletedAt));
                cmd.Parameters.AddWithValue("$expiresAt", SqlTime.Write(entry.ExpiresAt));
            },
            cancellationToken);
    }

    /// <inheritdoc />
    public async Task InsertManyAsync(
        IReadOnlyCollection<TrashEntry> entries,
        CancellationToken cancellationToken = default)
    {
        var rows = new List<TrashEntry>(entries);
        for (var offset = 0; offset < rows.Count; offset += InsertChunkSize)
        {
            var take = Math.Min(InsertChunkSize, rows.Count - offset);
            var values = new List<string>(take);
            await _database.ExecuteAsync(
                BuildInsert(take, values),
                cmd => BindEntries(cmd, rows, offset, take),
                cancellationToken).ConfigureAwait(false);
        }
    }

    /// <inheritdoc />
    public Task PromoteAsync(string entryId, TrashSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return _database.ExecuteAsync(
            "UPDATE TrashEntries SET State = $state, Title = $title, Origin = $origin, " +
            "ContainedCount = $contained WHERE Id = $id;",
            cmd =>
            {
                cmd.Parameters.AddWithValue("$state", ToText(TrashEntryState.Held));
                cmd.Parameters.AddWithValue("$title", snapshot.Title);
                cmd.Parameters.AddWithValue("$origin", (object?)snapshot.Origin ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$contained", snapshot.ContainedCount);
                cmd.Parameters.AddWithValue("$id", entryId);
            },
            cancellationToken);
    }

    /// <inheritdoc />
    public async Task PromoteManyAsync(
        IReadOnlyDictionary<string, TrashSnapshot> snapshotsByEntry,
        CancellationToken cancellationToken = default)
    {
        var rows = new List<KeyValuePair<string, TrashSnapshot>>(snapshotsByEntry);
        for (var offset = 0; offset < rows.Count; offset += PromoteChunkSize)
        {
            var take = Math.Min(PromoteChunkSize, rows.Count - offset);
            await _database.ExecuteAsync(
                BuildPromotion(rows, offset, take),
                cmd => BindPromotions(cmd, rows, offset, take),
                cancellationToken).ConfigureAwait(false);
        }
    }

    /// <inheritdoc />
    public Task SetStateAsync(string entryId, TrashEntryState state, CancellationToken cancellationToken = default) =>
        _database.ExecuteAsync(
            "UPDATE TrashEntries SET State = $state WHERE Id = $id;",
            cmd =>
            {
                cmd.Parameters.AddWithValue("$state", ToText(state));
                cmd.Parameters.AddWithValue("$id", entryId);
            },
            cancellationToken);

    /// <inheritdoc />
    public Task RemoveAsync(string entryId, CancellationToken cancellationToken = default) =>
        _database.ExecuteAsync(
            "DELETE FROM TrashEntries WHERE Id = $id;",
            cmd => cmd.Parameters.AddWithValue("$id", entryId),
            cancellationToken);

    /// <inheritdoc />
    public async Task RemoveManyAsync(
        IReadOnlyCollection<string> entryIds,
        CancellationToken cancellationToken = default)
    {
        var ids = new List<string>(entryIds);
        for (var offset = 0; offset < ids.Count; offset += ReadChunkSize)
        {
            var take = Math.Min(ReadChunkSize, ids.Count - offset);
            var names = new List<string>(take);
            await _database.ExecuteAsync(
                BuildInQuery("DELETE FROM TrashEntries WHERE Id IN (", ids, offset, take, names),
                cmd => BindIds(cmd, ids, offset, take),
                cancellationToken).ConfigureAwait(false);
        }
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<TrashEntry>> ListHeldAsync(
        string? cursor,
        int limit,
        string? kind,
        string? query,
        CancellationToken cancellationToken = default)
    {
        var sql = new StringBuilder($"SELECT {Columns} FROM TrashEntries WHERE State = $state");
        var hasCursor = TrashCursor.TryDecode(cursor, out var cursorAt, out var cursorId);
        if (hasCursor)
            sql.Append(" AND (DeletedAt < $cursorAt OR (DeletedAt = $cursorAt AND Id < $cursorId))");
        if (!string.IsNullOrWhiteSpace(kind))
            sql.Append(" AND Kind = $kind");
        if (!string.IsNullOrWhiteSpace(query))
            sql.Append(" AND mnemo_icontains(Title, $query)");
        sql.Append(" ORDER BY DeletedAt DESC, Id DESC LIMIT $limit;");

        return _database.QueryAsync(
            sql.ToString(),
            cmd =>
            {
                cmd.Parameters.AddWithValue("$state", ToText(TrashEntryState.Held));
                if (hasCursor)
                {
                    cmd.Parameters.AddWithValue("$cursorAt", SqlTime.Write(cursorAt));
                    cmd.Parameters.AddWithValue("$cursorId", cursorId);
                }

                if (!string.IsNullOrWhiteSpace(kind))
                    cmd.Parameters.AddWithValue("$kind", kind);
                if (!string.IsNullOrWhiteSpace(query))
                    cmd.Parameters.AddWithValue("$query", query);
                cmd.Parameters.AddWithValue("$limit", limit);
            },
            ReadEntry,
            cancellationToken);
    }

    /// <inheritdoc />
    public Task<int> CountHeldAsync(CancellationToken cancellationToken = default) =>
        _database.CountAsync(
            "SELECT COUNT(*) FROM TrashEntries WHERE State = $state;",
            cmd => cmd.Parameters.AddWithValue("$state", ToText(TrashEntryState.Held)),
            cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyList<TrashEntry>> ListByKindAsync(string kind, CancellationToken cancellationToken = default) =>
        _database.QueryAsync(
            $"SELECT {Columns} FROM TrashEntries WHERE Kind = $kind ORDER BY DeletedAt DESC, Id DESC;",
            cmd => cmd.Parameters.AddWithValue("$kind", kind),
            ReadEntry,
            cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyList<TrashEntry>> ListHeldByBatchAsync(string batchId, CancellationToken cancellationToken = default) =>
        _database.QueryAsync(
            $"SELECT {Columns} FROM TrashEntries WHERE BatchId = $batch AND State = $state " +
            "ORDER BY DeletedAt DESC, Id DESC;",
            cmd =>
            {
                cmd.Parameters.AddWithValue("$batch", batchId);
                cmd.Parameters.AddWithValue("$state", ToText(TrashEntryState.Held));
            },
            ReadEntry,
            cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyList<TrashEntry>> ListOldestHeldAsync(int limit, CancellationToken cancellationToken = default) =>
        _database.QueryAsync(
            $"SELECT {Columns} FROM TrashEntries WHERE State = $state " +
            "ORDER BY DeletedAt ASC, Id ASC LIMIT $limit;",
            cmd =>
            {
                cmd.Parameters.AddWithValue("$state", ToText(TrashEntryState.Held));
                cmd.Parameters.AddWithValue("$limit", limit);
            },
            ReadEntry,
            cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyList<TrashEntry>> ListExpiredAsync(
        DateTimeOffset now,
        int limit,
        CancellationToken cancellationToken = default) =>
        _database.QueryAsync(
            $"SELECT {Columns} FROM TrashEntries WHERE State = $state AND ExpiresAt <= $now " +
            "ORDER BY ExpiresAt ASC, Id ASC LIMIT $limit;",
            cmd =>
            {
                cmd.Parameters.AddWithValue("$state", ToText(TrashEntryState.Held));
                cmd.Parameters.AddWithValue("$now", SqlTime.Write(now));
                cmd.Parameters.AddWithValue("$limit", limit);
            },
            ReadEntry,
            cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyList<TrashEntry>> ListAllAsync(CancellationToken cancellationToken = default) =>
        _database.QueryAsync(
            $"SELECT {Columns} FROM TrashEntries ORDER BY DeletedAt DESC, Id DESC;",
            null,
            ReadEntry,
            cancellationToken);

    private async Task<TrashEntry?> QuerySingleAsync(string sql, Action<SqliteCommand> bind, CancellationToken cancellationToken)
    {
        var rows = await _database.QueryAsync(sql, bind, ReadEntry, cancellationToken).ConfigureAwait(false);
        return rows.Count == 0 ? null : rows[0];
    }

    private static string BuildInQuery(
        string prefix,
        IReadOnlyList<string> ids,
        int offset,
        int take,
        List<string> names)
    {
        for (var i = 0; i < take; i++)
            names.Add($"$id{i}");
        return $"{prefix}{string.Join(", ", names)});";
    }

    private static void BindIds(SqliteCommand cmd, IReadOnlyList<string> ids, int offset, int take)
    {
        for (var i = 0; i < take; i++)
            cmd.Parameters.AddWithValue($"$id{i}", ids[offset + i]);
    }

    private static string BuildInsert(int take, List<string> values)
    {
        for (var i = 0; i < take; i++)
        {
            values.Add(
                $"($id{i}, $kind{i}, $item{i}, $title{i}, $origin{i}, $contained{i}, " +
                $"$batch{i}, $state{i}, $deleted{i}, $expires{i})");
        }

        return $"INSERT INTO TrashEntries ({Columns}) VALUES {string.Join(", ", values)};";
    }

    private static void BindEntries(SqliteCommand cmd, IReadOnlyList<TrashEntry> rows, int offset, int take)
    {
        for (var i = 0; i < take; i++)
        {
            var row = rows[offset + i];
            cmd.Parameters.AddWithValue($"$id{i}", row.Id);
            cmd.Parameters.AddWithValue($"$kind{i}", row.Kind);
            cmd.Parameters.AddWithValue($"$item{i}", row.ItemId);
            cmd.Parameters.AddWithValue($"$title{i}", row.Title);
            cmd.Parameters.AddWithValue($"$origin{i}", (object?)row.Origin ?? DBNull.Value);
            cmd.Parameters.AddWithValue($"$contained{i}", row.ContainedCount);
            cmd.Parameters.AddWithValue($"$batch{i}", row.BatchId);
            cmd.Parameters.AddWithValue($"$state{i}", ToText(row.State));
            cmd.Parameters.AddWithValue($"$deleted{i}", SqlTime.Write(row.DeletedAt));
            cmd.Parameters.AddWithValue($"$expires{i}", SqlTime.Write(row.ExpiresAt));
        }
    }

    private static string BuildPromotion(
        IReadOnlyList<KeyValuePair<string, TrashSnapshot>> rows,
        int offset,
        int take)
    {
        var titles = new StringBuilder("CASE Id");
        var origins = new StringBuilder("CASE Id");
        var counts = new StringBuilder("CASE Id");
        var ids = new List<string>(take);
        for (var i = 0; i < take; i++)
        {
            titles.Append($" WHEN $id{i} THEN $title{i}");
            origins.Append($" WHEN $id{i} THEN $origin{i}");
            counts.Append($" WHEN $id{i} THEN $contained{i}");
            ids.Add($"$id{i}");
        }

        titles.Append(" ELSE Title END");
        origins.Append(" ELSE Origin END");
        counts.Append(" ELSE ContainedCount END");
        return "UPDATE TrashEntries SET State = $state, " +
            $"Title = {titles}, Origin = {origins}, ContainedCount = {counts} " +
            $"WHERE Id IN ({string.Join(", ", ids)});";
    }

    private static void BindPromotions(
        SqliteCommand cmd,
        IReadOnlyList<KeyValuePair<string, TrashSnapshot>> rows,
        int offset,
        int take)
    {
        cmd.Parameters.AddWithValue("$state", ToText(TrashEntryState.Held));
        for (var i = 0; i < take; i++)
        {
            var (entryId, snapshot) = rows[offset + i];
            cmd.Parameters.AddWithValue($"$id{i}", entryId);
            cmd.Parameters.AddWithValue($"$title{i}", snapshot.Title);
            cmd.Parameters.AddWithValue($"$origin{i}", (object?)snapshot.Origin ?? DBNull.Value);
            cmd.Parameters.AddWithValue($"$contained{i}", snapshot.ContainedCount);
        }
    }

    private static TrashEntry ReadEntry(SqliteDataReader reader) => new()
    {
        Id = reader.GetString(0),
        Kind = reader.GetString(1),
        ItemId = reader.GetString(2),
        Title = reader.GetString(3),
        Origin = reader.IsDBNull(4) ? null : reader.GetString(4),
        ContainedCount = reader.GetInt32(5),
        BatchId = reader.GetString(6),
        State = FromText(reader.GetString(7)),
        DeletedAt = SqlTime.Read(reader, 8),
        ExpiresAt = SqlTime.Read(reader, 9)
    };

    private static string ToText(TrashEntryState state) => state switch
    {
        TrashEntryState.Prepared => "prepared",
        TrashEntryState.Held => "held",
        TrashEntryState.Purging => "purging",
        _ => throw new ArgumentOutOfRangeException(nameof(state), state, "Unknown trash entry state.")
    };

    // An unreadable state would otherwise hide a row from listings and from reconciliation alike,
    // so it reads back as prepared: invisible to people, and resolved on the next pass.
    private static TrashEntryState FromText(string text) => text switch
    {
        "held" => TrashEntryState.Held,
        "purging" => TrashEntryState.Purging,
        _ => TrashEntryState.Prepared
    };
}
