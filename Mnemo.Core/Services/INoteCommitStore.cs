using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>Why a commit did not apply, or that it did.</summary>
public enum NoteCommitOutcome
{
    /// <summary>The snapshot was written and <see cref="NoteCommitResult.Ver"/> is the new version.</summary>
    Applied,

    /// <summary>
    /// This exact request had already been applied, so nothing was written and the stored version is
    /// returned unchanged. A client that retried after a lost acknowledgement sees success, which is
    /// the point: retrying must not be punished as a conflict.
    /// </summary>
    AlreadyApplied,

    /// <summary>
    /// The note moved on since the base version the client edited. Nothing was written; the caller
    /// must rebase on <see cref="NoteCommitResult.Ver"/> rather than retry as-is.
    /// </summary>
    Stale,

    /// <summary>No such note.</summary>
    NotFound,
}

/// <param name="Outcome">What happened.</param>
/// <param name="Ver">The note's version after the call — the new one when applied, the current one otherwise.</param>
public readonly record struct NoteCommitResult(NoteCommitOutcome Outcome, long Ver)
{
    public bool IsSuccess => Outcome is NoteCommitOutcome.Applied or NoteCommitOutcome.AlreadyApplied;
}

/// <summary>
/// The single transactional writer for notes. It exists because a note's snapshot and the index that
/// projects it must land together or not at all: the generic key/value provider writes one key per
/// call, so the old two-call save could leave a note stored but unindexed if the process died between
/// them.
///
/// It is also the only place a note's version advances, which is what makes a stale write detectable
/// rather than silently last-write-wins.
/// </summary>
public interface INoteCommitStore
{
    Task InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Compare-and-swap a complete note snapshot. Applies only when <paramref name="baseVer"/> still
    /// matches the stored version, and increments it by one. <paramref name="requestId"/> makes the
    /// call idempotent: replaying the same one is recognised rather than rejected as stale.
    /// </summary>
    Task<NoteCommitResult> CommitAsync(Note note, long baseVer, string requestId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Writes a note and its index entry in one transaction without a version check, for the paths
    /// that create or re-file a note rather than edit its body. Advances the version, so a content
    /// write racing a rename still fails closed instead of overwriting it.
    /// </summary>
    Task<NoteCommitResult> PutAsync(Note note, CancellationToken cancellationToken = default);

    /// <summary>Removes the note and its index entry in one transaction.</summary>
    Task<bool> DeleteAsync(string noteId, CancellationToken cancellationToken = default);
}
