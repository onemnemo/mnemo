using System;
using System.Collections.Generic;
using System.Linq;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// A verbatim sub-document delta: the elements, edges and clusters to upsert (restore exactly, by id) and
/// the ids to remove, so that applying it to one document state produces another. It is the transport for
/// command-based undo and redo: each write records the delta that reverses it and the delta that replays
/// it, both scoped to only what the write touched, so history memory is proportional to the size of the
/// change rather than to the document.
/// </summary>
/// <remarks>
/// Cluster removal is intentionally absent: a deleted element drops its own cluster settings, and
/// <c>Materialize</c> prunes clusters whose root no longer exists, so upsert-only is sufficient for the
/// edit ops the editor emits today. A layout op that strips a cluster while keeping its root would need
/// explicit cluster removal added here.
/// </remarks>
public sealed record MindmapRestoreDelta
{
    public IReadOnlyList<MindmapElement> Elements { get; init; } = Array.Empty<MindmapElement>();

    public IReadOnlyList<MindmapEdge> Edges { get; init; } = Array.Empty<MindmapEdge>();

    public IReadOnlyList<ClusterSettings> Clusters { get; init; } = Array.Empty<ClusterSettings>();

    public IReadOnlyList<string> RemoveElementIds { get; init; } = Array.Empty<string>();

    public IReadOnlyList<string> RemoveEdgeIds { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Where each element in <see cref="Elements"/> that the target does not already hold goes. A row
    /// with no placement is appended, which is also where a changed row that is still present stays.
    /// Ordered so that a placement's anchor is either already in the document or placed earlier in this
    /// list, so applying them in order never meets an anchor that is not there yet.
    /// </summary>
    public IReadOnlyList<MindmapRestorePlacement> ElementPlacements { get; init; } = Array.Empty<MindmapRestorePlacement>();

    /// <summary>
    /// The same for <see cref="Edges"/>. Edge order is sibling order, so this is what puts a deleted
    /// first child back first.
    /// </summary>
    public IReadOnlyList<MindmapRestorePlacement> EdgePlacements { get; init; } = Array.Empty<MindmapRestorePlacement>();

    /// <summary>
    /// The whole canvas, when the batch changed any part of it; null when it did not.
    /// <para>
    /// Whole rather than per-property because it is one small record and there is nothing to save by
    /// splitting it. It is carried at all because the map's own settings, its background, its default
    /// template and its edge defaults, are not attached to any element, so a delta made only of touched
    /// rows would come back empty for them and an undo would restore nothing.
    /// </para>
    /// </summary>
    public MindmapCanvasOptions? Canvas { get; init; }

    /// <summary>
    /// The document title, when the write changed it; null when it did not.
    /// <para>
    /// Carried for the same reason the canvas is: a title belongs to the document rather than to any
    /// element, so a delta made only of touched rows comes back empty for a rename and undoing one would
    /// restore nothing. It is what lets a rename be an ordinary write rather than a second kind.
    /// </para>
    /// </summary>
    public string? Title { get; init; }

    public bool IsEmpty =>
        Elements.Count == 0 && Edges.Count == 0 && Clusters.Count == 0 &&
        RemoveElementIds.Count == 0 && RemoveEdgeIds.Count == 0 && Canvas is null && Title is null;

    /// <summary>
    /// Builds the delta that, applied to <paramref name="from"/>, reproduces <paramref name="to"/>: every
    /// element/edge/cluster present-and-changed or added in <paramref name="to"/> is captured verbatim, and
    /// every id dropped between the two is queued for removal. Value equality on the immutable records means
    /// unchanged rows are skipped (record list members may over-capture, which is safe, never missed).
    /// A row <paramref name="from"/> lacks is placed after the row before it in <paramref name="to"/>.
    /// </summary>
    public static MindmapRestoreDelta Between(MindmapDocument from, MindmapDocument to)
    {
        ArgumentNullException.ThrowIfNull(from);
        ArgumentNullException.ThrowIfNull(to);

        var (elements, elementPlacements, removeElementIds) = Diff(from.Elements, to.Elements, e => e.Id);
        var (edges, edgePlacements, removeEdgeIds) = Diff(from.Edges, to.Edges, e => e.Id);

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
            ElementPlacements = elementPlacements,
            EdgePlacements = edgePlacements,
            Canvas = to.Canvas.Equals(from.Canvas) ? null : to.Canvas,
            Title = string.Equals(to.Title, from.Title, StringComparison.Ordinal) ? null : to.Title,
        };
    }

    /// <summary>
    /// Walks <paramref name="to"/> in its own order, so the changed rows come out in target order and each
    /// added row's anchor is a row that is either untouched or listed before it.
    /// </summary>
    private static (List<T> Changed, List<MindmapRestorePlacement> Placements, List<string> Removed) Diff<T>(
        IReadOnlyList<T> from, IReadOnlyList<T> to, Func<T, string> id)
        where T : IEquatable<T>
    {
        var fromById = from.ToDictionary(id);
        var toIds = new HashSet<string>(to.Select(id));
        var changed = new List<T>();
        var placements = new List<MindmapRestorePlacement>();

        string? previous = null;
        foreach (var row in to)
        {
            var rowId = id(row);
            if (!fromById.TryGetValue(rowId, out var prev))
            {
                changed.Add(row);
                placements.Add(new MindmapRestorePlacement(rowId, previous));
            }
            else if (!prev.Equals(row))
            {
                changed.Add(row);
            }

            previous = rowId;
        }

        var removed = from.Select(id).Where(rowId => !toIds.Contains(rowId)).ToList();
        return (changed, placements, removed);
    }
}
