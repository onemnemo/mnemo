using System.Collections.Generic;
using System.Linq;
using Mnemo.UI.Modules.Mindmap.ViewModels;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Covers the pure align/distribute geometry that the mindmap editor turns into a move batch: each of the six
/// align ops, both distributes over uneven boxes, and the no-op guards (too few elements, already aligned).
/// </summary>
public class MindmapAlignmentTests
{
    private static AlignBox Box(string id, double x, double y, double w = 20, double h = 10) => new(id, x, y, w, h);

    private static double NewX(IReadOnlyList<AlignMove> moves, string id) => moves.Single(m => m.Id == id).X;
    private static double NewY(IReadOnlyList<AlignMove> moves, string id) => moves.Single(m => m.Id == id).Y;
    private static bool Moved(IReadOnlyList<AlignMove> moves, string id) => moves.Any(m => m.Id == id);

    [Fact]
    public void Left_alignsToLeftmostEdge_andLeavesYUntouched()
    {
        var boxes = new[] { Box("a", 0, 5), Box("b", 40, 30), Box("c", 100, 80) };

        var moves = MindmapAlignment.Compute(MindmapAlignOp.Left, boxes);

        Assert.False(Moved(moves, "a")); // already at the minimum X
        Assert.Equal(0, NewX(moves, "b"));
        Assert.Equal(0, NewX(moves, "c"));
        Assert.Equal(30, NewY(moves, "b")); // Y is preserved
        Assert.Equal(80, NewY(moves, "c"));
    }

    [Fact]
    public void Right_alignsRightEdges()
    {
        // Widths differ, so a right-align sets X = maxRight - width per element.
        var boxes = new[] { Box("a", 0, 0, w: 20), Box("b", 50, 0, w: 40), Box("c", 100, 0, w: 10) };
        var maxRight = 110; // b: 50 + 40 = 90; c: 100 + 10 = 110 -> 110 wins

        var moves = MindmapAlignment.Compute(MindmapAlignOp.Right, boxes);

        Assert.Equal(maxRight - 20, NewX(moves, "a"));
        Assert.Equal(maxRight - 40, NewX(moves, "b"));
        Assert.False(Moved(moves, "c")); // already the rightmost edge
    }

    [Fact]
    public void CenterHorizontal_centersOnSelectionMidline()
    {
        var boxes = new[] { Box("a", 0, 0, w: 20), Box("b", 80, 0, w: 20) };
        var center = (0 + 100) / 2.0; // min X 0, max right 100

        var moves = MindmapAlignment.Compute(MindmapAlignOp.CenterHorizontal, boxes);

        Assert.Equal(center - 10, NewX(moves, "a"));
        Assert.Equal(center - 10, NewX(moves, "b"));
    }

    [Fact]
    public void Top_alignsToTopmostEdge_andLeavesXUntouched()
    {
        var boxes = new[] { Box("a", 5, 0), Box("b", 40, 40), Box("c", 90, 70) };

        var moves = MindmapAlignment.Compute(MindmapAlignOp.Top, boxes);

        Assert.False(Moved(moves, "a"));
        Assert.Equal(0, NewY(moves, "b"));
        Assert.Equal(0, NewY(moves, "c"));
        Assert.Equal(40, NewX(moves, "b")); // X is preserved
    }

    [Fact]
    public void Bottom_alignsBottomEdges()
    {
        var boxes = new[] { Box("a", 0, 0, h: 10), Box("b", 0, 20, h: 40), Box("c", 0, 30, h: 10) };
        var maxBottom = 60; // b: 20 + 40 = 60

        var moves = MindmapAlignment.Compute(MindmapAlignOp.Bottom, boxes);

        Assert.Equal(maxBottom - 10, NewY(moves, "a"));
        Assert.False(Moved(moves, "b"));
        Assert.Equal(maxBottom - 10, NewY(moves, "c"));
    }

    [Fact]
    public void MiddleVertical_centersOnSelectionMidline()
    {
        var boxes = new[] { Box("a", 0, 0, h: 10), Box("b", 0, 90, h: 10) };
        var center = (0 + 100) / 2.0;

        var moves = MindmapAlignment.Compute(MindmapAlignOp.MiddleVertical, boxes);

        Assert.Equal(center - 5, NewY(moves, "a"));
        Assert.Equal(center - 5, NewY(moves, "b"));
    }

    [Fact]
    public void DistributeHorizontal_equalisesGaps_withUnevenWidths()
    {
        // Anchors a (right edge 20) and d (left edge 200). Interior widths: b=40, c=10 -> sum 50.
        // free = 200 - 20 = 180; gap = (180 - 50) / 3 = 43.333...
        var boxes = new[]
        {
            Box("a", 0, 0, w: 20),
            Box("b", 30, 0, w: 40),
            Box("c", 150, 0, w: 10),
            Box("d", 200, 0, w: 20),
        };

        var moves = MindmapAlignment.Compute(MindmapAlignOp.DistributeHorizontal, boxes);

        var gap = (180.0 - 50.0) / 3.0;
        var bX = 20 + gap;           // right of a + gap
        var cX = bX + 40 + gap;      // right of b + gap
        Assert.Equal(bX, NewX(moves, "b"), 6);
        Assert.Equal(cX, NewX(moves, "c"), 6);
        Assert.False(Moved(moves, "a")); // anchors never move
        Assert.False(Moved(moves, "d"));

        // The realised gaps between consecutive edges are all equal.
        var g1 = bX - 20;
        var g2 = cX - (bX + 40);
        var g3 = 200 - (cX + 10);
        Assert.Equal(g1, g2, 6);
        Assert.Equal(g2, g3, 6);
    }

    [Fact]
    public void DistributeVertical_equalisesGaps_withUnevenHeights()
    {
        var boxes = new[]
        {
            Box("a", 0, 0, h: 10),
            Box("b", 0, 30, h: 30),
            Box("c", 0, 150, h: 10),
            Box("d", 0, 200, h: 10),
        };

        var moves = MindmapAlignment.Compute(MindmapAlignOp.DistributeVertical, boxes);

        // interior heights b=30, c=10 -> 40; free = 200 - 10 = 190; gap = (190 - 40)/3 = 50
        var gap = (190.0 - 40.0) / 3.0;
        var bY = 10 + gap;
        var cY = bY + 30 + gap;
        Assert.Equal(bY, NewY(moves, "b"), 6);
        Assert.Equal(cY, NewY(moves, "c"), 6);
        Assert.False(Moved(moves, "a"));
        Assert.False(Moved(moves, "d"));
    }

    [Fact]
    public void Distribute_withTwoElements_isNoOp()
    {
        var boxes = new[] { Box("a", 0, 0), Box("b", 100, 0) };

        Assert.Empty(MindmapAlignment.Compute(MindmapAlignOp.DistributeHorizontal, boxes));
        Assert.Empty(MindmapAlignment.Compute(MindmapAlignOp.DistributeVertical, boxes));
    }

    [Fact]
    public void SingleOrEmptyInput_isAlwaysNoOp()
    {
        var one = new[] { Box("a", 10, 10) };
        Assert.Empty(MindmapAlignment.Compute(MindmapAlignOp.Left, one));
        Assert.Empty(MindmapAlignment.Compute(MindmapAlignOp.DistributeVertical, one));

        var none = System.Array.Empty<AlignBox>();
        Assert.Empty(MindmapAlignment.Compute(MindmapAlignOp.CenterHorizontal, none));
    }

    [Fact]
    public void AlreadyAligned_isIdempotent()
    {
        // Left edges already flush -> a left-align returns nothing.
        var aligned = new[] { Box("a", 5, 0), Box("b", 5, 40), Box("c", 5, 80) };
        Assert.Empty(MindmapAlignment.Compute(MindmapAlignOp.Left, aligned));

        // Evenly distributed already -> running distribute again returns nothing.
        var even = new[] { Box("a", 0, 0, w: 10), Box("b", 45, 0, w: 10), Box("c", 90, 0, w: 10) };
        Assert.Empty(MindmapAlignment.Compute(MindmapAlignOp.DistributeHorizontal, even));
    }
}
