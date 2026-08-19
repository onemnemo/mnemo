using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Infrastructure.Services.Mindmap.Trash;

/// <summary>
/// The trash's view of one mindmap folder. Deleting a folder takes the maps and subfolders inside it,
/// and restoring brings the same subtree back the way it stood.
/// </summary>
/// <remarks>
/// This replaces the older behaviour where deleting a folder scattered its maps to the library root.
/// A folder is how someone organizes their work, and losing that arrangement to a delete that was
/// meant to be undoable is the thing the trash exists to prevent.
/// </remarks>
public sealed class MindmapFolderTrashSource : ITrashSource
{
    /// <summary>The ledger kind a deleted mindmap folder is filed under.</summary>
    public const string TrashKind = "mindmap-folder";

    private readonly IMindmapTrashStore _store;

    public MindmapFolderTrashSource(IMindmapTrashStore store)
    {
        _store = store;
    }

    /// <inheritdoc />
    public string Kind => TrashKind;

    /// <inheritdoc />
    public Task<TrashSnapshot?> PrepareAsync(string itemId, CancellationToken cancellationToken = default) =>
        _store.PrepareFolderAsync(itemId, cancellationToken);

    /// <inheritdoc />
    public Task<TrashSnapshot?> CaptureAsync(string itemId, string entryId, CancellationToken cancellationToken = default) =>
        _store.CaptureFolderAsync(itemId, entryId, cancellationToken);

    /// <inheritdoc />
    public Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default) =>
        // A folder can sit at the library root, so it never needs somewhere chosen for it.
        _store.RestoreFolderAsync(entryId, cancellationToken);

    /// <inheritdoc />
    public Task<TrashPurge> PurgeAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.PurgeFolderAsync(entryId, cancellationToken);

    /// <inheritdoc />
    public Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.FolderHoldsAsync(entryId, cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default) =>
        _store.HeldFolderEntryIdsAsync(cancellationToken);

    /// <inheritdoc />
    public Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        _store.ReleaseFoldersAsync(entryIds, cancellationToken);
}
