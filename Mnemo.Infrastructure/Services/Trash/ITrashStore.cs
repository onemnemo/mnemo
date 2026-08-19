using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// Persistence for the trash ledger. Every method is a single committed statement; the operation
/// protocol lives one layer up, because a source transaction must never run inside a ledger one.
/// </summary>
public interface ITrashStore
{
    /// <summary>Creates the ledger and the cleanup queue if they are not already there.</summary>
    Task InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>The entry holding this item, in any state, or null when nothing holds it.</summary>
    Task<TrashEntry?> FindByItemAsync(string kind, string itemId, CancellationToken cancellationToken = default);

    /// <summary>One entry by id, in any state.</summary>
    Task<TrashEntry?> GetAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Writes a new row. Fails when the item already has an entry.</summary>
    Task InsertAsync(TrashEntry entry, CancellationToken cancellationToken = default);

    /// <summary>Moves a prepared row to held and stamps the snapshot the source reported.</summary>
    Task PromoteAsync(string entryId, TrashSnapshot snapshot, CancellationToken cancellationToken = default);

    /// <summary>Moves a row between states without touching its snapshot.</summary>
    Task SetStateAsync(string entryId, TrashEntryState state, CancellationToken cancellationToken = default);

    /// <summary>Deletes one ledger row.</summary>
    Task RemoveAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>One page of held entries, newest first. Ask for one more than you need to learn whether a next page exists.</summary>
    Task<IReadOnlyList<TrashEntry>> ListHeldAsync(
        string? cursor,
        int limit,
        string? kind,
        string? query,
        CancellationToken cancellationToken = default);

    /// <summary>How many entries are held.</summary>
    Task<int> CountHeldAsync(CancellationToken cancellationToken = default);

    /// <summary>Every row of one kind, in any state. Reconciliation reads this.</summary>
    Task<IReadOnlyList<TrashEntry>> ListByKindAsync(string kind, CancellationToken cancellationToken = default);

    /// <summary>Held entries minted by one delete action, newest first.</summary>
    Task<IReadOnlyList<TrashEntry>> ListHeldByBatchAsync(string batchId, CancellationToken cancellationToken = default);

    /// <summary>The oldest held entries, so a child deleted before its parent is destroyed first.</summary>
    Task<IReadOnlyList<TrashEntry>> ListOldestHeldAsync(int limit, CancellationToken cancellationToken = default);

    /// <summary>Held entries whose retention window closed at or before <paramref name="now"/>, oldest first.</summary>
    Task<IReadOnlyList<TrashEntry>> ListExpiredAsync(
        DateTimeOffset now,
        int limit,
        CancellationToken cancellationToken = default);

    /// <summary>Every row in the ledger, in any state. Full backup reads this.</summary>
    Task<IReadOnlyList<TrashEntry>> ListAllAsync(CancellationToken cancellationToken = default);
}
