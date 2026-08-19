using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// Puts one entry back.
/// </summary>
/// <remarks>
/// The source clears its own marks first and the ledger row is removed only after that commits,
/// so an interruption leaves a held row no source holds, which reconciliation removes. The reverse
/// order would leave hidden content with nothing to explain it.
/// </remarks>
internal static class TrashRelease
{
    /// <summary>Restores one entry and reports what actually happened to it.</summary>
    /// <exception cref="TrashSourceUnavailableException">The source could not say whether it still holds the entry.</exception>
    public static async Task<TrashRestoreResult> PutBackAsync(
        TrashContext context,
        string entryId,
        TrashRestoreTarget? target,
        CancellationToken cancellationToken)
    {
        var entry = await context.Store.GetAsync(entryId, cancellationToken).ConfigureAwait(false);

        // A row that is not held is either already gone or being destroyed, and neither is
        // recoverable through this path.
        if (entry is null || entry.State != TrashEntryState.Held)
            return NotRecoverable(entryId, entry);

        var source = context.Sources.Resolve(entry.Kind);

        TrashRestore restore;
        try
        {
            restore = await source.RestoreAsync(entry.Id, target, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            var holds = await TrashProbe.HoldsAsync(context, source, entry.Id, cancellationToken).ConfigureAwait(false);
            if (holds is null)
            {
                context.Logger.Error("Trash", $"Restore of entry {entry.Id} left its state unresolved.", ex);
                throw new TrashSourceUnavailableException(entry.Kind, ex);
            }

            if (holds.Value)
                throw;

            // The transaction committed and the failure came after it, so the content is back.
            await context.Store.RemoveAsync(entry.Id, cancellationToken).ConfigureAwait(false);
            return new TrashRestoreResult(
                entry.Id,
                entry.Kind,
                entry.ItemId,
                entry.Title,
                TrashRestoreOutcome.Restored);
        }

        if (restore.Outcome is TrashRestoreOutcome.Restored
            or TrashRestoreOutcome.Rooted
            or TrashRestoreOutcome.Missing)
        {
            await context.Store.RemoveAsync(entry.Id, cancellationToken).ConfigureAwait(false);
        }

        return new TrashRestoreResult(
            entry.Id,
            entry.Kind,
            entry.ItemId,
            entry.Title,
            restore.Outcome,
            restore.DestinationId,
            restore.DestinationName);
    }

    private static TrashRestoreResult NotRecoverable(string entryId, TrashEntry? entry) => new(
        entryId,
        entry?.Kind ?? string.Empty,
        entry?.ItemId ?? string.Empty,
        entry?.Title ?? string.Empty,
        TrashRestoreOutcome.Missing);
}
