using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Mindmap.Persistence;

/// <summary>
/// The sid half of the mindmap store: minting a map's short id on its first save, backfilling one
/// into every row a build before this one left without it, and resolving either address back to a
/// map's identity.
/// </summary>
public sealed partial class MindmapStore
{
    public Task<MindmapIdentity?> ResolveAsync(string sidOrId, CancellationToken cancellationToken = default) =>
        ReadAsync(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT Id, Sid FROM Mindmaps WHERE (Id = $v OR Sid = $v) AND TrashId IS NULL;";
            cmd.Parameters.AddWithValue("$v", sidOrId);

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                return null;

            var id = reader.GetString(0);
            var sid = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
            return new MindmapIdentity(id, sid);
        }, cancellationToken);

    /// <summary>
    /// A sid for <paramref name="id"/> to insert, or null when a row with that id already exists (the
    /// upsert's UPDATE half never assigns Sid, so an existing map is left with whatever it already has).
    /// </summary>
    private async Task<string?> MintSidForInsertAsync(SqliteConnection writer, SqliteTransaction tx, string id, CancellationToken cancellationToken)
    {
        await using (var exists = writer.CreateCommand())
        {
            exists.Transaction = tx;
            exists.CommandText = "SELECT 1 FROM Mindmaps WHERE Id = $id;";
            exists.Parameters.AddWithValue("$id", id);
            if (await exists.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null)
                return null;
        }

        var taken = await ReadTakenSidsAsync(writer, tx, cancellationToken).ConfigureAwait(false);
        return _sids.NextMindmapSid(taken);
    }

    /// <summary>
    /// Mints a sid for every row a build before this one left without one, trashed rows included so a
    /// map restored later can never collide with one minted since. Runs on every start; a library that
    /// already has every sid does nothing here.
    /// </summary>
    private async Task BackfillMindmapSidsAsync(SqliteConnection writer, CancellationToken cancellationToken)
    {
        var taken = new HashSet<string>(StringComparer.Ordinal);
        var missingIds = new List<string>();

        await using (var read = writer.CreateCommand())
        {
            read.CommandText = "SELECT Id, Sid FROM Mindmaps;";
            await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                if (reader.IsDBNull(1))
                    missingIds.Add(reader.GetString(0));
                else
                    taken.Add(reader.GetString(1));
            }
        }

        if (missingIds.Count == 0)
            return;

        // A plain transaction on the writer connection, not WriteAsync: this runs from inside
        // InitializeAsync, before _initialized is set, and WriteAsync would call back into
        // InitializeAsync and deadlock on the init gate this method is already running under.
        await using var tx = (SqliteTransaction)await writer.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            foreach (var id in missingIds)
            {
                var sid = _sids.NextMindmapSid(taken);
                taken.Add(sid);

                await using var update = writer.CreateCommand();
                update.Transaction = tx;
                update.CommandText = "UPDATE Mindmaps SET Sid = $sid WHERE Id = $id;";
                update.Parameters.AddWithValue("$sid", sid);
                update.Parameters.AddWithValue("$id", id);
                await update.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await tx.CommitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            await tx.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
            throw;
        }

        _logger.Info("Mindmap", $"Backfilled {missingIds.Count} mindmap sid(s).");
    }

    /// <summary>Every sid already stored, trashed rows included, so a mint can never collide with one.</summary>
    private static async Task<HashSet<string>> ReadTakenSidsAsync(SqliteConnection writer, SqliteTransaction tx, CancellationToken cancellationToken)
    {
        var taken = new HashSet<string>(StringComparer.Ordinal);

        await using var cmd = writer.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT Sid FROM Mindmaps WHERE Sid IS NOT NULL;";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            taken.Add(reader.GetString(0));

        return taken;
    }
}
