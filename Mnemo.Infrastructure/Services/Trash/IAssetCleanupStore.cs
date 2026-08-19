using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// Reads and retires the queued file deletions written by module purges.
/// </summary>
public interface IAssetCleanupStore
{
    /// <summary>
    /// The next jobs to attempt, fewest failures first, then oldest first.
    /// </summary>
    /// <remarks>
    /// Ordering by attempts keeps one undeletable file, a locked handle for instance, from
    /// starving every job queued behind it. Nothing is ever dropped for failing too often.
    /// </remarks>
    Task<IReadOnlyList<AssetCleanupJob>> ListPendingAsync(int limit, CancellationToken cancellationToken = default);

    /// <summary>How many deletions are still queued.</summary>
    Task<int> CountPendingAsync(CancellationToken cancellationToken = default);

    /// <summary>Retires a job whose file is gone from disk.</summary>
    Task CompleteAsync(string jobId, CancellationToken cancellationToken = default);

    /// <summary>Keeps a job and records why the attempt failed.</summary>
    Task FailAsync(string jobId, string error, CancellationToken cancellationToken = default);
}
