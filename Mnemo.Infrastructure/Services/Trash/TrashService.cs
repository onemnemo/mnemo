using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// The application wide holding pen.
/// </summary>
/// <remarks>
/// One asynchronous gate serializes every mutation, which makes the ordering of delete, restore,
/// purge, empty, expiry, and reconciliation deterministic. Deletes are infrequent enough that the
/// gate costs nothing worth measuring. Reads stay outside it so listing the trash never waits
/// behind a long destruction.
/// </remarks>
public sealed class TrashService : ITrashService, IDisposable
{
    private const int MaxPageSize = 100;
    private const int PurgeBatchSize = 50;
    private const int MaxSweepPerRun = 500;

    private readonly TrashContext _context;
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <param name="store">The ledger.</param>
    /// <param name="sources">The registered sources.</param>
    /// <param name="logger">Where protocol failures are reported.</param>
    /// <param name="maintenance">Where an uncertain outcome asks for a background pass.</param>
    /// <param name="time">Clock deletion and expiry are stamped from. Defaults to the system clock.</param>
    public TrashService(
        ITrashStore store,
        TrashSourceRegistry sources,
        ILoggerService logger,
        ITrashMaintenance? maintenance = null,
        TimeProvider? time = null) =>
        _context = new TrashContext(
            store,
            sources,
            logger,
            time ?? TimeProvider.System,
            maintenance ?? NullTrashMaintenance.Instance);

    /// <inheritdoc />
    public IReadOnlyCollection<string> RegisteredKinds => _context.Sources.Kinds;

    /// <inheritdoc />
    public async Task<TrashAction> DeleteAsync(
        IReadOnlyCollection<TrashDeleteRequest> items,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(items);

        // Resolving every kind up front keeps one mistyped kind from half completing the action.
        foreach (var item in items)
            _context.Sources.Resolve(item.Kind);

        var batchId = Guid.NewGuid().ToString("N");
        var entries = new List<TrashEntry>();
        var taken = new HashSet<string>(StringComparer.Ordinal);
        var skipped = 0;

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            foreach (var item in items)
            {
                var entry = await TrashCapture.TakeAsync(_context, item, batchId, cancellationToken).ConfigureAwait(false);

                // A selection that named the same item twice, directly and through a container,
                // produces one entry and counts the rest as skipped.
                if (entry is null || !taken.Add(entry.Id))
                {
                    skipped++;
                    continue;
                }

                entries.Add(entry);
            }
        }
        finally
        {
            _gate.Release();
        }

        return new TrashAction(batchId, entries, skipped);
    }

    /// <inheritdoc />
    public async Task<TrashPage> ListAsync(TrashListQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        var limit = Math.Clamp(query.Limit, 1, MaxPageSize);

        // One extra row answers whether a next page exists without a second count query.
        var rows = await _context.Store
            .ListHeldAsync(query.Cursor, limit + 1, query.Kind, query.Query, cancellationToken)
            .ConfigureAwait(false);

        var size = Math.Min(rows.Count, limit);
        var listings = new List<TrashListing>(size);
        for (var i = 0; i < size; i++)
            listings.Add(new TrashListing(rows[i], _context.Sources.Knows(rows[i].Kind)));

        var next = rows.Count > limit ? TrashCursor.Encode(rows[size - 1]) : null;
        return new TrashPage(listings, next);
    }

    /// <inheritdoc />
    public Task<int> CountAsync(CancellationToken cancellationToken = default) =>
        _context.Store.CountHeldAsync(cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyList<TrashRestoreResult>> RestoreAsync(
        IReadOnlyCollection<string> entryIds,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(entryIds);

        var results = new List<TrashRestoreResult>(entryIds.Count);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            foreach (var entryId in entryIds)
            {
                results.Add(await TrashRelease
                    .PutBackAsync(_context, entryId, target, cancellationToken)
                    .ConfigureAwait(false));
            }
        }
        finally
        {
            _gate.Release();
        }

        return results;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<TrashRestoreResult>> RestoreBatchAsync(
        string batchId,
        CancellationToken cancellationToken = default)
    {
        var results = new List<TrashRestoreResult>();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var entries = await _context.Store.ListHeldByBatchAsync(batchId, cancellationToken).ConfigureAwait(false);
            foreach (var entry in entries)
            {
                results.Add(await TrashRelease
                    .PutBackAsync(_context, entry.Id, null, cancellationToken)
                    .ConfigureAwait(false));
            }
        }
        finally
        {
            _gate.Release();
        }

        return results;
    }

    /// <inheritdoc />
    public async Task<TrashPurgeResult> PurgeAsync(string entryId, CancellationToken cancellationToken = default)
    {
        TrashPurgeResult result;
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            result = await TrashDestruction.DestroyAsync(_context, entryId, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }

        if (result.Purged)
            _context.Maintenance.RequestAssetCleanup();
        return result;
    }

    /// <inheritdoc />
    public async Task<TrashEmptyResult> EmptyAsync(CancellationToken cancellationToken = default)
    {
        var blocked = new List<TrashPurgeResult>();
        var blockedIds = new HashSet<string>(StringComparer.Ordinal);
        var purgedCount = 0;

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();

                // Oldest first, so a child deleted before its parent is destroyed before the parent
                // whose cascade would otherwise reach it. Blocked entries stay in the ledger, so the
                // window has to grow past them to keep finding work.
                var batch = await _context.Store
                    .ListOldestHeldAsync(PurgeBatchSize + blockedIds.Count, cancellationToken)
                    .ConfigureAwait(false);

                var progressed = false;
                foreach (var entry in batch)
                {
                    if (blockedIds.Contains(entry.Id))
                        continue;

                    progressed = true;
                    var result = await TrashDestruction
                        .DestroyAsync(_context, entry.Id, cancellationToken)
                        .ConfigureAwait(false);
                    if (result.Purged)
                    {
                        purgedCount++;
                    }
                    else
                    {
                        blocked.Add(result);
                        blockedIds.Add(entry.Id);
                    }
                }

                if (!progressed)
                    break;
            }
        }
        finally
        {
            _gate.Release();
        }

        if (purgedCount > 0)
            _context.Maintenance.RequestAssetCleanup();
        return new TrashEmptyResult(purgedCount, blocked);
    }

    /// <inheritdoc />
    public async Task<int> SweepExpiredAsync(CancellationToken cancellationToken = default)
    {
        var blockedIds = new HashSet<string>(StringComparer.Ordinal);
        var purgedCount = 0;

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            while (purgedCount < MaxSweepPerRun)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var batch = await _context.Store
                    .ListExpiredAsync(_context.Time.GetUtcNow(), PurgeBatchSize + blockedIds.Count, cancellationToken)
                    .ConfigureAwait(false);

                var progressed = false;
                foreach (var entry in batch)
                {
                    if (blockedIds.Contains(entry.Id))
                        continue;

                    progressed = true;
                    var result = await TrashDestruction
                        .DestroyAsync(_context, entry.Id, cancellationToken)
                        .ConfigureAwait(false);
                    if (result.Purged)
                        purgedCount++;
                    else
                        blockedIds.Add(entry.Id);
                }

                if (!progressed)
                    break;
            }
        }
        finally
        {
            _gate.Release();
        }

        if (purgedCount > 0)
            _context.Maintenance.RequestAssetCleanup();
        return purgedCount;
    }

    /// <inheritdoc />
    public async Task ReconcileAsync(CancellationToken cancellationToken = default)
    {
        int purged;
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            purged = await TrashReconciler.RunAsync(_context, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }

        if (purged > 0)
            _context.Maintenance.RequestAssetCleanup();
    }

    /// <summary>Releases the operation gate.</summary>
    public void Dispose() => _gate.Dispose();
}
