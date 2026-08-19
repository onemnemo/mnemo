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
    /// Lays every cluster out and returns one move per node whose position actually changed, plus, when
    /// an algorithm was named, the ops that record it as each cluster's arrangement.
    /// </summary>
    /// <remarks>
    /// A pinned node keeps its coordinate: that is the whole meaning of the pin, and the layout honors it
    /// already, so an arrange emits no move for one. The moves this produces are themselves unpinned, so
    /// arranging a map twice does not quietly pin every node in it.
    /// <para>
    /// Frame membership holds a node the same way a pin does. A frame is drawn around whatever it holds
    /// rather than at a stored box, so an arrange that flowed its members across the map would not empty
    /// the frame, it would stretch it over everything they landed on. Being in one is a position someone
    /// chose, so an arrange leaves it alone.
    /// </para>
    /// </remarks>
    public static async Task<IReadOnlyList<MindmapEditOp>> ComputeAsync(
        MindmapDocument document,
        IReadOnlyDictionary<string, MindmapArrangeSize> sizes,
        string? algorithm,
        IMindmapLayoutService layout,
        CancellationToken cancellationToken)
    {
        // First occurrence wins rather than throwing on a repeat. An id is unique in any document a write
        // produced, but arrange also runs on documents this build did not write, and refusing to tidy a
        // map because it carries a duplicate leaves the user no way to see what is wrong with it.
        var nodeById = new Dictionary<string, MindmapElement>(StringComparer.Ordinal);
        foreach (var element in document.Elements)
        {
            if (element.Kind == ElementKind.Node)
                nodeById.TryAdd(element.Id, element);
        }

        if (nodeById.Count == 0)
            return Array.Empty<MindmapEditOp>();

        var framed = FramedIds(document, nodeById);
        var held = HeldBoxes(nodeById, framed, sizes);

        var childrenOf = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var parentOf = new Dictionary<string, string>(StringComparer.Ordinal);

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
            kids.Add(edge.ToId);
            parentOf[edge.ToId] = edge.FromId;
        }

        var clusterSettings = new Dictionary<string, ClusterSettings>(StringComparer.Ordinal);
        foreach (var cluster in document.Clusters)
            clusterSettings.TryAdd(cluster.RootId, cluster);

        var placed = new Dictionary<string, LayoutPosition>(StringComparer.Ordinal);
        var chosen = new List<MindmapEditOp>();
        var stackTop = 0.0;

        // Shared across every cluster, not per cluster. A document is meant to be a forest, but one
        // written by an older build or hand-edited into a package can hold a cycle or a second parent,
        // and a write is only refused when the state it replaced was sound, so a broken map stays
        // openable on purpose. Claiming each node once keeps the walk finite and keeps a node that two
        // roots can reach out of both node lists, which is what a layout needs to be handed.
        var claimed = new HashSet<string>(StringComparer.Ordinal);

        // In document order, so arranging the same map twice lays the clusters out the same way round.
        foreach (var root in document.Elements.Where(e => e.Kind == ElementKind.Node && !parentOf.ContainsKey(e.Id)))
        {
            var nodes = Collect(root.Id, nodeById, childrenOf, sizes, framed, claimed);
            if (nodes.Count == 0)
                continue;
            var settings = clusterSettings.GetValueOrDefault(root.Id);

            // Asking for a named arrangement is also choosing it. Recorded in the same batch as the moves
            // it produced, so the choice and the layout it caused are one undo rather than two, and so a
            // later arrange with nothing named still uses the arrangement last picked.
            if (algorithm is not null && !string.Equals(settings?.LayoutAlgorithm, algorithm, StringComparison.Ordinal))
                chosen.Add(new LayoutOp { Root = root.Id, Algorithm = algorithm });

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

            Merge(placed, computed.Value.Positions, nodes, root.Pinned || framed.Contains(root.Id), held, ref stackTop);
        }

        var moves = new List<MindmapEditOp>(chosen);
        foreach (var (id, position) in placed)
        {
            var element = nodeById[id];
            var x = Math.Round(position.X);
            var y = Math.Round(position.Y);
            // A move that changes nothing is still a move to the undo stack and to every other session
            // listening for changes, so it is not free and it is not sent.
            if (x == Math.Round(element.X) && y == Math.Round(element.Y))
                continue;
            // Unpinned: the layout chose this coordinate, the author did not. Without that a single
            // arrange would pin the whole map and every arrange after it would have nothing left to do.
            moves.Add(new MoveOp { Id = id, X = x, Y = y, Pin = false });
        }

        return moves;
    }

    /// <summary>Every node that is in a frame, which for an arrange means every node one holds.</summary>
    private static HashSet<string> FramedIds(
        MindmapDocument document,
        IReadOnlyDictionary<string, MindmapElement> nodeById)
    {
        var framed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var element in document.Elements)
        {
            if (element.Kind != ElementKind.Frame || element.Content is not FrameContent frame)
                continue;
            foreach (var id in frame.ChildIds)
            {
                if (nodeById.ContainsKey(id))
                    framed.Add(id);
            }
        }

        return framed;
    }

    /// <summary>
    /// The boxes an arrange is leaving where they are, so the clusters it does move can be stacked past
    /// them. Read from the document rather than from the layout, because that is where these stay.
    /// </summary>
    private static List<HeldBox> HeldBoxes(
        IReadOnlyDictionary<string, MindmapElement> nodeById,
        IReadOnlySet<string> framed,
        IReadOnlyDictionary<string, MindmapArrangeSize> sizes)
    {
        var held = new List<HeldBox>();
        foreach (var (id, element) in nodeById)
        {
            if (!element.Pinned && !framed.Contains(id))
                continue;
            var size = sizes.GetValueOrDefault(id);
            var width = size.Width > 0 ? size.Width : element.Width ?? DefaultWidth;
            var height = size.Height > 0 ? size.Height : element.Height ?? DefaultHeight;
            held.Add(new HeldBox(id, element.X, element.Y, element.X + width, element.Y + height));
        }

        // Ascending, so one forward pass over them only ever pushes a cluster further down and never
        // back into something it has already cleared.
        held.Sort((a, b) => a.MinY.CompareTo(b.MinY));
        return held;
    }

    /// <summary>
    /// The cluster under <paramref name="rootId"/>, as the layout wants it: every node exactly once,
    /// each naming the parent it was actually reached through.
    /// </summary>
    /// <remarks>
    /// Parent and sibling order are carried down the walk rather than read from a document-wide map,
    /// because on a malformed graph those disagree. Two hierarchy edges into one node leave a
    /// document-wide map holding whichever came last, which can name a node in a different cluster,
    /// and a layout handed a parent it was not given cannot place the child. Taking both from the walk
    /// makes every cluster self-contained whatever the edges say. On a sound forest the two are the
    /// same value.
    /// </remarks>
    private static List<LayoutNode> Collect(
        string rootId,
        IReadOnlyDictionary<string, MindmapElement> nodeById,
        IReadOnlyDictionary<string, List<string>> childrenOf,
        IReadOnlyDictionary<string, MindmapArrangeSize> sizes,
        IReadOnlySet<string> framed,
        HashSet<string> claimed)
    {
        var nodes = new List<LayoutNode>();
        var stack = new Stack<Reached>();
        stack.Push(new Reached(rootId, null, 0));

        while (stack.Count > 0)
        {
            var (id, parentId, order) = stack.Pop();
            if (!claimed.Add(id))
                continue;

            var element = nodeById[id];
            var size = sizes.GetValueOrDefault(id);

            nodes.Add(new LayoutNode
            {
                Id = id,
                ParentId = parentId,
                Order = order,
                Width = size.Width > 0 ? size.Width : element.Width ?? DefaultWidth,
                Height = size.Height > 0 ? size.Height : element.Height ?? DefaultHeight,
                Collapsed = element.Collapsed,
                Pinned = element.Pinned || framed.Contains(id),
                X = element.X,
                Y = element.Y,
            });

            if (!childrenOf.TryGetValue(id, out var kids)) continue;
            // Pushed in reverse so the pop order is sibling order, which the layout providers rely on.
            for (var i = kids.Count - 1; i >= 0; i--)
                stack.Push(new Reached(kids[i], id, i));
        }

        return nodes;
    }

    /// <summary>
    /// Folds one cluster's positions into the result, dropping it below whatever has been placed already
    /// so two root trees never land on top of each other. Each cluster is laid out about its own origin,
    /// so without this every tree in the document would be arranged into the same space.
    /// <para>
    /// Stacking is for clusters with no home of their own. A pinned root has one, and so does any pinned
    /// node inside a cluster: it was put somewhere on purpose, often into a frame, and shifting it to
    /// tidy up the map is the one thing a pin is there to prevent.
    /// </para>
    /// <para>
    /// The stack also drops past the boxes that are staying put. A frame holds its members through an
    /// arrange, and a tidied tree laid straight across one would be drawn over the group it is not in.
    /// </para>
    /// </summary>
    private static void Merge(
        Dictionary<string, LayoutPosition> placed,
        IReadOnlyDictionary<string, LayoutPosition> cluster,
        IReadOnlyList<LayoutNode> nodes,
        bool rootPinned,
        IReadOnlyList<HeldBox> held,
        ref double stackTop)
    {
        if (rootPinned || cluster.Count == 0)
        {
            foreach (var (id, position) in cluster)
                placed[id] = position;
            return;
        }

        var byId = nodes.ToDictionary(n => n.Id, StringComparer.Ordinal);
        var minX = double.MaxValue;
        var maxX = double.MinValue;
        var minY = double.MaxValue;
        var maxY = double.MinValue;
        foreach (var (id, position) in cluster)
        {
            var width = DefaultWidth;
            var height = DefaultHeight;
            if (byId.TryGetValue(id, out var node))
            {
                if (node.Pinned)
                    continue;
                width = node.Width;
                height = node.Height;
            }

            minX = Math.Min(minX, position.X);
            maxX = Math.Max(maxX, position.X + width);
            minY = Math.Min(minY, position.Y);
            maxY = Math.Max(maxY, position.Y + height);
        }

        // Every node in the cluster is pinned: there is nothing to stack, and nothing to move.
        if (minY == double.MaxValue)
        {
            foreach (var (id, position) in cluster)
                placed[id] = position;
            return;
        }

        var dy = Clear(held, byId, minX, maxX, minY, maxY, stackTop - minY);
        foreach (var (id, position) in cluster)
            placed[id] = byId.TryGetValue(id, out var node) && node.Pinned
                ? position
                : new LayoutPosition(position.X, position.Y + dy);
        stackTop = maxY + dy + ClusterGap;
    }

    /// <summary>
    /// Pushes a cluster's shift further down until its box misses everything that is staying put.
    /// <para>
    /// A cluster's own held nodes are not obstacles to it: they are the reason it is being stretched
    /// rather than moved, and dropping the tree below its own pinned member would only stretch it more.
    /// </para>
    /// </summary>
    private static double Clear(
        IReadOnlyList<HeldBox> held,
        IReadOnlyDictionary<string, LayoutNode> byId,
        double minX,
        double maxX,
        double minY,
        double maxY,
        double dy)
    {
        foreach (var box in held)
        {
            if (byId.ContainsKey(box.Id))
                continue;
            if (minX >= box.MaxX || maxX <= box.MinX)
                continue;
            if (minY + dy >= box.MaxY || maxY + dy <= box.MinY)
                continue;
            dy = box.MaxY + ClusterGap - minY;
        }

        return dy;
    }
}

/// <summary>One node an arrange is not moving, as the rectangle the clusters it does move go around.</summary>
internal readonly record struct HeldBox(string Id, double MinX, double MinY, double MaxX, double MaxY);

/// <summary>A node waiting on the collect stack, with the parent and sibling slot it was reached through.</summary>
internal readonly record struct Reached(string Id, string? ParentId, int Order);

/// <summary>
/// One node's rendered size, as measured by the client that drew it.
/// <para>
/// A struct with a zero default on purpose: a node the request said nothing about reads as 0 by 0 and
/// falls through to the document's stored size, and then to a default.
/// </para>
/// </summary>
internal readonly record struct MindmapArrangeSize(double Width, double Height);
