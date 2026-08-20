using System.Collections.Generic;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// Pure graph helpers over the hierarchy edges of a document: the single home for the forest/cycle rules
/// and subtree traversal (v1 duplicated cycle-checking across the service and tools; v2 centralizes it).
/// All methods are read-only and side-effect free.
/// </summary>
internal static class MindmapGraph
{
    /// <summary>
    /// True if adding a hierarchy edge <paramref name="fromId"/> → <paramref name="toId"/> would create a
    /// cycle, i.e. <paramref name="fromId"/> is already reachable from <paramref name="toId"/> through
    /// existing hierarchy edges. Mirrors v1's BFS, kept as the invariant guard for reparenting.
    /// </summary>
    public static bool WouldCreateCycle(IEnumerable<MindmapEdge> edges, string fromId, string toId)
    {
        if (fromId == toId)
            return true;

        var adjacency = BuildHierarchyAdjacency(edges);
        var queue = new Queue<string>();
        var visited = new HashSet<string> { toId };
        queue.Enqueue(toId);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (current == fromId)
                return true;

            if (!adjacency.TryGetValue(current, out var children))
                continue;

            foreach (var child in children)
            {
                if (visited.Add(child))
                    queue.Enqueue(child);
            }
        }

        return false;
    }

    /// <summary>The hierarchy edge whose target is <paramref name="nodeId"/>, or null if the node is a root.</summary>
    public static MindmapEdge? HierarchyParentEdge(IEnumerable<MindmapEdge> edges, string nodeId)
    {
        foreach (var edge in edges)
        {
            if (edge.Kind == EdgeKind.Hierarchy && edge.ToId == nodeId)
                return edge;
        }

        return null;
    }

    /// <summary>
    /// All hierarchy descendants of <paramref name="rootId"/>, including the root itself. Used for cascade
    /// deletes and subtree styling.
    /// </summary>
    public static HashSet<string> CollectSubtree(IEnumerable<MindmapEdge> edges, string rootId) =>
        CollectSubtrees(edges, new[] { rootId });

    /// <summary>
    /// The union of the subtrees of every id in <paramref name="rootIds"/>, roots included. The adjacency
    /// is built once for the whole set, so deleting a hundred nodes reads the edge list once rather than
    /// a hundred times.
    /// </summary>
    public static HashSet<string> CollectSubtrees(IEnumerable<MindmapEdge> edges, IEnumerable<string> rootIds)
    {
        var adjacency = BuildHierarchyAdjacency(edges);
        var result = new HashSet<string>();
        var stack = new Stack<string>();

        foreach (var rootId in rootIds)
        {
            stack.Push(rootId);
            while (stack.Count > 0)
            {
                var current = stack.Pop();
                if (!result.Add(current))
                    continue;

                if (!adjacency.TryGetValue(current, out var children))
                    continue;

                foreach (var child in children)
                    stack.Push(child);
            }
        }

        return result;
    }

    private static Dictionary<string, List<string>> BuildHierarchyAdjacency(IEnumerable<MindmapEdge> edges)
    {
        var adjacency = new Dictionary<string, List<string>>();
        foreach (var edge in edges)
        {
            if (edge.Kind != EdgeKind.Hierarchy)
                continue;

            if (!adjacency.TryGetValue(edge.FromId, out var children))
            {
                children = new List<string>();
                adjacency[edge.FromId] = children;
            }

            children.Add(edge.ToId);
        }

        return adjacency;
    }
}
