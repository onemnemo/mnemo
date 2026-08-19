using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Host.Trash;

/// <summary>
/// Drains the queue a purge writes: the files whose last owning rows are already gone.
/// </summary>
/// <remarks>
/// This is the second half of permanent deletion, and it runs long after the transaction that
/// queued it. Nothing here may assume the queue is small, that its owners exist in this build, or
/// that a file is still there.
/// </remarks>
public sealed class AssetCleanupWorker
{
    private const int BatchSize = 50;

    private readonly IAssetCleanupStore _store;
    private readonly Dictionary<string, IAssetCleanupOwner> _owners;
    private readonly ILoggerService _logger;

    /// <param name="store">The queue.</param>
    /// <param name="owners">The asset stores that can answer for a queued path.</param>
    /// <param name="logger">Where cleanup failures are reported.</param>
    public AssetCleanupWorker(IAssetCleanupStore store, IEnumerable<IAssetCleanupOwner> owners, ILoggerService logger)
    {
        _store = store;
        _logger = logger;
        _owners = owners.ToDictionary(o => o.Owner, StringComparer.Ordinal);
    }

    /// <summary>Works through one batch and reports how many files it removed.</summary>
    public async Task<int> RunAsync(CancellationToken cancellationToken = default)
    {
        var jobs = await _store.ListPendingAsync(BatchSize, cancellationToken).ConfigureAwait(false);
        var deleted = 0;

        foreach (var job in jobs)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!_owners.TryGetValue(job.Owner, out var owner))
            {
                // A build without that module cannot decide whether the file is still referenced,
                // so the job is kept. Counting the attempt moves it behind jobs this build can act
                // on instead of letting it sit at the head of the queue forever.
                await FailAsync(job, $"No asset store named '{job.Owner}' in this build.", cancellationToken)
                    .ConfigureAwait(false);
                continue;
            }

            if (!owner.IsReady)
                continue;

            try
            {
                var outcome = await owner.DeleteIfUnreferencedAsync(job.Path, cancellationToken).ConfigureAwait(false);

                // A file something still points at is not a failure. The premise of the job, that
                // its last owner was gone, no longer holds, and removing the last real reference
                // will queue it again.
                await _store.CompleteAsync(job.Id, cancellationToken).ConfigureAwait(false);
                if (outcome == AssetCleanupOutcome.Deleted)
                    deleted++;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                await FailAsync(job, ex.Message, cancellationToken).ConfigureAwait(false);
                _logger.Warning("Trash", $"Could not remove '{job.Path}' for '{job.Owner}': {ex.Message}");
            }
        }

        return deleted;
    }

    private Task FailAsync(AssetCleanupJob job, string error, CancellationToken cancellationToken) =>
        _store.FailAsync(job.Id, error, cancellationToken);
}
