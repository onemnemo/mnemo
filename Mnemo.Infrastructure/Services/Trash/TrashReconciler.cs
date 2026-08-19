using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// Brings the ledger and the sources back into agreement.
/// </summary>
/// <remarks>
/// This is the pass that makes every interrupted operation safe, so it runs before the trash
/// becomes available. A ledger kind no source claims is left untouched: an entry written by a
/// build that shipped a module this one does not is preserved, not destroyed.
/// </remarks>
internal static class TrashReconciler
{
    /// <summary>Runs one pass over every registered source and reports how many entries it destroyed.</summary>
    public static async Task<int> RunAsync(TrashContext context, CancellationToken cancellationToken)
    {
        var purged = 0;
        foreach (var kind in context.Sources.Kinds)
        {
            var source = context.Sources.Resolve(kind);
            try
            {
                purged += await ReconcileSourceAsync(context, source, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                // One module that cannot answer must not keep the whole trash from opening.
                context.Logger.Error("Trash", $"Reconciling trash kind '{kind}' failed.", ex);
            }
        }

        return purged;
    }

    private static async Task<int> ReconcileSourceAsync(
        TrashContext context,
        ITrashSource source,
        CancellationToken cancellationToken)
    {
        var reported = await source.HeldEntryIdsAsync(cancellationToken).ConfigureAwait(false);
        var held = new HashSet<string>(reported, StringComparer.Ordinal);
        var rows = await context.Store.ListByKindAsync(source.Kind, cancellationToken).ConfigureAwait(false);

        var known = new HashSet<string>(StringComparer.Ordinal);
        var purged = 0;

        foreach (var row in rows)
        {
            known.Add(row.Id);
            var sourceHolds = held.Contains(row.Id);

            if (row.State == TrashEntryState.Purging)
            {
                purged += await RetryPurgeAsync(context, row, cancellationToken).ConfigureAwait(false);
                continue;
            }

            if (row.State == TrashEntryState.Prepared && sourceHolds)
            {
                // The source committed its marks before the promotion landed. The preparation
                // snapshot is what it holds, so the row becomes visible with the copy it was
                // written with.
                var snapshot = new TrashSnapshot(row.Title, row.Origin, row.ContainedCount);
                await context.Store.PromoteAsync(row.Id, snapshot, cancellationToken).ConfigureAwait(false);
                continue;
            }

            // Either a preparation that never reached its source, or a held entry whose content is
            // already back. Both mean the ledger row explains nothing.
            if (!sourceHolds)
                await context.Store.RemoveAsync(row.Id, cancellationToken).ConfigureAwait(false);
        }

        var orphans = new List<string>();
        foreach (var entryId in held)
        {
            if (!known.Contains(entryId))
                orphans.Add(entryId);
        }

        if (orphans.Count > 0)
        {
            context.Logger.Warning(
                "Trash",
                $"Releasing {orphans.Count} hidden '{source.Kind}' item(s) that no ledger entry explains.");
            await source.ReleaseAsync(orphans, cancellationToken).ConfigureAwait(false);
        }

        return purged;
    }

    private static async Task<int> RetryPurgeAsync(
        TrashContext context,
        TrashEntry row,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await TrashDestruction.DestroyAsync(context, row.Id, cancellationToken).ConfigureAwait(false);
            return result.Purged ? 1 : 0;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // The row keeps its state and the next pass tries again.
            context.Logger.Error("Trash", $"Retrying the purge of entry {row.Id} failed.", ex);
            return 0;
        }
    }
}
