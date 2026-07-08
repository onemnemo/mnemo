using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// A single node in a <see cref="LayoutSnapshot"/>: the structural facts a layout needs and nothing else
/// (no content, no style). <see cref="X"/>/<see cref="Y"/> are the node's current top-left position,
/// used as a fixed anchor when <see cref="Pinned"/> and as the result for the <c>free</c> algorithm.
/// </summary>
public readonly record struct LayoutNode
{
    public required string Id { get; init; }

    /// <summary>Hierarchy parent id, or null for the cluster root.</summary>
    public string? ParentId { get; init; }

    /// <summary>Order among siblings (ascending); the layout lays children out in this order.</summary>
    public int Order { get; init; }

    public double Width { get; init; }

    public double Height { get; init; }

    /// <summary>Descendants are hidden and excluded from layout; the node itself is still placed.</summary>
    public bool Collapsed { get; init; }

    /// <summary>Fixed anchor: keeps its current <see cref="X"/>/<see cref="Y"/> instead of being flowed.</summary>
    public bool Pinned { get; init; }

    public double X { get; init; }

    public double Y { get; init; }
}

/// <summary>A computed top-left position for one node.</summary>
public readonly record struct LayoutPosition(double X, double Y);

/// <summary>
/// An immutable structural copy of ONE cluster, built by the editor at commit time and handed to
/// the layout engine off the UI thread. Carries node ids, sizes, sibling order and collapsed/pinned flags,
/// the chosen algorithm and its spacing overrides, plus the document <see cref="Revision"/> it was taken at
/// so a stale result (structure changed since) can be discarded.
/// </summary>
public sealed record LayoutSnapshot
{
    /// <summary>Cluster root node id.</summary>
    public required string RootId { get; init; }

    /// <summary>Every node in the cluster (the root and its descendants), in no particular order.</summary>
    public required IReadOnlyList<LayoutNode> Nodes { get; init; }

    /// <summary>Layout algorithm id (open registry; see <see cref="MindmapLayoutAlgorithms"/>).</summary>
    public string Algorithm { get; init; } = MindmapLayoutAlgorithms.Balanced;

    public LayoutOptions? Options { get; init; }

    /// <summary>Document revision this snapshot was taken at.</summary>
    public long Revision { get; init; }
}

/// <summary>
/// The output of a layout pass: new top-left positions for the (visible) nodes of one cluster, tagged with
/// the <see cref="Revision"/> the snapshot was taken at so the caller can drop a result the document has
/// already moved past.
/// </summary>
public sealed record LayoutResult
{
    public required IReadOnlyDictionary<string, LayoutPosition> Positions { get; init; }

    public long Revision { get; init; }

    public static LayoutResult Empty { get; } = new()
    {
        Positions = new Dictionary<string, LayoutPosition>(),
    };
}
