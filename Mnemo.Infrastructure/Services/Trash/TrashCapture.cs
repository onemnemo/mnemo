using System;
using System.Collections.Generic;
using System.Linq;
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
    /// <summary>Takes several items of one kind through the batched source and ledger contracts.</summary>
    public static async Task<IReadOnlyList<TrashEntry>> TakeManyAsync(
        TrashContext context,
        string kind,
        IReadOnlyCollection<string> itemIds,
        string batchId,
        CancellationToken cancellationToken)
    {
        var source = context.Sources.Resolve(kind);
        var ids = itemIds.Distinct(StringComparer.Ordinal).ToList();
        var existing = await context.Store.FindByItemsAsync(kind, ids, cancellationToken).ConfigureAwait(false);
        var taken = new Dictionary<string, TrashEntry>(StringComparer.Ordinal);
        var pending = new List<string>();

        foreach (var itemId in ids)
        {
            if (!existing.TryGetValue(itemId, out var row))
            {
                pending.Add(itemId);
                continue;
            }

            if (row.State == TrashEntryState.Held)
            {
                taken[itemId] = row;
                continue;
            }

            if (row.State == TrashEntryState.Purging)
                continue;

            var recovered = await RecoverPreparedAsync(context, source, row, cancellationToken).ConfigureAwait(false);
            if (recovered is not null)
                taken[itemId] = recovered;
            else
                pending.Add(itemId);
        }

        var prepared = await source.PrepareManyAsync(pending, cancellationToken).ConfigureAwait(false);
        var entries = prepared.ToDictionary(
            pair => pair.Key,
            pair => NewEntry(context, kind, pair.Key, batchId, pair.Value),
            StringComparer.Ordinal);
        try
        {
            await context.Store.InsertManyAsync(entries.Values, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            try
            {
                await context.Store.RemoveManyAsync(
                    entries.Values.Select(entry => entry.Id).ToList(),
                    cancellationToken).ConfigureAwait(false);
            }
            catch (Exception cleanupFailure)
            {
                context.Logger.Error("Trash", $"Batch preparation for {source.Kind} could not be rolled back.", cleanupFailure);
                context.Maintenance.RequestReconciliation();
            }

            throw;
        }

        IReadOnlyDictionary<string, TrashSnapshot> captured;
        try
        {
            captured = await source.CaptureManyAsync(
                entries.ToDictionary(pair => pair.Key, pair => pair.Value.Id, StringComparer.Ordinal),
                cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            var recovered = await ResolveFailedBatchAsync(context, source, entries, ex, cancellationToken)
                .ConfigureAwait(false);
            if (recovered.Count != entries.Count)
                throw;
            captured = recovered;
        }

        var promoted = captured.ToDictionary(
            pair => entries[pair.Key].Id,
            pair => pair.Value,
            StringComparer.Ordinal);
        await context.Store.PromoteManyAsync(promoted, cancellationToken).ConfigureAwait(false);

        var missing = entries.Keys.Where(itemId => !captured.ContainsKey(itemId))
            .Select(itemId => entries[itemId].Id)
            .ToList();
        await context.Store.RemoveManyAsync(missing, cancellationToken).ConfigureAwait(false);

        foreach (var (itemId, snapshot) in captured)
        {
            var entry = entries[itemId];
            taken[itemId] = entry with
            {
                State = TrashEntryState.Held,
                Title = snapshot.Title,
                Origin = snapshot.Origin,
                ContainedCount = snapshot.ContainedCount
            };
        }

        return ids.Where(taken.ContainsKey).Select(itemId => taken[itemId]).ToList();
    }

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

    private static async Task<IReadOnlyDictionary<string, TrashSnapshot>> ResolveFailedBatchAsync(
        TrashContext context,
        ITrashSource source,
        IReadOnlyDictionary<string, TrashEntry> entries,
        Exception failure,
        CancellationToken cancellationToken)
    {
        IReadOnlyCollection<string> held;
        try
        {
            held = await source.HeldEntryIdsAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception probeFailure)
        {
            context.Logger.Error("Trash", $"Batch capture for {source.Kind} left prepared entries unresolved.", failure);
            context.Maintenance.RequestReconciliation();
            throw new TrashSourceUnavailableException(source.Kind, probeFailure);
        }

        var heldSet = held.ToHashSet(StringComparer.Ordinal);
        var promoted = entries.Values.Where(entry => heldSet.Contains(entry.Id)).ToDictionary(
            entry => entry.Id,
            entry => new TrashSnapshot(entry.Title, entry.Origin, entry.ContainedCount),
            StringComparer.Ordinal);
        await context.Store.PromoteManyAsync(promoted, cancellationToken).ConfigureAwait(false);
        await context.Store.RemoveManyAsync(
            entries.Values.Where(entry => !heldSet.Contains(entry.Id)).Select(entry => entry.Id).ToList(),
            cancellationToken).ConfigureAwait(false);
        return entries.Where(pair => heldSet.Contains(pair.Value.Id)).ToDictionary(
            pair => pair.Key,
            pair => new TrashSnapshot(pair.Value.Title, pair.Value.Origin, pair.Value.ContainedCount),
            StringComparer.Ordinal);
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
