using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace Mnemo.Infrastructure.Services.Flashcards.Trash;

/// <summary>
/// The small SQL moves every flashcard trash source makes: stamping rows with an entry id, taking
/// the stamp back off, and asking which entries a table is holding.
/// </summary>
/// <remarks>
/// Four kinds share four tables, so the tables alone cannot say which kind an entry belongs to.
/// They are read from the top down instead: a folder entry always stamps a folder row, a deck entry
/// stamps a deck and no folder, a material entry stamps material and no deck, and a card entry
/// stamps only cards. <see cref="HoldsAsync"/> takes the tables above a kind as exclusions, which is
/// what keeps one source from answering for another's entry.
/// </remarks>
internal static class FlashcardTrashSql
{
    /// <summary>How many ids one parameterized IN list carries.</summary>
    public const int ChunkSize = 400;

    /// <summary>Stamps the named rows that nothing else has taken.</summary>
    public static async Task MarkAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string table,
        IReadOnlyList<string> ids,
        string entryId,
        CancellationToken cancellationToken)
    {
        for (var offset = 0; offset < ids.Count; offset += ChunkSize)
        {
            var take = Math.Min(ChunkSize, ids.Count - offset);
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;

            var names = new List<string>(take);
            for (var i = 0; i < take; i++)
            {
                var name = $"$i{i}";
                names.Add(name);
                cmd.Parameters.AddWithValue(name, ids[offset + i]);
            }

            cmd.Parameters.AddWithValue("$entry", entryId);
            cmd.CommandText =
                $"UPDATE {table} SET TrashId = $entry WHERE TrashId IS NULL AND Id IN ({string.Join(", ", names)});";
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Takes the stamp off every row one of the given entries holds.</summary>
    public static async Task ClearMarksAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string table,
        IReadOnlyCollection<string> entryIds,
        CancellationToken cancellationToken)
    {
        if (entryIds.Count == 0)
            return;

        var ids = new List<string>(entryIds);
        for (var offset = 0; offset < ids.Count; offset += ChunkSize)
        {
            var take = Math.Min(ChunkSize, ids.Count - offset);
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;

            var names = new List<string>(take);
            for (var i = 0; i < take; i++)
            {
                var name = $"$e{i}";
                names.Add(name);
                cmd.Parameters.AddWithValue(name, ids[offset + i]);
            }

            cmd.CommandText = $"UPDATE {table} SET TrashId = NULL WHERE TrashId IN ({string.Join(", ", names)});";
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Whether <paramref name="table"/> holds the entry while none of <paramref name="above"/> does.
    /// </summary>
    public static async Task<bool> HoldsAsync(
        SqliteConnection connection,
        string table,
        IReadOnlyList<string> above,
        string entryId,
        CancellationToken cancellationToken)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT 1 FROM {table} WHERE TrashId = $entry{Exclusions(above)} LIMIT 1;";
        cmd.Parameters.AddWithValue("$entry", entryId);
        return await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null;
    }

    /// <summary>
    /// Every entry <paramref name="table"/> holds that no table in <paramref name="above"/> also holds.
    /// </summary>
    public static async Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(
        SqliteConnection connection,
        string table,
        IReadOnlyList<string> above,
        CancellationToken cancellationToken)
    {
        var clauses = new List<string>(above.Count);
        foreach (var higher in above)
            clauses.Add($" AND NOT EXISTS (SELECT 1 FROM {higher} h WHERE h.TrashId = t.TrashId)");

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = $"""
            SELECT DISTINCT t.TrashId FROM {table} t
            WHERE t.TrashId IS NOT NULL{string.Concat(clauses)};
            """;
        return await ReadStringsAsync(cmd, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>The first column of every row, skipping nulls.</summary>
    public static async Task<List<string>> ReadStringsAsync(SqliteCommand cmd, CancellationToken cancellationToken)
    {
        var values = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            if (!reader.IsDBNull(0))
                values.Add(reader.GetString(0));
        }

        return values;
    }

    /// <summary>Runs a statement that needs only the entry id.</summary>
    public static async Task ExecuteForEntryAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string sql,
        string entryId,
        CancellationToken cancellationToken)
    {
        await using var cmd = writer.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("$entry", entryId);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Counts rows for a statement that needs only the entry id.</summary>
    public static async Task<int> CountForEntryAsync(
        SqliteConnection connection,
        SqliteTransaction? tx,
        string sql,
        string entryId,
        CancellationToken cancellationToken)
    {
        await using var cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("$entry", entryId);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) ?? 0);
    }

    private static string Exclusions(IReadOnlyList<string> above)
    {
        if (above.Count == 0)
            return string.Empty;

        var clauses = new List<string>(above.Count);
        foreach (var table in above)
            clauses.Add($" AND NOT EXISTS (SELECT 1 FROM {table} WHERE TrashId = $entry)");

        return string.Concat(clauses);
    }
}
