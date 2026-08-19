using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;

namespace Mnemo.Core.Services;

/// <summary>
/// The module side of the trash. One implementation owns one kind, and it is the only authority
/// on what that kind's rows are, how they hide, and how they come back.
/// </summary>
/// <remarks>
/// Capture, restore, and purge each contain their module's write transaction and return as soon
/// as it commits. An implementation must not delete files, publish events, or do other fallible
/// work after the commit, because the coordinator decides what happens next from the return value.
/// </remarks>
public interface ITrashSource
{
    /// <summary>The ledger kind this source owns. Two sources may not claim the same kind.</summary>
    string Kind { get; }

    /// <summary>
    /// Reads the ledger snapshot for a live item without changing anything.
    /// Returns null when the item is not live.
    /// </summary>
    Task<TrashSnapshot?> PrepareAsync(string itemId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks the item and its live cascade with <paramref name="entryId"/> in one module
    /// transaction, and returns the authoritative snapshot of what was taken.
    /// </summary>
    /// <remarks>
    /// Idempotent for the same entry id: capturing twice reports the same snapshot rather than
    /// taking more rows. Returns null when the item stopped being live after preparation. Never
    /// takes a row already stamped by another entry.
    /// </remarks>
    Task<TrashSnapshot?> CaptureAsync(string itemId, string entryId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Clears the marks belonging to <paramref name="entryId"/> and no others, restoring the
    /// content itself untouched. Content is never serialized and reinserted, so scheduling state,
    /// review history, revisions, short ids, ordering, and timestamps survive unchanged.
    /// </summary>
    /// <param name="entryId">The entry to release.</param>
    /// <param name="target">A live container chosen by the caller, for a kind that cannot sit at a root.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Permanently deletes the rows belonging to <paramref name="entryId"/> and enqueues cleanup
    /// jobs for the files they owned, in one transaction.
    /// </summary>
    /// <remarks>
    /// Idempotent: purging an entry the source no longer holds reports completion. Before any
    /// physical parent delete the source asks which rows a foreign key cascade would reach; if one
    /// carries a different entry id it returns those ids and mutates nothing.
    /// </remarks>
    Task<TrashPurge> PurgeAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Answers whether this source currently holds rows stamped with <paramref name="entryId"/>.
    /// Resolves one uncertain operation outcome without scanning every held entry.
    /// </summary>
    Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Every entry id this source currently holds. Used by reconciliation.</summary>
    Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Reconciliation only. Clears the given marks without emitting restore copy or changing
    /// structural ids, for source rows that no ledger row explains.
    /// </summary>
    Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default);
}
