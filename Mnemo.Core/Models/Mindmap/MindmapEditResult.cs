using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Precise, actionable failure codes for an edit batch. A small local model will send malformed batches,
/// so these must be exact.
/// </summary>
public enum MindmapEditErrorCode
{
    /// <summary>Genuine concurrent contention on referenced ids, or a revision outside the rebase window.</summary>
    RevConflict,

    /// <summary>A referenced element or edge id does not exist.</summary>
    NotFound,

    /// <summary>A reparent would create a hierarchy cycle.</summary>
    WouldCycle,

    /// <summary>Content kind is incompatible with the target element kind, or an op targets the wrong kind.</summary>
    BadContentType,

    /// <summary>The op is structurally malformed (e.g. empty node list, missing required anchor).</summary>
    InvalidOperation,
}

/// <summary>Details of the op that caused a batch to fail. Batches are transactional — all or nothing.</summary>
public sealed record MindmapEditError
{
    public required MindmapEditErrorCode Code { get; init; }

    public required string Message { get; init; }

    /// <summary>Index into the submitted ops list of the failing op, when applicable.</summary>
    public int? FailedOpIndex { get; init; }

    /// <summary>For <see cref="MindmapEditErrorCode.RevConflict"/>: the contended element/edge ids.</summary>
    public IReadOnlyList<string>? ContendedIds { get; init; }

    /// <summary>For <see cref="MindmapEditErrorCode.NotFound"/>: nearest-text id suggestions.</summary>
    public IReadOnlyList<string>? Suggestions { get; init; }
}

/// <summary>
/// What a write answers with, whoever made it: a canvas gesture, an arrange, a rename, an AI tool call or
/// an import. On success, <see cref="CreatedIds"/> maps caller ref keys to assigned short ids,
/// <see cref="Revision"/> is the new document revision, and the delta pair plus <see cref="Order"/> are
/// everything a holder of the previous state needs to catch up without refetching. On failure,
/// <see cref="Error"/> is set, <see cref="Success"/> is false, and nothing was persisted.
/// </summary>
/// <remarks>
/// <see cref="BaseRevision"/> is the load-bearing field and the reason the deltas are computed by the
/// service rather than by a caller reading the document either side of the write. A caller reads it as a
/// precondition: fold <see cref="Redo"/> only into a document at exactly that revision, and replay
/// <see cref="Undo"/> only against exactly <see cref="Revision"/>. A stale batch that rebased server-side
/// commits against a document the caller never held, and its <see cref="BaseRevision"/> says so.
/// </remarks>
public sealed record MindmapEditResult
{
    public required bool Success { get; init; }

    /// <summary>The document revision after the write (unchanged from the request on failure).</summary>
    public long Revision { get; init; }

    /// <summary>
    /// The revision the write actually applied against, which is <see cref="Revision"/> minus one on
    /// success. It is not always the revision the caller asked for: a stale but non-contending batch is
    /// rebased onto the current document, and this is what it was rebased onto.
    /// </summary>
    public long BaseRevision { get; init; }

    /// <summary>Caller ref key to assigned short id, for elements/edges created by the write.</summary>
    public IReadOnlyDictionary<string, string> CreatedIds { get; init; } =
        new Dictionary<string, string>();

    /// <summary>Total elements removed by delete ops (including cascaded descendants).</summary>
    public int DeletedCount { get; init; }

    /// <summary>
    /// The delta that reverses this write: applied to the document at <see cref="Revision"/>, it produces
    /// the state at <see cref="BaseRevision"/>. Null on failure and when the write changed nothing.
    /// </summary>
    public MindmapRestoreDelta? Undo { get; init; }

    /// <summary>
    /// The delta that replays this write: applied to the document at <see cref="BaseRevision"/>, it
    /// produces the state at <see cref="Revision"/>. Null on failure and when the write changed nothing.
    /// </summary>
    public MindmapRestoreDelta? Redo { get; init; }

    /// <summary>The committed document's element and edge order, without which a delta cannot be folded.</summary>
    public MindmapDocumentOrder? Order { get; init; }

    public MindmapEditError? Error { get; init; }

    public static MindmapEditResult Failure(MindmapEditError error, long revision) =>
        new() { Success = false, Revision = revision, BaseRevision = revision, Error = error };
}
