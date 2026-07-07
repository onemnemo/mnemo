using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Precise, actionable failure codes for an edit batch. A small local model will send malformed
/// batches, so these must be exact.
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
/// Outcome of an <c>ApplyAsync</c> batch. On success, <see cref="CreatedIds"/> maps caller ref keys to
/// assigned short ids and <see cref="Revision"/> is the new document revision. On failure,
/// <see cref="Error"/> is set, <see cref="Success"/> is false, and nothing was persisted.
/// </summary>
public sealed record MindmapEditResult
{
    public required bool Success { get; init; }

    /// <summary>The document revision after the batch (unchanged from the request on failure).</summary>
    public long Revision { get; init; }

    /// <summary>Caller ref key → assigned short id, for elements/edges created by the batch.</summary>
    public IReadOnlyDictionary<string, string> CreatedIds { get; init; } =
        new Dictionary<string, string>();

    /// <summary>Total elements removed by delete ops (including cascaded descendants).</summary>
    public int DeletedCount { get; init; }

    public MindmapEditError? Error { get; init; }

    public static MindmapEditResult Failure(MindmapEditError error, long revision) =>
        new() { Success = false, Revision = revision, Error = error };
}
