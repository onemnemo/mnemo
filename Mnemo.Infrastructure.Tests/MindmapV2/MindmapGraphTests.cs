using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.MindmapV2;
using Mnemo.Infrastructure.Services.MindmapV2;
using Xunit;

namespace Mnemo.Infrastructure.Tests.MindmapV2;

public sealed class MindmapGraphTests
{
    // a -> b -> c  (hierarchy), plus a free link c -> a
    private static List<MindmapEdge> Chain() => new()
    {
        new() { Id = "e1", FromId = "a", ToId = "b", Kind = EdgeKind.Hierarchy },
        new() { Id = "e2", FromId = "b", ToId = "c", Kind = EdgeKind.Hierarchy },
        new() { Id = "e3", FromId = "c", ToId = "a", Kind = EdgeKind.Link },
    };

    [Fact]
    public void WouldCreateCycle_DetectsIndirectCycle()
    {
        // Reparenting 'a' under 'c' closes the a->b->c chain into a loop.
        Assert.True(MindmapGraph.WouldCreateCycle(Chain(), fromId: "c", toId: "a"));
    }

    [Fact]
    public void WouldCreateCycle_IgnoresLinkEdges()
    {
        // The only path from a back to c is via the link edge, which hierarchy cycle-checking ignores.
        Assert.False(MindmapGraph.WouldCreateCycle(Chain(), fromId: "a", toId: "c"));
    }

    [Fact]
    public void WouldCreateCycle_TrueForSelf()
    {
        Assert.True(MindmapGraph.WouldCreateCycle(Chain(), fromId: "a", toId: "a"));
    }

    [Fact]
    public void CollectSubtree_IncludesRootAndAllHierarchyDescendants()
    {
        var subtree = MindmapGraph.CollectSubtree(Chain(), "a");
        Assert.Equal(new HashSet<string> { "a", "b", "c" }, subtree);
    }

    [Fact]
    public void HierarchyParentEdge_FindsParent_NullForRoot()
    {
        var edges = Chain();
        Assert.Equal("e1", MindmapGraph.HierarchyParentEdge(edges, "b")!.Id);
        Assert.Null(MindmapGraph.HierarchyParentEdge(edges, "a"));
    }
}
