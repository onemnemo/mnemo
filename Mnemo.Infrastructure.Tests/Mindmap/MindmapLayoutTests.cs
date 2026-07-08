using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Mindmap.Layout;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// The six built-in layout providers and the dispatching service. Providers are pure functions, so
/// these assert structural invariants (side/rank/ring placement, collapse exclusion, pin anchoring) rather
/// than exact pixels.
/// </summary>
public sealed class MindmapLayoutTests
{
    private const double W = 120;
    private const double H = 40;

    private static LayoutNode Node(string id, string? parent, int order,
        bool pinned = false, bool collapsed = false, double x = 0, double y = 0) =>
        new() { Id = id, ParentId = parent, Order = order, Pinned = pinned, Collapsed = collapsed, X = x, Y = y, Width = W, Height = H };

    private static LayoutSnapshot Snapshot(string algorithm, params LayoutNode[] nodes) =>
        new() { RootId = "r", Nodes = nodes, Algorithm = algorithm, Revision = 7 };

    // A small tree: root r → a, b, c; a → a1, a2.
    private static LayoutNode[] SampleTree(bool bPinned = false, bool aCollapsed = false) => new[]
    {
        Node("r", null, 0),
        Node("a", "r", 0, collapsed: aCollapsed),
        Node("b", "r", 1, pinned: bPinned, x: bPinned ? 500 : 0, y: bPinned ? 600 : 0),
        Node("c", "r", 2),
        Node("a1", "a", 0),
        Node("a2", "a", 1),
    };

    private static double CenterX(LayoutPosition p) => p.X + W / 2;
    private static double CenterY(LayoutPosition p) => p.Y + H / 2;

    [Fact]
    public void TreeRight_FlowsChildrenRightwardByDepth()
    {
        var pos = new TreeRightLayoutProvider().Compute(Snapshot(MindmapLayoutAlgorithms.TreeRight, SampleTree()));

        Assert.True(pos["a"].X > pos["r"].X);   // depth 1 right of root
        Assert.True(pos["a1"].X > pos["a"].X);  // depth 2 right of depth 1
        Assert.True(pos["c"].X > pos["r"].X);
    }

    [Fact]
    public void TreeDown_FlowsChildrenDownwardByDepth()
    {
        var pos = new TreeDownLayoutProvider().Compute(Snapshot(MindmapLayoutAlgorithms.TreeDown, SampleTree()));

        Assert.True(pos["a"].Y > pos["r"].Y);
        Assert.True(pos["a1"].Y > pos["a"].Y);
    }

    [Fact]
    public void Balanced_SplitsChildrenToBothSidesOfRoot()
    {
        var pos = new BalancedLayoutProvider().Compute(Snapshot(MindmapLayoutAlgorithms.Balanced, SampleTree()));

        var rootCx = CenterX(pos["r"]);
        var childCentersX = new[] { "a", "b", "c" }.Select(id => CenterX(pos[id])).ToList();

        Assert.Contains(childCentersX, x => x > rootCx); // at least one on the right
        Assert.Contains(childCentersX, x => x < rootCx); // at least one on the left
    }

    [Fact]
    public void Radial_PlacesDepthOneChildrenOnARingAroundRoot()
    {
        var pos = new RadialLayoutProvider().Compute(Snapshot(MindmapLayoutAlgorithms.Radial, SampleTree()));

        var root = new LayoutPosition(CenterX(pos["r"]), CenterY(pos["r"]));
        foreach (var id in new[] { "a", "b", "c" })
        {
            var dist = Math.Sqrt(Math.Pow(CenterX(pos[id]) - root.X, 2) + Math.Pow(CenterY(pos[id]) - root.Y, 2));
            Assert.True(dist > 100, $"child '{id}' should sit out on the first ring (was {dist:0}).");
        }
    }

    [Fact]
    public void Timeline_RowsDepthOneChildrenWithSubtreesBelow()
    {
        var pos = new TimelineLayoutProvider().Compute(Snapshot(MindmapLayoutAlgorithms.Timeline, SampleTree()));

        // Depth-1 children share the root's row; the grandchild hangs below its parent.
        Assert.Equal(pos["a"].Y, pos["c"].Y, precision: 3);
        Assert.True(pos["a1"].Y > pos["a"].Y);
        Assert.True(pos["c"].X > pos["a"].X); // sequence advances rightward
    }

    [Fact]
    public void Free_KeepsEveryNodeAtItsStoredPosition()
    {
        var nodes = new[]
        {
            Node("r", null, 0, x: 10, y: 20),
            Node("a", "r", 0, x: 300, y: 90),
        };

        var pos = new FreeLayoutProvider().Compute(Snapshot(MindmapLayoutAlgorithms.Free, nodes));

        Assert.Equal(10, pos["r"].X);
        Assert.Equal(20, pos["r"].Y);
        Assert.Equal(300, pos["a"].X);
        Assert.Equal(90, pos["a"].Y);
    }

    [Fact]
    public void Collapse_ExcludesHiddenDescendants()
    {
        var pos = new TreeRightLayoutProvider().Compute(Snapshot(MindmapLayoutAlgorithms.TreeRight, SampleTree(aCollapsed: true)));

        Assert.True(pos.ContainsKey("a"));       // the collapsed node itself is placed
        Assert.False(pos.ContainsKey("a1"));     // its descendants are excluded
        Assert.False(pos.ContainsKey("a2"));
    }

    [Fact]
    public void PinnedNode_KeepsItsStoredPosition()
    {
        var pos = new TreeRightLayoutProvider().Compute(Snapshot(MindmapLayoutAlgorithms.TreeRight, SampleTree(bPinned: true)));

        Assert.Equal(500, pos["b"].X);
        Assert.Equal(600, pos["b"].Y);
    }

    [Fact]
    public void MissingRoot_YieldsNoPositions()
    {
        var snapshot = new LayoutSnapshot
        {
            RootId = "does-not-exist",
            Nodes = new[] { Node("x", null, 0) },
            Algorithm = MindmapLayoutAlgorithms.TreeRight,
        };

        Assert.Empty(new TreeRightLayoutProvider().Compute(snapshot));
    }

    [Fact]
    public async Task Service_UnknownAlgorithm_FallsBackToBalanced()
    {
        var service = BuildService();
        var snapshot = Snapshot("plugin-that-was-removed", SampleTree());

        var result = await service.ComputeAsync(snapshot);

        Assert.True(result.IsSuccess);
        Assert.Equal(7, result.Value!.Revision);
        Assert.True(result.Value.Positions.ContainsKey("r"));
        // Same shape as balanced: children split both sides.
        var rootCx = CenterX(result.Value.Positions["r"]);
        Assert.Contains(new[] { "a", "b", "c" }, id => CenterX(result.Value.Positions[id]) < rootCx);
        Assert.Contains(new[] { "a", "b", "c" }, id => CenterX(result.Value.Positions[id]) > rootCx);
    }

    [Fact]
    public async Task Service_PropagatesSnapshotRevision()
    {
        var service = BuildService();
        var result = await service.ComputeAsync(Snapshot(MindmapLayoutAlgorithms.TreeDown, SampleTree()));

        Assert.True(result.IsSuccess);
        Assert.Equal(7, result.Value!.Revision);
    }

    private static MindmapLayoutService BuildService() =>
        new(new IMindmapLayoutProvider[]
        {
            new BalancedLayoutProvider(),
            new TreeRightLayoutProvider(),
            new TreeDownLayoutProvider(),
            new RadialLayoutProvider(),
            new TimelineLayoutProvider(),
            new FreeLayoutProvider(),
        }, new TestLogger());
}
