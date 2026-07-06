using System.Collections.Generic;
using System.Linq;
using Avalonia.Media;
using Mnemo.UI.Modules.Mindmap.ViewModels;
using MindmapModel = Mnemo.Core.Models.Mindmap.Mindmap;

namespace Mnemo.UI.Modules.Mindmap.Services;

/// <summary>
/// Builds scaled node/edge previews for mindmap library cards.
/// </summary>
public static class MindmapPreviewBuilder
{
    private const double Padding = 20;
    private const double TargetWidth = 240;
    private const double TargetHeight = 120;
    private const double NodeSize = 9;
    private const double RootSize = 14;
    private const int MaxDots = 4;

    public static void PopulatePreviews(MindmapItemViewModel item, MindmapModel mindmap)
    {
        item.NodePreviews.Clear();
        item.EdgePreviews.Clear();
        item.AccentDots.Clear();

        if (mindmap.Layout?.Nodes == null || mindmap.Layout.Nodes.Count == 0)
            return;

        var nodesById = mindmap.Nodes.ToDictionary(n => n.Id, n => n);
        var layoutNodes = mindmap.Layout.Nodes.Values.ToList();
        double minX = layoutNodes.Min(n => n.X);
        double maxX = layoutNodes.Max(n => n.X);
        double minY = layoutNodes.Min(n => n.Y);
        double maxY = layoutNodes.Max(n => n.Y);

        double width = maxX - minX;
        double height = maxY - minY;

        double scaleX = width > 0 ? (TargetWidth - Padding * 2) / width : 1;
        double scaleY = height > 0 ? (TargetHeight - Padding * 2) / height : 1;
        double scale = System.Math.Min(scaleX, scaleY);

        var dotColors = new List<IBrush>();
        var index = 0;
        foreach (var (nodeId, layout) in mindmap.Layout.Nodes)
        {
            var isRoot = string.Equals(nodeId, mindmap.RootNodeId, System.StringComparison.Ordinal);
            nodesById.TryGetValue(nodeId, out var node);
            var color = isRoot
                ? MindmapPreviewPalette.Root
                : MindmapPreviewPalette.Resolve(node?.Style.GetValueOrDefault("color"), index);

            item.NodePreviews.Add(new NodePreviewViewModel
            {
                X = (layout.X - minX) * scale + Padding,
                Y = (layout.Y - minY) * scale + Padding,
                Size = isRoot ? RootSize : NodeSize,
                Fill = color
            });

            if (!isRoot && dotColors.Count < MaxDots)
                dotColors.Add(color);
            index++;
        }

        // Ensure the accent dots always lead with the root/primary tone.
        item.AccentDots.Add(MindmapPreviewPalette.Root);
        foreach (var c in dotColors.Take(MaxDots - 1))
            item.AccentDots.Add(c);

        foreach (var edge in mindmap.Edges)
        {
            if (mindmap.Layout.Nodes.TryGetValue(edge.FromId, out var source) &&
                mindmap.Layout.Nodes.TryGetValue(edge.ToId, out var target))
            {
                item.EdgePreviews.Add(new EdgePreviewViewModel
                {
                    X1 = (source.X - minX) * scale + Padding,
                    Y1 = (source.Y - minY) * scale + Padding,
                    X2 = (target.X - minX) * scale + Padding,
                    Y2 = (target.Y - minY) * scale + Padding
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
}
