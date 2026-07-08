using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Mindmap.Layout;

/// <summary>Root left, children flow right. The plain layered tidy tree.</summary>
public sealed class TreeRightLayoutProvider : IMindmapLayoutProvider
{
    public string Id => MindmapLayoutAlgorithms.TreeRight;

    public IReadOnlyDictionary<string, LayoutPosition> Compute(LayoutSnapshot snapshot)
    {
        var tree = MindmapLayoutMath.Build(snapshot);
        if (!tree.HasRoot)
            return new Dictionary<string, LayoutPosition>();

        var (node, rank) = MindmapLayoutMath.Resolve(snapshot.Options, 28, 90);
        var positions = MindmapLayoutMath.Layered(tree, tree.Root, horizontal: true, node, rank);
        return MindmapLayoutMath.Finalize(snapshot, tree, positions);
    }
}

/// <summary>Root top, children flow down. The layered tidy tree, transposed.</summary>
public sealed class TreeDownLayoutProvider : IMindmapLayoutProvider
{
    public string Id => MindmapLayoutAlgorithms.TreeDown;

    public IReadOnlyDictionary<string, LayoutPosition> Compute(LayoutSnapshot snapshot)
    {
        var tree = MindmapLayoutMath.Build(snapshot);
        if (!tree.HasRoot)
            return new Dictionary<string, LayoutPosition>();

        var (node, rank) = MindmapLayoutMath.Resolve(snapshot.Options, 40, 70);
        var positions = MindmapLayoutMath.Layered(tree, tree.Root, horizontal: false, node, rank);
        return MindmapLayoutMath.Finalize(snapshot, tree, positions);
    }
}

/// <summary>
/// Classic mindmap (default): the root's children split left/right (alternating for balance) and each
/// side is laid out as a right-flowing tidy tree, the left side mirrored across the root. Both sides center
/// vertically on the root.
/// </summary>
public sealed class BalancedLayoutProvider : IMindmapLayoutProvider
{
    public string Id => MindmapLayoutAlgorithms.Balanced;

    public IReadOnlyDictionary<string, LayoutPosition> Compute(LayoutSnapshot snapshot)
    {
        var tree = MindmapLayoutMath.Build(snapshot);
        if (!tree.HasRoot)
            return new Dictionary<string, LayoutPosition>();

        var (node, rank) = MindmapLayoutMath.Resolve(snapshot.Options, 28, 90);
        var rootKids = tree.VisibleChildren(tree.Root);
        if (rootKids.Count == 0)
            return MindmapLayoutMath.Finalize(snapshot, tree, new Dictionary<string, LayoutPosition>
            {
                [tree.Root.Id] = new LayoutPosition(tree.Root.X, tree.Root.Y),
            });

        var right = new List<LayoutNode>();
        var left = new List<LayoutNode>();
        for (var i = 0; i < rootKids.Count; i++)
            (i % 2 == 0 ? right : left).Add(rootKids[i]);

        var rightPositions = SideLayout(tree, right, node, rank);
        var leftPositions = SideLayout(tree, left, node, rank);

        // Align the two roots, then reflect the left side across the root's vertical center line.
        var rRoot = rightPositions[tree.Root.Id];
        var lRoot = leftPositions[tree.Root.Id];
        MindmapLayoutMath.Translate(leftPositions, rRoot.X - lRoot.X, rRoot.Y - lRoot.Y);

        var axis = rRoot.X + tree.Root.Width / 2;
        var merged = new Dictionary<string, LayoutPosition>(rightPositions);
        foreach (var (id, position) in leftPositions)
        {
            if (id == tree.Root.Id)
                continue;
            var width = tree.ById[id].Width;
            merged[id] = new LayoutPosition(2 * axis - position.X - width, position.Y);
        }

        return MindmapLayoutMath.Finalize(snapshot, tree, merged);
    }

    /// <summary>Layered layout exposing only <paramref name="sideKids"/> under the root (deeper tree intact).</summary>
    private static Dictionary<string, LayoutPosition> SideLayout(
        MindmapLayoutMath.Tree tree, List<LayoutNode> sideKids, double node, double rank)
    {
        var children = new Dictionary<string, List<LayoutNode>>(tree.Children)
        {
            [tree.Root.Id] = sideKids,
        };
        var sideTree = new MindmapLayoutMath.Tree
        {
            Root = tree.Root,
            HasRoot = true,
            Children = children,
            ById = tree.ById,
        };
        return MindmapLayoutMath.Layered(sideTree, tree.Root, horizontal: true, node, rank);
    }
}

/// <summary>Concentric rings around the root; each subtree gets an angular slice by leaf count.</summary>
public sealed class RadialLayoutProvider : IMindmapLayoutProvider
{
    public string Id => MindmapLayoutAlgorithms.Radial;

    public IReadOnlyDictionary<string, LayoutPosition> Compute(LayoutSnapshot snapshot)
    {
        var tree = MindmapLayoutMath.Build(snapshot);
        if (!tree.HasRoot)
            return new Dictionary<string, LayoutPosition>();

        var (_, rank) = MindmapLayoutMath.Resolve(snapshot.Options, 28, 90);
        var ring = rank + 70;
        var positions = new Dictionary<string, LayoutPosition>();

        void Assign(LayoutNode node, int depth, double startAngle, double endAngle)
        {
            var angle = (startAngle + endAngle) / 2;
            var radius = depth * ring;
            var cx = radius * Math.Cos(angle);
            var cy = radius * Math.Sin(angle);
            positions[node.Id] = new LayoutPosition(cx - node.Width / 2, cy - node.Height / 2);

            var kids = tree.VisibleChildren(node);
            if (kids.Count == 0)
                return;

            var totalLeaves = kids.Sum(k => MindmapLayoutMath.VisibleLeafCount(tree, k));
            var a = startAngle;
            foreach (var kid in kids)
            {
                var slice = (endAngle - startAngle) * MindmapLayoutMath.VisibleLeafCount(tree, kid) / totalLeaves;
                Assign(kid, depth + 1, a, a + slice);
                a += slice;
            }
        }

        Assign(tree.Root, 0, 0, 2 * Math.PI);
        return MindmapLayoutMath.Finalize(snapshot, tree, positions);
    }
}

/// <summary>Root left, depth-1 children as a horizontal sequence, each subtree hanging below.</summary>
public sealed class TimelineLayoutProvider : IMindmapLayoutProvider
{
    public string Id => MindmapLayoutAlgorithms.Timeline;

    public IReadOnlyDictionary<string, LayoutPosition> Compute(LayoutSnapshot snapshot)
    {
        var tree = MindmapLayoutMath.Build(snapshot);
        if (!tree.HasRoot)
            return new Dictionary<string, LayoutPosition>();

        var (node, rank) = MindmapLayoutMath.Resolve(snapshot.Options, 40, 70);
        var positions = new Dictionary<string, LayoutPosition>
        {
            [tree.Root.Id] = new LayoutPosition(0, 0),
        };

        var cursorX = tree.Root.Width + rank;
        foreach (var kid in tree.VisibleChildren(tree.Root))
        {
            var subtree = MindmapLayoutMath.Layered(tree, kid, horizontal: false, node, rank);

            double minX = double.MaxValue, maxRight = double.MinValue;
            foreach (var (id, position) in subtree)
            {
                var width = tree.ById[id].Width;
                minX = Math.Min(minX, position.X);
                maxRight = Math.Max(maxRight, position.X + width);
            }

            // Left-align the subtree at the running cursor; the depth-1 child keeps the root's row (Y ≈ 0).
            var kidPosition = subtree[kid.Id];
            var dx = cursorX - minX;
            var dy = -kidPosition.Y;
            foreach (var (id, position) in subtree)
                positions[id] = new LayoutPosition(position.X + dx, position.Y + dy);

            cursorX += (maxRight - minX) + node;
        }

        return MindmapLayoutMath.Finalize(snapshot, tree, positions);
    }
}

/// <summary>No auto-layout: every visible node keeps its current position.</summary>
public sealed class FreeLayoutProvider : IMindmapLayoutProvider
{
    public string Id => MindmapLayoutAlgorithms.Free;

    public IReadOnlyDictionary<string, LayoutPosition> Compute(LayoutSnapshot snapshot)
    {
        var positions = new Dictionary<string, LayoutPosition>();
        var tree = MindmapLayoutMath.Build(snapshot);
        if (!tree.HasRoot)
        {
            foreach (var node in snapshot.Nodes)
                positions[node.Id] = new LayoutPosition(node.X, node.Y);
            return positions;
        }

        void Emit(LayoutNode node)
        {
            positions[node.Id] = new LayoutPosition(node.X, node.Y);
            foreach (var child in tree.VisibleChildren(node))
                Emit(child);
        }
        Emit(tree.Root);
        return positions;
    }
}
