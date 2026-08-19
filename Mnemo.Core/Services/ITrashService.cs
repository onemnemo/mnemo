using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;

namespace Mnemo.Core.Services;

/// <summary>
/// The application wide holding pen. Ordinary deletion routes through here, stays recoverable for
/// the retention window, and only permanent destruction asks the person to confirm.
/// </summary>
public interface ITrashService
{
    /// <summary>Kinds a source in this build claims. A ledger row of any other kind is preserved and shown as unavailable.</summary>
    IReadOnlyCollection<string> RegisteredKinds { get; }

    /// <summary>
    /// Takes every requested item, minting one batch id for the entries this action captures.
    /// </summary>
    /// <remarks>
    /// An item already held returns its existing entry with its original batch id and its original
    /// expiry, so repeating a delete never extends the retention window. An item that is not live
    /// is skipped. The result therefore holds fewer entries than the request when a selection
    /// overlaps or an item disappeared first.
    /// </remarks>
    /// <exception cref="UnknownTrashKindException">A requested kind has no registered source.</exception>
    /// <exception cref="TrashSourceUnavailableException">A source could not say whether it holds an item.</exception>
    Task<TrashAction> DeleteAsync(
        IReadOnlyCollection<TrashDeleteRequest> items,
        CancellationToken cancellationToken = default);

    /// <summary>Reads one page of held entries, newest first.</summary>
    Task<TrashPage> ListAsync(TrashListQuery query, CancellationToken cancellationToken = default);

    /// <summary>How many entries are held. This is the number the badge shows.</summary>
    Task<int> CountAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Restores the given entries, one result each. An entry that needs a destination stays held
    /// while its independent neighbours return, so a caller must report partial completion rather
    /// than claiming the whole batch came back.
    /// </summary>
    Task<IReadOnlyList<TrashRestoreResult>> RestoreAsync(
        IReadOnlyCollection<string> entryIds,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default);

    /// <summary>Restores every entry still held from one delete action.</summary>
    Task<IReadOnlyList<TrashRestoreResult>> RestoreBatchAsync(
        string batchId,
        CancellationToken cancellationToken = default);

    /// <summary>Destroys one entry permanently.</summary>
    Task<TrashPurgeResult> PurgeAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Destroys every held entry, oldest first so a separately deleted child is gone before the
    /// parent that contained it. Entries that cannot be destroyed keep their ledger rows.
    /// </summary>
    Task<TrashEmptyResult> EmptyAsync(CancellationToken cancellationToken = default);

    /// <summary>Destroys entries whose retention window has closed. Runs in bounded batches.</summary>
    Task<int> SweepExpiredAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Reconciles the ledger against what the sources actually hold, resolving every state a crash
    /// can leave behind. Completes before the trash becomes available.
    /// </summary>
    Task ReconcileAsync(CancellationToken cancellationToken = default);
}
