using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// SQLite-backed <see cref="IAssetCleanupStore"/>.
/// </summary>
public sealed class AssetCleanupStore : IAssetCleanupStore
{
    private const string Columns = "Id, Owner, Path, EnqueuedAt, Attempts, LastError";

    private readonly TrashDatabase _database;

    /// <param name="database">The shared trash tables.</param>
    public AssetCleanupStore(TrashDatabase database) => _database = database;

    /// <inheritdoc />
    public Task<IReadOnlyList<AssetCleanupJob>> ListPendingAsync(int limit, CancellationToken cancellationToken = default) =>
        _database.QueryAsync(
            $"SELECT {Columns} FROM AssetCleanupJobs ORDER BY Attempts ASC, EnqueuedAt ASC LIMIT $limit;",
            cmd => cmd.Parameters.AddWithValue("$limit", limit),
            ReadJob,
            cancellationToken);

    /// <inheritdoc />
    public Task<int> CountPendingAsync(CancellationToken cancellationToken = default) =>
        _database.CountAsync("SELECT COUNT(*) FROM AssetCleanupJobs;", null, cancellationToken);

    /// <inheritdoc />
    public Task CompleteAsync(string jobId, CancellationToken cancellationToken = default) =>
        _database.ExecuteAsync(
            "DELETE FROM AssetCleanupJobs WHERE Id = $id;",
            cmd => cmd.Parameters.AddWithValue("$id", jobId),
            cancellationToken);

    /// <inheritdoc />
    public Task FailAsync(string jobId, string error, CancellationToken cancellationToken = default) =>
        _database.ExecuteAsync(
            "UPDATE AssetCleanupJobs SET Attempts = Attempts + 1, LastError = $error WHERE Id = $id;",
            cmd =>
            {
                cmd.Parameters.AddWithValue("$error", error);
                cmd.Parameters.AddWithValue("$id", jobId);
            },
            cancellationToken);

    private static AssetCleanupJob ReadJob(SqliteDataReader reader) => new(
        reader.GetString(0),
        reader.GetString(1),
        reader.GetString(2),
        SqlTime.Read(reader, 3),
        reader.GetInt32(4),
        reader.IsDBNull(5) ? null : reader.GetString(5));
}
