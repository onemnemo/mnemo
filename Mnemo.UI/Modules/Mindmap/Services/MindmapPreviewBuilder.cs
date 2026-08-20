using System.Collections.Generic;
using System.Linq;
using Avalonia.Media;
using Mnemo.Core.Models.Mindmap;
using Mnemo.UI.Modules.Mindmap.ViewModels;

namespace Mnemo.UI.Modules.Mindmap.Services;

/// <summary>
/// Builds scaled node/edge thumbnails for mindmap library cards from a schema v2 document. Because P2
/// has no layout engine yet, positions are derived here from the hierarchy with a simple tidy-tree
/// placement (root → right, children stacked), independent of stored coordinates, so previews look
/// right even before any layout has run.
/// </summary>
public static class MindmapPreviewBuilder
{
    private const double Padding = 20;
    private const double TargetWidth = 240;
    private const double TargetHeight = 120;
    private const double NodeSize = 9;
    private const double RootSize = 14;
    private const int MaxDots = 4;

    public static void PopulatePreviews(MindmapItemViewModel item, MindmapDocument document)
    {
        item.NodePreviews.Clear();
        item.EdgePreviews.Clear();
        item.AccentDots.Clear();

        var nodeIds = document.Elements
            .Where(e => e.Kind == ElementKind.Node)
            .Select(e => e.Id)
            .ToHashSet();
        if (nodeIds.Count == 0)
            return;

        var hierarchy = document.Edges.Where(e => e.Kind == EdgeKind.Hierarchy && nodeIds.Contains(e.FromId) && nodeIds.Contains(e.ToId)).ToList();
        var childrenOf = hierarchy.GroupBy(e => e.FromId).ToDictionary(g => g.Key, g => g.Select(e => e.ToId).ToList());
        var hasParent = hierarchy.Select(e => e.ToId).ToHashSet();
        var roots = nodeIds.Where(id => !hasParent.Contains(id)).ToList();

        var positions = ComputeLayout(roots, childrenOf);
        var colorIndex = ComputeBranchColors(roots, childrenOf);

        double minX = positions.Values.Min(p => p.X);
        double maxX = positions.Values.Max(p => p.X);
        double minY = positions.Values.Min(p => p.Y);
        double maxY = positions.Values.Max(p => p.Y);
        double scaleX = maxX > minX ? (TargetWidth - Padding * 2) / (maxX - minX) : 1;
        double scaleY = maxY > minY ? (TargetHeight - Padding * 2) / (maxY - minY) : 1;
        double scale = System.Math.Min(scaleX, scaleY);

        double Screen(double v, double min) => (v - min) * scale + Padding;

        var dotColors = new List<IBrush>();
        foreach (var (id, p) in positions)
        {
            var isRoot = roots.Contains(id);
            var color = isRoot ? MindmapPreviewPalette.Root : MindmapPreviewPalette.Branch(colorIndex.GetValueOrDefault(id, 0));
            item.NodePreviews.Add(new NodePreviewViewModel
            {
                X = Screen(p.X, minX),
                Y = Screen(p.Y, minY),
                Size = isRoot ? RootSize : NodeSize,
                Fill = color
            });
            if (!isRoot && dotColors.Count < MaxDots)
                dotColors.Add(color);
        }

        item.AccentDots.Add(MindmapPreviewPalette.Root);
        foreach (var c in dotColors.Take(MaxDots - 1))
            item.AccentDots.Add(c);

        foreach (var edge in hierarchy)
        {
            if (positions.TryGetValue(edge.FromId, out var s) && positions.TryGetValue(edge.ToId, out var t))
            {
                item.EdgePreviews.Add(new EdgePreviewViewModel
                {
                    X1 = Screen(s.X, minX),
                    Y1 = Screen(s.Y, minY),
                    X2 = Screen(t.X, minX),
                    Y2 = Screen(t.Y, minY)
                });
            }
        }
    }

    /// <summary>Copies a map's built thumbnail geometry onto a folder tile.</summary>
    public static void CopyPreviewTo(MindmapItemViewModel source, MindmapFolderItemViewModel target)
    {
        target.NodePreviews.Clear();
        target.EdgePreviews.Clear();
        foreach (var n in source.NodePreviews)
            target.NodePreviews.Add(n);
        foreach (var e in source.EdgePreviews)
            target.EdgePreviews.Add(e);
    }

    private static Dictionary<string, (double X, double Y)> ComputeLayout(
        List<string> roots, Dictionary<string, List<string>> childrenOf)
    {
        var positions = new Dictionary<string, (double X, double Y)>();
        double leaf = 0;

        void Place(string id, int depth)
        {
            var kids = childrenOf.GetValueOrDefault(id);
            if (kids is null || kids.Count == 0)
            {
                positions[id] = (depth, leaf);
                leaf += 1;
                return;
            }

            foreach (var kid in kids)
                Place(kid, depth + 1);
            var ys = kids.Select(k => positions[k].Y).ToList();
            positions[id] = (depth, (ys.Min() + ys.Max()) / 2);
        }

        foreach (var root in roots)
        {
            Place(root, 0);
            leaf += 1; // gap between separate trees
        }

        return positions;
    }

    private static Dictionary<string, int> ComputeBranchColors(
        List<string> roots, Dictionary<string, List<string>> childrenOf)
    {
        var colors = new Dictionary<string, int>();
        var branch = 0;
        foreach (var root in roots)
        {
            foreach (var child in childrenOf.GetValueOrDefault(root) ?? new List<string>())
            {
                var current = branch++;
                var stack = new Stack<string>();
                stack.Push(child);
                while (stack.Count > 0)
                {
                    var node = stack.Pop();
                    colors[node] = current;
                    foreach (var grandchild in childrenOf.GetValueOrDefault(node) ?? new List<string>())
                        stack.Push(grandchild);
                }
            }
        }

        return colors;
    }
}
