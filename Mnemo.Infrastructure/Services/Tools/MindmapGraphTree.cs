using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Tools.Mindmap;

namespace Mnemo.Infrastructure.Services.Tools;

/// <summary>Graph traversal, short-id resolution, and tree projection for mindmap agent tools.</summary>
internal static class MindmapGraphTree
{
    internal readonly record struct Located(MindmapNode Node, int Index);

    public static string ShortId(string id) =>
        string.IsNullOrEmpty(id) ? string.Empty : (id.Length > 8 ? id[..8] : id);

    public static bool TryLocate(Mindmap map, string idOrPrefix, out MindmapNode node, out bool ambiguous, out IReadOnlyList<string> candidates)
    {
        node = null!;
        ambiguous = false;
        candidates = Array.Empty<string>();

        var key = idOrPrefix?.Trim() ?? string.Empty;
        if (key.Length == 0)
            return false;

        var exact = map.Nodes.Where(n => string.Equals(n.Id, key, StringComparison.OrdinalIgnoreCase)).ToList();
        if (exact.Count == 1)
        {
            node = exact[0];
            return true;
        }

        var prefix = map.Nodes
            .Where(n => n.Id.StartsWith(key, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (prefix.Count == 1)
        {
            node = prefix[0];
            return true;
        }

        if (prefix.Count > 1)
        {
            ambiguous = true;
            candidates = prefix.Select(n => ShortId(n.Id)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        return false;
    }

    public static string? HierarchyParent(Mindmap map, string nodeId)
    {
        var edge = map.Edges.FirstOrDefault(e =>
            e.Kind == MindmapEdgeKind.Hierarchy && string.Equals(e.ToId, nodeId, StringComparison.Ordinal));
        return edge?.FromId;
    }

    public static IEnumerable<string> HierarchyChildren(Mindmap map, string nodeId)
    {
        foreach (var e in map.Edges)
        {
            if (e.Kind == MindmapEdgeKind.Hierarchy && string.Equals(e.FromId, nodeId, StringComparison.Ordinal))
                yield return e.ToId;
        }
    }

    public static HashSet<string> CollectDescendants(Mindmap map, string anchorId, bool includeAnchor)
    {
        var valid = map.Nodes.Select(n => n.Id).ToHashSet(StringComparer.Ordinal);
        var result = new HashSet<string>(StringComparer.Ordinal);
        if (includeAnchor && valid.Contains(anchorId))
            result.Add(anchorId);

        var queue = new Queue<string>();
        foreach (var child in HierarchyChildren(map, anchorId))
        {
            if (valid.Contains(child) && result.Add(child))
                queue.Enqueue(child);
        }

        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            foreach (var child in HierarchyChildren(map, id))
            {
                if (valid.Contains(child) && result.Add(child))
                    queue.Enqueue(child);
            }
        }

        return result;
    }

    public static Dictionary<string, object?> BuildTree(Mindmap map, string rootId, int maxDepth, int depth = 0)
    {
        if (!TryLocate(map, rootId, out var node, out _, out _))
            return new Dictionary<string, object?>();

        return NodeToTree(map, node, maxDepth, depth);
    }

    private static Dictionary<string, object?> NodeToTree(Mindmap map, MindmapNode node, int maxDepth, int depth)
    {
        node.Style.TryGetValue("color", out var color);
        node.Style.TryGetValue("shape", out var shape);
        var collapsed = node.Style.TryGetValue("collapsed", out var coll) && coll == "true";
        var label = node.Content is TextNodeContent t ? t.Text : node.Content?.ToString() ?? string.Empty;

        var dto = new Dictionary<string, object?>
        {
            ["id"] = ShortId(node.Id),
            ["label"] = label,
            ["color"] = color,
            ["shape"] = shape,
            ["collapsed"] = collapsed
        };

        if (depth < maxDepth)
        {
            var children = HierarchyChildren(map, node.Id)
                .Select(id => TryLocate(map, id, out var child, out _, out _) ? child : null)
                .Where(c => c != null)
                .Select(c => NodeToTree(map, c!, maxDepth, depth + 1))
                .ToList();

            if (children.Count > 0)
                dto["children"] = children;
        }
        else if (HierarchyChildren(map, node.Id).Any())
        {
            dto["has_more"] = true;
        }

        return dto;
    }

    public static Dictionary<string, object?> NodeToRead(Mindmap map, MindmapNode node, bool includeLinks)
    {
        node.Style.TryGetValue("color", out var color);
        node.Style.TryGetValue("shape", out var shape);
        var collapsed = node.Style.TryGetValue("collapsed", out var coll) && coll == "true";
        var label = node.Content is TextNodeContent t ? t.Text : node.Content?.ToString() ?? string.Empty;

        map.Layout.Nodes.TryGetValue(node.Id, out var layout);

        var dto = new Dictionary<string, object?>
        {
            ["id"] = ShortId(node.Id),
            ["label"] = label,
            ["parent_id"] = HierarchyParent(map, node.Id) is { } p ? ShortId(p) : null,
            ["color"] = color,
            ["shape"] = shape,
            ["collapsed"] = collapsed,
            ["layout"] = layout == null ? null : new { x = layout.X, y = layout.Y, width = layout.Width, height = layout.Height }
        };

        if (includeLinks)
        {
            var links = map.Edges
                .Where(e => e.Kind == MindmapEdgeKind.Link &&
                            (string.Equals(e.FromId, node.Id, StringComparison.Ordinal) ||
                             string.Equals(e.ToId, node.Id, StringComparison.Ordinal)))
                .Select(e => new Dictionary<string, object?>
                {
                    ["edge_id"] = ShortId(e.Id),
                    ["source"] = ShortId(e.FromId),
                    ["target"] = ShortId(e.ToId),
                    ["label"] = e.Label,
                    ["type"] = e.Type
                })
                .ToList();

            if (links.Count > 0)
                dto["links"] = links;
        }

        return dto;
    }

    public static string Version(Mindmap map) =>
        $"{map.Nodes.Count}:{map.Edges.Count}:{map.Title}:{map.Layout.Algorithm}".GetHashCode(System.StringComparison.Ordinal).ToString(System.Globalization.CultureInfo.InvariantCulture);

    public static void RemoveNodeCascade(Mindmap map, string nodeId)
    {
        var toRemove = CollectDescendants(map, nodeId, includeAnchor: true);
        map.Nodes.RemoveAll(n => toRemove.Contains(n.Id));
        map.Edges.RemoveAll(e => toRemove.Contains(e.FromId) || toRemove.Contains(e.ToId));
        foreach (var id in toRemove)
            map.Layout.Nodes.Remove(id);

        if (map.RootNodeId != null && toRemove.Contains(map.RootNodeId))
            map.RootNodeId = map.Nodes.FirstOrDefault()?.Id;
    }

    public static MindmapNode CreateTextNode(string label, MindmapOutlineNode? style = null)
    {
        var node = new MindmapNode
        {
            Id = Guid.NewGuid().ToString(),
            NodeType = "text",
            Content = new TextNodeContent { Text = label.Trim() }
        };

        ApplyStyle(node, style?.Color, style?.Shape, null);
        return node;
    }

    public static void ApplyStyle(MindmapNode node, string? color, string? shape, bool? collapsed)
    {
        if (color != null)
        {
            var c = color.Trim();
            if (c.Length == 0 || string.Equals(c, "default", StringComparison.OrdinalIgnoreCase))
                node.Style.Remove("color");
            else
                node.Style["color"] = c;
        }

        if (shape != null)
        {
            var s = shape.Trim().ToLowerInvariant();
            if (s is "rectangle" or "pill" or "circle")
                node.Style["shape"] = s;
        }

        if (collapsed.HasValue)
        {
            if (collapsed.Value)
                node.Style["collapsed"] = "true";
            else
                node.Style.Remove("collapsed");
        }
    }

    public static void AddHierarchyEdge(Mindmap map, string fromId, string toId)
    {
        if (map.Edges.Any(e => e.Kind == MindmapEdgeKind.Hierarchy &&
                               string.Equals(e.FromId, fromId, StringComparison.Ordinal) &&
                               string.Equals(e.ToId, toId, StringComparison.Ordinal)))
            return;

        map.Edges.Add(new MindmapEdge
        {
            Id = Guid.NewGuid().ToString(),
            FromId = fromId,
            ToId = toId,
            Kind = MindmapEdgeKind.Hierarchy
        });
    }

    public static void AddSubtree(Mindmap map, string parentId, MindmapOutlineNode spec)
    {
        var node = CreateTextNode(spec.Label, spec);
        map.Nodes.Add(node);
        map.Layout.Nodes[node.Id] = new NodeLayout { X = 0, Y = 0 };
        AddHierarchyEdge(map, parentId, node.Id);

        if (spec.Children is { Count: > 0 })
        {
            foreach (var child in spec.Children)
                AddSubtree(map, node.Id, child);
        }
    }
}
