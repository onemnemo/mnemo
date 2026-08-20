using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Mindmap.Layout;

/// <summary>
/// Shared geometry for the built-in layout providers: building the visible tree from a snapshot,
/// a size-aware layered "tidy tree" packer, leaf counting for radial spread, and the common finalize step
/// (anchor the tree to the root's stored position; keep pinned nodes fixed). Pure, no document or UI access.
/// </summary>
internal static class MindmapLayoutMath
{
    /// <summary>Ordered, collapse-aware tree built from a snapshot.</summary>
    internal sealed class Tree
    {
        public required LayoutNode Root { get; init; }
        public required bool HasRoot { get; init; }
        public required Dictionary<string, List<LayoutNode>> Children { get; init; }
        public required Dictionary<string, LayoutNode> ById { get; init; }

        /// <summary>Children of a node in sibling order, or none if the node is collapsed.</summary>
        public IReadOnlyList<LayoutNode> VisibleChildren(LayoutNode node) =>
            node.Collapsed || !Children.TryGetValue(node.Id, out var kids)
                ? Array.Empty<LayoutNode>()
                : kids;
    }

    public static Tree Build(LayoutSnapshot snapshot)
    {
        var byId = new Dictionary<string, LayoutNode>();
        foreach (var node in snapshot.Nodes)
            byId[node.Id] = node;

        var children = new Dictionary<string, List<LayoutNode>>();
        foreach (var node in snapshot.Nodes)
        {
            if (node.ParentId is null || !byId.ContainsKey(node.ParentId))
                continue;
            if (!children.TryGetValue(node.ParentId, out var list))
            {
                list = new List<LayoutNode>();
                children[node.ParentId] = list;
            }
            list.Add(node);
        }
        foreach (var list in children.Values)
            list.Sort((a, b) => a.Order.CompareTo(b.Order));

        var hasRoot = byId.TryGetValue(snapshot.RootId, out var root);
        return new Tree { Root = root, HasRoot = hasRoot, Children = children, ById = byId };
    }

    /// <summary>
    /// Layered tidy-tree packing. <paramref name="horizontal"/> flows depth along X (root left) and packs
    /// siblings along Y; otherwise depth flows down Y and siblings pack along X. Returns top-left positions
    /// with the subtree starting near the origin; the caller anchors and applies pins via <see cref="Finalize"/>.
    /// </summary>
    public static Dictionary<string, LayoutPosition> Layered(
        Tree tree, LayoutNode root, bool horizontal, double nodeSpacing, double rankSpacing)
    {
        double MainExtent(LayoutNode n) => horizontal ? n.Width : n.Height;
        double CrossExtent(LayoutNode n) => horizontal ? n.Height : n.Width;

        var depth = new Dictionary<string, int>();
        var maxMainAtDepth = new Dictionary<int, double>();

        void Depths(LayoutNode node, int d)
        {
            depth[node.Id] = d;
            maxMainAtDepth[d] = Math.Max(maxMainAtDepth.GetValueOrDefault(d), MainExtent(node));
            foreach (var child in tree.VisibleChildren(node))
                Depths(child, d + 1);
        }
        Depths(root, 0);

        // Center of each depth band along the main axis (ranks are size-aware and centered).
        var mainCenter = new Dictionary<int, double>();
        var acc = 0.0;
        for (var d = 0; maxMainAtDepth.ContainsKey(d); d++)
        {
            mainCenter[d] = acc + maxMainAtDepth[d] / 2;
            acc += maxMainAtDepth[d] + rankSpacing;
        }

        // Cross packing: leaves take sequential slots; a parent centers on its children.
        var cross = new Dictionary<string, double>();
        var cursor = 0.0;

        void Pack(LayoutNode node)
        {
            var kids = tree.VisibleChildren(node);
            if (kids.Count == 0)
            {
                cross[node.Id] = cursor + CrossExtent(node) / 2;
                cursor += CrossExtent(node) + nodeSpacing;
                return;
            }
            foreach (var kid in kids)
                Pack(kid);
            cross[node.Id] = (cross[kids[0].Id] + cross[kids[^1].Id]) / 2;
        }
        Pack(root);

        var positions = new Dictionary<string, LayoutPosition>();

        void Emit(LayoutNode node)
        {
            var mc = mainCenter[depth[node.Id]];
            var cc = cross[node.Id];
            var position = horizontal
                ? new LayoutPosition(mc - node.Width / 2, cc - node.Height / 2)
                : new LayoutPosition(cc - node.Width / 2, mc - node.Height / 2);
            positions[node.Id] = position;
            foreach (var child in tree.VisibleChildren(node))
                Emit(child);
        }
        Emit(root);
        return positions;
    }

    /// <summary>Count of visible leaves under a node (a leaf counts as 1). This is the radial angular weight.</summary>
    public static int VisibleLeafCount(Tree tree, LayoutNode node)
    {
        var kids = tree.VisibleChildren(node);
        if (kids.Count == 0)
            return 1;
        var total = 0;
        foreach (var kid in kids)
            total += VisibleLeafCount(tree, kid);
        return total;
    }

    /// <summary>Translate every position by a fixed delta.</summary>
    public static void Translate(Dictionary<string, LayoutPosition> positions, double dx, double dy)
    {
        if (dx == 0 && dy == 0)
            return;
        foreach (var key in positions.Keys.ToList())
            positions[key] = new LayoutPosition(positions[key].X + dx, positions[key].Y + dy);
    }

    /// <summary>
    /// Anchor the computed layout so the root's top-left lands at its stored position (so a pinned/dragged
    /// root carries its tree), then override pinned non-root nodes with their stored positions.
    /// </summary>
    public static IReadOnlyDictionary<string, LayoutPosition> Finalize(
        LayoutSnapshot snapshot, Tree tree, Dictionary<string, LayoutPosition> computed)
    {
        if (computed.TryGetValue(tree.Root.Id, out var rootPos))
            Translate(computed, tree.Root.X - rootPos.X, tree.Root.Y - rootPos.Y);

        foreach (var key in computed.Keys.ToList())
        {
            if (key != tree.Root.Id && tree.ById.TryGetValue(key, out var node) && node.Pinned)
                computed[key] = new LayoutPosition(node.X, node.Y);
        }

        return computed;
    }

    /// <summary>Resolve spacing overrides against an algorithm's built-in defaults.</summary>
    public static (double Node, double Rank) Resolve(LayoutOptions? options, double node, double rank) =>
        (options?.NodeSpacing ?? node, options?.RankSpacing ?? rank);
}
