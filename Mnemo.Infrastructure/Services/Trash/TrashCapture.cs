using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// Takes one item into the trash.
/// </summary>
/// <remarks>
/// The ledger row is written before the source marks anything, and is promoted to held only after
/// the source's transaction commits. Every interruption therefore lands on a state reconciliation
/// can read: a prepared row with no marks is removed, a prepared row with marks is promoted.
/// </remarks>
internal static class TrashCapture
{
    /// <summary>
    /// Takes the requested item, or returns null when it produced no entry.
    /// </summary>
    /// <exception cref="TrashSourceUnavailableException">The source could not say whether it holds the item.</exception>
    public static async Task<TrashEntry?> TakeAsync(
        TrashContext context,
        TrashDeleteRequest request,
        string batchId,
        CancellationToken cancellationToken)
    {
        var source = context.Sources.Resolve(request.Kind);

        var existing = await context.Store
            .FindByItemAsync(request.Kind, request.ItemId, cancellationToken)
            .ConfigureAwait(false);
        if (existing is not null)
        {
            switch (existing.State)
            {
                // Deleting something already in the trash reports the entry it is already in, with
                // its original batch id and expiry, so repeating the action never extends the
                // retention window.
                case TrashEntryState.Held:
                    return existing;

                // The item is being destroyed. There is nothing left to take, and re-entering it
                // into the ledger would contradict a purge already in flight.
                case TrashEntryState.Purging:
                    return null;

                default:
                    var recovered = await RecoverPreparedAsync(context, source, existing, cancellationToken)
                        .ConfigureAwait(false);
                    if (recovered is not null)
                        return recovered;
                    break;
            }
        }

        var prepared = await source.PrepareAsync(request.ItemId, cancellationToken).ConfigureAwait(false);
        if (prepared is null)
            return null;

        var entry = NewEntry(context, source.Kind, request.ItemId, batchId, prepared);
        await context.Store.InsertAsync(entry, cancellationToken).ConfigureAwait(false);

        TrashSnapshot? captured;
        try
        {
            captured = await source.CaptureAsync(request.ItemId, entry.Id, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            var holds = await TrashProbe.HoldsAsync(context, source, entry.Id, cancellationToken).ConfigureAwait(false);
            if (holds is null)
            {
                context.Logger.Error(
                    "Trash",
                    $"Capture of {source.Kind} {request.ItemId} left entry {entry.Id} unresolved.",
                    ex);
                throw new TrashSourceUnavailableException(source.Kind, ex);
            }

            if (holds.Value)
            {
                // The transaction committed and the failure came after it, so the preparation
                // snapshot describes exactly what the source now holds.
                await context.Store.PromoteAsync(entry.Id, prepared, cancellationToken).ConfigureAwait(false);
                return entry with { State = TrashEntryState.Held };
            }

            await context.Store.RemoveAsync(entry.Id, cancellationToken).ConfigureAwait(false);
            throw;
        }

        if (captured is null)
        {
            await context.Store.RemoveAsync(entry.Id, cancellationToken).ConfigureAwait(false);
            return null;
        }

        await context.Store.PromoteAsync(entry.Id, captured, cancellationToken).ConfigureAwait(false);
        return entry with
        {
            State = TrashEntryState.Held,
            Title = captured.Title,
            Origin = captured.Origin,
            ContainedCount = captured.ContainedCount
        };
    }

    /// <summary>
    /// Resolves a prepared row left by an earlier attempt. Returns the promoted entry when the
    /// source turns out to hold it, or null once the stale row is gone and a fresh take can run.
    /// </summary>
    private static async Task<TrashEntry?> RecoverPreparedAsync(
        TrashContext context,
        ITrashSource source,
        TrashEntry existing,
        CancellationToken cancellationToken)
    {
        var holds = await TrashProbe.HoldsAsync(context, source, existing.Id, cancellationToken).ConfigureAwait(false);
        if (holds is null)
            throw new TrashSourceUnavailableException(source.Kind);

        if (holds.Value)
        {
            var snapshot = new TrashSnapshot(existing.Title, existing.Origin, existing.ContainedCount);
            await context.Store.PromoteAsync(existing.Id, snapshot, cancellationToken).ConfigureAwait(false);
            return existing with { State = TrashEntryState.Held };
        }

        await context.Store.RemoveAsync(existing.Id, cancellationToken).ConfigureAwait(false);
        return null;
    }

    private static TrashEntry NewEntry(
        TrashContext context,
        string kind,
        string itemId,
        string batchId,
        TrashSnapshot prepared)
    {
        var deletedAt = context.Time.GetUtcNow();
        return new TrashEntry
        {
            Id = Guid.NewGuid().ToString("N"),
            Kind = kind,
            ItemId = itemId,
            Title = prepared.Title,
            Origin = prepared.Origin,
            ContainedCount = prepared.ContainedCount,
            BatchId = batchId,
            State = TrashEntryState.Prepared,
            DeletedAt = deletedAt,
            ExpiresAt = TrashRetention.ExpiresAt(deletedAt)
        };
    }
}
