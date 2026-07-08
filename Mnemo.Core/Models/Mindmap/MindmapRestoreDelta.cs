using System;
using System.Collections.Generic;
using System.Linq;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// A verbatim sub-document delta: the elements, edges and clusters to upsert (restore exactly, by id) and
/// the ids to remove, so that applying it to one document state produces another. It is the transport for
/// command-based undo/redo: each edit batch records the delta that reverses it and the delta that
/// replays it, both scoped to only what the batch touched — so history memory is proportional to the size
/// of the change, not the document.
/// </summary>
/// <remarks>
/// Cluster removal is intentionally absent: a deleted element drops its own cluster settings, and
/// <c>Materialize</c> prunes clusters whose root no longer exists, so upsert-only is sufficient for the
/// edit ops the editor emits today. Layout ops that strip a cluster while keeping its root (P3+) will need
/// explicit cluster removal added here.
/// </remarks>
public sealed record MindmapRestoreDelta
{
    public IReadOnlyList<MindmapElement> Elements { get; init; } = Array.Empty<MindmapElement>();

    public IReadOnlyList<MindmapEdge> Edges { get; init; } = Array.Empty<MindmapEdge>();

    public IReadOnlyList<ClusterSettings> Clusters { get; init; } = Array.Empty<ClusterSettings>();

    public IReadOnlyList<string> RemoveElementIds { get; init; } = Array.Empty<string>();

    public IReadOnlyList<string> RemoveEdgeIds { get; init; } = Array.Empty<string>();

    public bool IsEmpty =>
        Elements.Count == 0 && Edges.Count == 0 && Clusters.Count == 0 &&
        RemoveElementIds.Count == 0 && RemoveEdgeIds.Count == 0;

    /// <summary>
    /// Builds the delta that, applied to <paramref name="from"/>, reproduces <paramref name="to"/>: every
    /// element/edge/cluster present-and-changed or added in <paramref name="to"/> is captured verbatim, and
    /// every id dropped between the two is queued for removal. Value equality on the immutable records means
    /// unchanged rows are skipped (record list members may over-capture, which is safe — never missed).
    /// </summary>
    public static MindmapRestoreDelta Between(MindmapDocument from, MindmapDocument to)
    {
        ArgumentNullException.ThrowIfNull(from);
        ArgumentNullException.ThrowIfNull(to);

        var fromElements = from.Elements.ToDictionary(e => e.Id);
        var toElements = to.Elements.ToDictionary(e => e.Id);
        var elements = toElements.Values
            .Where(e => !fromElements.TryGetValue(e.Id, out var prev) || !prev.Equals(e))
            .ToList();
        var removeElementIds = fromElements.Keys.Where(id => !toElements.ContainsKey(id)).ToList();

        var fromEdges = from.Edges.ToDictionary(e => e.Id);
        var toEdges = to.Edges.ToDictionary(e => e.Id);
        var edges = toEdges.Values
            .Where(e => !fromEdges.TryGetValue(e.Id, out var prev) || !prev.Equals(e))
            .ToList();
        var removeEdgeIds = fromEdges.Keys.Where(id => !toEdges.ContainsKey(id)).ToList();

        var fromClusters = from.Clusters.ToDictionary(c => c.RootId);
        var toClusters = to.Clusters.ToDictionary(c => c.RootId);
        var clusters = toClusters.Values
            .Where(c => !fromClusters.TryGetValue(c.RootId, out var prev) || !prev.Equals(c))
            .ToList();

        return new MindmapRestoreDelta
        {
            Elements = elements,
            Edges = edges,
            Clusters = clusters,
            RemoveElementIds = removeElementIds,
            RemoveEdgeIds = removeEdgeIds,
        };
    }
}
