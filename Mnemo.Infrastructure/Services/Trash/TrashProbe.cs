using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// The one question that resolves an interrupted operation: does the source still hold this entry.
/// </summary>
internal static class TrashProbe
{
    /// <summary>
    /// Asks a source whether it holds an entry. Null means it could not say, which is the only
    /// answer that leaves a ledger row unresolved, so it also books a reconciliation pass.
    /// </summary>
    public static async Task<bool?> HoldsAsync(
        TrashContext context,
        ITrashSource source,
        string entryId,
        CancellationToken cancellationToken)
    {
        try
        {
            return await source.HoldsAsync(entryId, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            context.Logger.Error(
                "Trash",
                $"Source '{source.Kind}' could not report ownership of entry {entryId}.",
                ex);
            context.Maintenance.RequestReconciliation();
            return null;
        }
    }
}
