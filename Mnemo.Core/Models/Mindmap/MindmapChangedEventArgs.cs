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
}
