using System;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>What kind of document change a <see cref="MindmapChangedEventArgs"/> reports.</summary>
public enum MindmapChangeKind
{
    /// <summary>A new document was created (or duplicated into existence).</summary>
    Created,

    /// <summary>An edit batch or restore committed against an existing document.</summary>
    Edited,

    /// <summary>The document title changed.</summary>
    Renamed,

    /// <summary>The document was deleted.</summary>
    Deleted,
}

/// <summary>
/// Notification that a mindmap document changed. Raised by <see cref="Services.IMindmapService.Changed"/>
/// after a mutation commits, so an open editor session can mirror headless (tool) edits live.
/// </summary>
public sealed class MindmapChangedEventArgs : EventArgs
{
    public required string MapId { get; init; }

    /// <summary>The committed revision. For <see cref="MindmapChangeKind.Deleted"/>, the last revision before deletion.</summary>
    public long Revision { get; init; }

    public MindmapChangeKind Kind { get; init; }

    /// <summary>
    /// What the write did, when there is a caller who could act on it: the delta pair, the order and the
    /// revision it applied against. Null for a delete, which has no post-image to describe.
    /// <para>
    /// It is here so that a change nobody in the open editor made, an AI tool call or an import, can still
    /// be taken back with one Ctrl+Z. Without it the only honest response to someone else's write is to
    /// refetch the document and drop the undo stack, which means an assistant that rewrites half a map
    /// leaves the user with nothing to press.
    /// </para>
    /// </summary>
    public MindmapEditResult? Change { get; init; }
}
