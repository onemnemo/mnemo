using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Infrastructure.Services.Mindmap.Trash;

/// <summary>
/// The trash's view of one mindmap. A map is taken on its own: it contains nothing else, and nothing
/// else contains it in a way a database cascade could destroy.
/// </summary>
public sealed class MindmapTrashSource : ITrashSource
{
    /// <summary>The ledger kind a deleted mindmap is filed under.</summary>
    public const string TrashKind = "mindmap";

    private readonly IMindmapTrashStore _store;

    public MindmapTrashSource(IMindmapTrashStore store)
    {
        _store = store;
    }

    /// <inheritdoc />
    public string Kind => TrashKind;

    /// <inheritdoc />
    public Task<TrashSnapshot?> PrepareAsync(string itemId, CancellationToken cancellationToken = default) =>
        _store.PrepareMapAsync(itemId, cancellationToken);

    /// <inheritdoc />
    public Task<TrashSnapshot?> CaptureAsync(string itemId, string entryId, CancellationToken cancellationToken = default) =>
        _store.CaptureMapAsync(itemId, entryId, cancellationToken);

    /// <inheritdoc />
    public Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default) =>
        // A map can sit at the library root, so it never needs somewhere chosen for it.
        _store.RestoreMapAsync(entryId, cancellationToken);

    /// <inheritdoc />
    public async Task<TrashPurge> PurgeAsync(string entryId, CancellationToken cancellationToken = default)
    {
        await _store.PurgeMapAsync(entryId, cancellationToken).ConfigureAwait(false);
        return TrashPurge.Done();
    }

    /// <inheritdoc />
    public Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.MapHoldsAsync(entryId, cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default) =>
        _store.HeldMapEntryIdsAsync(cancellationToken);

    /// <inheritdoc />
    public Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        _store.ReleaseMapsAsync(entryIds, cancellationToken);
}
