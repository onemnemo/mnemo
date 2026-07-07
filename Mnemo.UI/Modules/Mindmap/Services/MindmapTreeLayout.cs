using System.Collections.Generic;
using System.Linq;
using Avalonia;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.UI.Modules.Mindmap.Services;

/// <summary>
/// Minimal deterministic tree placement for the P2 editor: root at left, children flowing right, siblings
/// stacked. This is a <em>placeholder</em> for the real layout system (P3, the six algorithms) — it exists
/// only so unpinned nodes render somewhere sensible before any layout engine runs. Pinned nodes (and all
/// free elements) keep their stored coordinates.
/// </summary>
public static class MindmapTreeLayout
{
    private const double RankSpacing = 210;
    private const double NodeSpacing = 58;

    public static IReadOnlyDictionary<string, Point> ComputePositions(MindmapDocument document)
    {
        var nodeIds = document.Elements.Where(e => e.Kind == ElementKind.Node).Select(e => e.Id).ToHashSet();
        var byId = document.Elements.ToDictionary(e => e.Id);
        var hierarchy = document.Edges
            .Where(e => e.Kind == EdgeKind.Hierarchy && nodeIds.Contains(e.FromId) && nodeIds.Contains(e.ToId))
            .ToList();
        var childrenOf = hierarchy.GroupBy(e => e.FromId).ToDictionary(g => g.Key, g => g.Select(e => e.ToId).ToList());
        var hasParent = hierarchy.Select(e => e.ToId).ToHashSet();
        var roots = nodeIds.Where(id => !hasParent.Contains(id)).ToList();

        var positions = new Dictionary<string, Point>();
        double leaf = 0;

        void Place(string id, int depth)
        {
            var kids = childrenOf.GetValueOrDefault(id);
            if (kids is null || kids.Count == 0)
            {
                positions[id] = new Point(depth * RankSpacing, leaf * NodeSpacing);
                leaf += 1;
                return;
            }

            foreach (var kid in kids)
                Place(kid, depth + 1);
            var ys = kids.Select(k => positions[k].Y).ToList();
            positions[id] = new Point(depth * RankSpacing, (ys.Min() + ys.Max()) / 2);
        }

        foreach (var root in roots)
        {
            Place(root, 0);
            leaf += 1; // gap between separate trees
        }

        // Pinned nodes override the computed placement with their stored coordinates.
        foreach (var id in nodeIds)
        {
            if (byId.TryGetValue(id, out var el) && el.Pinned)
                positions[id] = new Point(el.X, el.Y);
        }

        return positions;
    }
}
