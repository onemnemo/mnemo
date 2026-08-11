using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// Turns a document into the moves that arrange it.
/// <para>
/// The desktop runs layout after every edit, so a node never needs a position of its own. The SPA does
/// not: it is freeform until someone asks, which is what makes a map draggable without a layout engine
/// quietly undoing the drag. Arrange is that asking, and it is expressed as a batch of ordinary move
/// ops rather than as its own kind of write. That is the whole design: an arrange is revision checked
/// like any edit, it is one entry in the undo stack, and Ctrl+Z puts every node back where it was.
/// </para>
/// </summary>
internal static class MindmapArrange
{
    /// <summary>Vertical air between two root trees when they are stacked, matching the desktop.</summary>
    private const double ClusterGap = 64;

    /// <summary>
    /// What a node is assumed to be when nobody measured it.
    /// <para>
    /// A last resort. Node size here is the width of rendered text, which only the client that rendered
    /// it knows, so the request carries the measurements and this is what a node missing from them gets.
    /// Layouts space siblings by height and rank them by width, so a wrong size is a crowded map rather
    /// than a broken one.
    /// </para>
    /// </summary>
    private const double DefaultWidth = 120;
    private const double DefaultHeight = 32;

    /// <summary>
    /// Lays every cluster out and returns one move per node whose position actually changed.
    /// </summary>
    /// <remarks>
    /// Stored pins are deliberately ignored. Repositioning implies pinning, and the SPA gives every node
    /// it creates or drags an explicit position, so honoring pins here would make Arrange a no-op on
    /// exactly the maps people have been working in. A pin records that a coordinate was meant, and
    /// asking for an arrange is saying you no longer mean it.
    /// </remarks>
    public static async Task<IReadOnlyList<MindmapEditOp>> ComputeAsync(
        MindmapDocument document,
        IReadOnlyDictionary<string, MindmapArrangeSize> sizes,
        string? algorithm,
        IMindmapLayoutService layout,
        CancellationToken cancellationToken)
    {
        var nodeById = document.Elements
            .Where(e => e.Kind == ElementKind.Node)
            .ToDictionary(e => e.Id);
        if (nodeById.Count == 0)
            return Array.Empty<MindmapEditOp>();

        var childrenOf = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var parentOf = new Dictionary<string, string>(StringComparer.Ordinal);
        var orderOf = new Dictionary<string, int>(StringComparer.Ordinal);

        // Sibling order IS the hierarchy edge array's order. Nothing else stores it, so reading the edges
        // in document order is not a shortcut, it is the definition.
        foreach (var edge in document.Edges)
        {
            if (edge.Kind != EdgeKind.Hierarchy) continue;
            if (!nodeById.ContainsKey(edge.FromId) || !nodeById.ContainsKey(edge.ToId)) continue;

            if (!childrenOf.TryGetValue(edge.FromId, out var kids))
            {
                kids = new List<string>();
                childrenOf[edge.FromId] = kids;
            }
            orderOf[edge.ToId] = kids.Count;
            kids.Add(edge.ToId);
            parentOf[edge.ToId] = edge.FromId;
        }

        var clusterSettings = document.Clusters.ToDictionary(c => c.RootId, StringComparer.Ordinal);
        var placed = new Dictionary<string, LayoutPosition>(StringComparer.Ordinal);
        var stackTop = 0.0;

        // In document order, so arranging the same map twice lays the clusters out the same way round.
        foreach (var root in document.Elements.Where(e => e.Kind == ElementKind.Node && !parentOf.ContainsKey(e.Id)))
        {
            var nodes = Collect(root.Id, nodeById, childrenOf, parentOf, orderOf, sizes);
            var settings = clusterSettings.GetValueOrDefault(root.Id);

            var snapshot = new LayoutSnapshot
            {
                RootId = root.Id,
                Nodes = nodes,
                Algorithm = algorithm ?? settings?.LayoutAlgorithm ?? MindmapLayoutAlgorithms.Balanced,
                Options = settings?.Options,
                Revision = document.Revision,
            };

            var computed = await layout.ComputeAsync(snapshot, cancellationToken).ConfigureAwait(false);
            if (!computed.IsSuccess || computed.Value is null)
                continue;

            Stack(placed, computed.Value.Positions, nodes, ref stackTop);
        }

        var moves = new List<MindmapEditOp>();
        foreach (var (id, position) in placed)
        {
            var element = nodeById[id];
            var x = Math.Round(position.X);
            var y = Math.Round(position.Y);
            // A move that changes nothing is still a move to the undo stack and to every other session
            // listening for changes, so it is not free and it is not sent.
            if (x == Math.Round(element.X) && y == Math.Round(element.Y))
                continue;
            moves.Add(new MoveOp { Id = id, X = x, Y = y });
        }

        return moves;
    }

    private static List<LayoutNode> Collect(
        string rootId,
        IReadOnlyDictionary<string, MindmapElement> nodeById,
        IReadOnlyDictionary<string, List<string>> childrenOf,
        IReadOnlyDictionary<string, string> parentOf,
        IReadOnlyDictionary<string, int> orderOf,
        IReadOnlyDictionary<string, MindmapArrangeSize> sizes)
    {
        var nodes = new List<LayoutNode>();
        var stack = new Stack<string>();
        stack.Push(rootId);

        while (stack.Count > 0)
        {
            var id = stack.Pop();
            var element = nodeById[id];
            var size = sizes.GetValueOrDefault(id);

            nodes.Add(new LayoutNode
            {
                Id = id,
                ParentId = parentOf.GetValueOrDefault(id),
                Order = orderOf.GetValueOrDefault(id),
                Width = size.Width > 0 ? size.Width : element.Width ?? DefaultWidth,
                Height = size.Height > 0 ? size.Height : element.Height ?? DefaultHeight,
                Collapsed = element.Collapsed,
                X = element.X,
                Y = element.Y,
            });

            if (!childrenOf.TryGetValue(id, out var kids)) continue;
            // Pushed in reverse so the pop order is sibling order, which the layout providers rely on.
            for (var i = kids.Count - 1; i >= 0; i--)
                stack.Push(kids[i]);
        }

        return nodes;
    }

    /// <summary>
    /// Drops one cluster's positions below whatever has been placed already, so two root trees never
    /// land on top of each other. Each cluster is laid out about its own origin, so without this every
    /// tree in the document would be arranged into the same space.
    /// </summary>
    private static void Stack(
        Dictionary<string, LayoutPosition> placed,
        IReadOnlyDictionary<string, LayoutPosition> cluster,
        IReadOnlyList<LayoutNode> nodes,
        ref double stackTop)
    {
        if (cluster.Count == 0)
            return;

        var heightById = nodes.ToDictionary(n => n.Id, n => n.Height, StringComparer.Ordinal);
        var minY = double.MaxValue;
        var maxY = double.MinValue;
        foreach (var (id, position) in cluster)
        {
            minY = Math.Min(minY, position.Y);
            maxY = Math.Max(maxY, position.Y + heightById.GetValueOrDefault(id, DefaultHeight));
        }

        var dy = stackTop - minY;
        foreach (var (id, position) in cluster)
            placed[id] = new LayoutPosition(position.X, position.Y + dy);
        stackTop = maxY + dy + ClusterGap;
    }
}

/// <summary>
/// One node's rendered size, as measured by the client that drew it.
/// <para>
/// A struct with a zero default on purpose: a node the request said nothing about reads as 0 by 0 and
/// falls through to the document's stored size, and then to a default.
/// </para>
/// </summary>
internal readonly record struct MindmapArrangeSize(double Width, double Height);
