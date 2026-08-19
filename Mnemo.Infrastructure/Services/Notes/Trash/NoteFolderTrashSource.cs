using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Persistence;

namespace Mnemo.Infrastructure.Services.Notes.Trash;

/// <summary>
/// The trash's view of one note folder. Deleting a folder takes the notes and subfolders inside it,
/// and restoring brings the same subtree back the way it stood.
/// </summary>
/// <remarks>
/// This replaces the older behaviour where deleting a folder scattered its notes to the root. That
/// rule existed so a folder delete could never destroy a note; with the trash holding the whole
/// subtree, the arrangement survives too, and nothing is destroyed either way.
/// </remarks>
public sealed class NoteFolderTrashSource : ITrashSource
{
    /// <summary>The ledger kind a deleted note folder is filed under.</summary>
    public const string TrashKind = "note-folder";

    private readonly INoteTrashStore _store;

    public NoteFolderTrashSource(INoteTrashStore store)
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
