using System.Collections.Generic;
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
/// <param name="Ver">The note's version after the call: the new one when applied, the current one otherwise.</param>
public readonly record struct NoteCommitResult(NoteCommitOutcome Outcome, long Ver)
{
    public bool IsSuccess => Outcome is NoteCommitOutcome.Applied or NoteCommitOutcome.AlreadyApplied;
}

/// <summary>
/// Everything about a note that is not its body. This type is the field list: a write that carries a
/// <see cref="NoteMetadata"/> can only change what is named here, which is what lets a rename and a
/// keystroke land in either order without one undoing the other.
/// </summary>
public sealed record NoteMetadata(
    string Title,
    string? FolderId,
    string? ParentNoteId,
    int Order,
    bool IsFavorite,
    string? Emoji,
    string? Cover,
    IReadOnlyList<string> Tags,
    string FolderPath)
{
    /// <summary>Reads the current metadata off a note, for a caller changing only part of it.</summary>
    public static NoteMetadata FromNote(Note note)
    {
        ArgumentNullException.ThrowIfNull(note);
        return new NoteMetadata(
            note.Title,
            note.FolderId,
            note.ParentNoteId,
            note.Order,
            note.IsFavorite,
            note.Emoji,
            note.Cover,
            note.Tags is null ? [] : [.. note.Tags],
            note.FolderPath);
    }

    /// <summary>Writes this metadata onto a note, leaving its body, identity and version alone.</summary>
    public void ApplyTo(Note note)
    {
        ArgumentNullException.ThrowIfNull(note);
        note.Title = Title;
        note.FolderId = FolderId;
        note.ParentNoteId = ParentNoteId;
        note.Order = Order;
        note.IsFavorite = IsFavorite;
        note.Emoji = Emoji;
        note.Cover = Cover;
        note.Tags = Tags is null ? [] : [.. Tags];
        note.FolderPath = FolderPath;
    }
}

/// <summary>
/// The single transactional writer for notes. It exists because a note's snapshot and the index that
/// projects it must land together or not at all: the generic key/value provider writes one key per
/// call, so the old two-call save could leave a note stored but unindexed if the process died between
/// them.
///
/// Every write here reads the stored note inside its own transaction and changes only the fields that
/// write owns. Reading outside the transaction and writing the whole note back is how a rename ends
/// up reverting a commit that landed while the rename was being validated.
/// </summary>
public interface INoteCommitStore
{
    Task InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Compare-and-swap a note's body. Applies only when <paramref name="baseVer"/> still matches the
    /// stored version, and increments it by one. <paramref name="requestId"/> makes the call
    /// idempotent: replaying the same one is recognised rather than rejected as stale.
    /// <para>
    /// Only the blocks move. Title, filing, tags, identity and timestamps are read from storage inside
    /// the transaction, so a commit cannot revert a rename that landed while it was in flight.
    /// </para>
    /// </summary>
    Task<NoteCommitResult> CommitAsync(string noteId, IReadOnlyList<Block>? blocks, long baseVer, string requestId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Writes a note's metadata without touching its body and without advancing its version.
    /// <para>
    /// The version counts body revisions, so advancing it here would invalidate the edit token of
    /// every editor that has the note open, for a change none of them made, and their next save would
    /// come back as a conflict that nothing can resolve. Returns <see cref="NoteCommitOutcome.NotFound"/>
    /// when no such note is stored.
    /// </para>
    /// </summary>
    Task<NoteCommitResult> UpdateMetadataAsync(string noteId, NoteMetadata metadata, CancellationToken cancellationToken = default);

    /// <summary>
    /// Writes a whole note and its index entry in one transaction without a version check, for the
    /// paths that create or restore a note rather than edit an open one. Advances the version.
    /// <para>
    /// Identity is the store's to hand out, not the caller's: a stored note keeps the sid it already
    /// has, a new one is minted a sid that no other note holds, and block sids are repaired so no
    /// write path can leave a note the editor can no longer address.
    /// </para>
    /// </summary>
    Task<NoteCommitResult> PutAsync(Note note, CancellationToken cancellationToken = default);

    /// <summary>Removes the note and its index entry in one transaction.</summary>
    Task<bool> DeleteAsync(string noteId, CancellationToken cancellationToken = default);
}
