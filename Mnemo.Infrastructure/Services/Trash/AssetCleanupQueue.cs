using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// Enqueues files for deletion from inside the transaction that removed their last owning rows.
/// </summary>
/// <remarks>
/// A purge cannot delete the file first, because a failure after that would leave restorable data
/// pointing at nothing. It cannot delete the file after committing either, because a crash in
/// between would leak the file with no record of it. Writing the job in the same transaction makes
/// the leak recoverable instead: the worst outcome is a file that outlives its rows until the next
/// cleanup pass.
/// </remarks>
public static class AssetCleanupQueue
{
    /// <summary>Queues one file. Enqueueing a path already queued for the same owner changes nothing.</summary>
    public static Task EnqueueAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string owner,
        string path,
        DateTimeOffset enqueuedAt,
        CancellationToken cancellationToken = default) =>
        EnqueueAsync(connection, transaction, owner, new[] { path }, enqueuedAt, cancellationToken);

    /// <summary>Queues several files at once.</summary>
    public static async Task EnqueueAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string owner,
        IEnumerable<string> paths,
        DateTimeOffset enqueuedAt,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(connection);
        ArgumentNullException.ThrowIfNull(transaction);
        ArgumentNullException.ThrowIfNull(paths);

        var pending = new List<string>();
        foreach (var path in paths)
        {
            if (!string.IsNullOrWhiteSpace(path))
                pending.Add(path);
        }

        if (pending.Count == 0)
            return;

        await EnsureTableAsync(connection, transaction, cancellationToken).ConfigureAwait(false);

        await using var cmd = connection.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText =
            "INSERT INTO AssetCleanupJobs (Id, Owner, Path, EnqueuedAt, Attempts, LastError) " +
            "VALUES ($id, $owner, $path, $enqueuedAt, 0, NULL) " +
            "ON CONFLICT(Owner, Path) DO NOTHING;";

        var id = cmd.Parameters.Add("$id", SqliteType.Text);
        cmd.Parameters.AddWithValue("$owner", owner);
        var pathParameter = cmd.Parameters.Add("$path", SqliteType.Text);
        cmd.Parameters.AddWithValue("$enqueuedAt", SqlTime.Write(enqueuedAt));

        foreach (var path in pending)
        {
            id.Value = Guid.NewGuid().ToString("N");
            pathParameter.Value = path;
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private static async Task EnsureTableAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var cmd = connection.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText = TrashSchema.CleanupSql;
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }
}
