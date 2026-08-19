using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// Destroys one entry permanently.
/// </summary>
/// <remarks>
/// The ledger row says purging for the whole attempt, so a crash mid-destruction is retried rather
/// than mistaken for recoverable content. Sources make purge idempotent, so a retry after the
/// transaction already committed reports completion with nothing left to delete.
/// </remarks>
internal static class TrashDestruction
{
    /// <summary>Destroys one entry, or reports the entries blocking it.</summary>
    /// <exception cref="TrashSourceUnavailableException">The source could not say whether it still holds the entry.</exception>
    public static async Task<TrashPurgeResult> DestroyAsync(
        TrashContext context,
        string entryId,
        CancellationToken cancellationToken)
    {
        var entry = await context.Store.GetAsync(entryId, cancellationToken).ConfigureAwait(false);

        // Nothing to destroy is the outcome the caller asked for.
        if (entry is null)
            return new TrashPurgeResult(entryId, string.Empty, true, []);

        var source = context.Sources.Resolve(entry.Kind);

        if (entry.State != TrashEntryState.Purging)
            await context.Store.SetStateAsync(entry.Id, TrashEntryState.Purging, cancellationToken).ConfigureAwait(false);

        TrashPurge purge;
        try
        {
            purge = await source.PurgeAsync(entry.Id, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            var holds = await TrashProbe.HoldsAsync(context, source, entry.Id, cancellationToken).ConfigureAwait(false);
            if (holds is null)
            {
                context.Logger.Error("Trash", $"Purge of entry {entry.Id} left its state unresolved.", ex);
                throw new TrashSourceUnavailableException(entry.Kind, ex);
            }

            if (holds.Value)
            {
                await context.Store.SetStateAsync(entry.Id, TrashEntryState.Held, cancellationToken).ConfigureAwait(false);
                throw;
            }

            // The transaction committed and the failure came after it, so the rows and the cleanup
            // jobs are already durable.
            await context.Store.RemoveAsync(entry.Id, cancellationToken).ConfigureAwait(false);
            return new TrashPurgeResult(entry.Id, entry.Title, true, []);
        }

        if (!purge.Completed)
        {
            await context.Store.SetStateAsync(entry.Id, TrashEntryState.Held, cancellationToken).ConfigureAwait(false);
            return new TrashPurgeResult(entry.Id, entry.Title, false, purge.BlockingEntryIds);
        }

        await context.Store.RemoveAsync(entry.Id, cancellationToken).ConfigureAwait(false);
        return new TrashPurgeResult(entry.Id, entry.Title, true, []);
    }
}
