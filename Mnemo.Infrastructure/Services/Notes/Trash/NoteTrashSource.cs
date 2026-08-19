using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Persistence;

namespace Mnemo.Infrastructure.Services.Notes.Trash;

/// <summary>
/// The trash's view of one note. A deleted note keeps its blocks, its short id, its version and its
/// images, and comes back as itself rather than as a copy.
/// </summary>
public sealed class NoteTrashSource : ITrashSource
{
    /// <summary>The ledger kind a deleted note is filed under.</summary>
    public const string TrashKind = "note";

    private readonly INoteTrashStore _store;

    public NoteTrashSource(INoteTrashStore store)
    {
        _store = store;
    }

    /// <inheritdoc />
    public string Kind => TrashKind;

    /// <inheritdoc />
    public Task<TrashSnapshot?> PrepareAsync(string itemId, CancellationToken cancellationToken = default) =>
        _store.PrepareNoteAsync(itemId, cancellationToken);

    /// <inheritdoc />
    public Task<TrashSnapshot?> CaptureAsync(string itemId, string entryId, CancellationToken cancellationToken = default) =>
        _store.CaptureNoteAsync(itemId, entryId, cancellationToken);

    /// <inheritdoc />
    public Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default) =>
        // A note can sit at the library root, so it never needs somewhere chosen for it.
        _store.RestoreNoteAsync(entryId, cancellationToken);

    /// <inheritdoc />
    public async Task<TrashPurge> PurgeAsync(string entryId, CancellationToken cancellationToken = default)
    {
        // The images a purged note named are left to the asset sweep. Dropping the note from the index
        // is what makes them unreferenced, and the sweep already refuses to run against a corpus it
        // could not read in full, so nothing is deleted on the strength of a half-finished purge.
        await _store.PurgeNoteAsync(entryId, cancellationToken).ConfigureAwait(false);
        return TrashPurge.Done();
    }

    /// <inheritdoc />
    public Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.NoteHoldsAsync(entryId, cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default) =>
        _store.HeldNoteEntryIdsAsync(cancellationToken);

    /// <inheritdoc />
    public Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        _store.ReleaseNotesAsync(entryIds, cancellationToken);
}
