using Mnemo.Core.Models.Widgets;
using Mnemo.Infrastructure.Services.Widgets;

namespace Mnemo.Infrastructure.Tests.Widgets;

public class WidgetLayoutEngineTests
{
    private readonly WidgetLayoutEngine _engine = new();

    private static WidgetSize S(int columns, int rows) => new(columns, rows);

    [Fact]
    public void Pack_EmptyInput_ReturnsEmpty()
    {
        var placements = _engine.Pack([], 4);
        Assert.Empty(placements);
    }

    [Fact]
    public void Pack_SingleWidget_PlacedTopLeft()
    {
        var placements = _engine.Pack([S(2, 1)], 4);
        Assert.Equal(new WidgetPlacement(0, 0, 2, 1), placements[0]);
    }

    [Fact]
    public void Pack_FlowsLeftToRightThenWraps()
    {
        var placements = _engine.Pack([S(2, 1), S(1, 1), S(1, 1), S(2, 2)], 4);

        Assert.Equal(new WidgetPlacement(0, 0, 2, 1), placements[0]);
        Assert.Equal(new WidgetPlacement(2, 0, 1, 1), placements[1]);
        Assert.Equal(new WidgetPlacement(3, 0, 1, 1), placements[2]);
        Assert.Equal(new WidgetPlacement(0, 1, 2, 2), placements[3]);
    }

    [Fact]
    public void Pack_Dense_FillsHolesLeftByWideWidgets()
    {
        // A 3-wide widget leaves a 1-wide hole in row 0; the 2-wide widget wraps to row 1,
        // and the later 1×1 must backfill the hole (grid-auto-flow: dense semantics).
        var placements = _engine.Pack([S(3, 1), S(2, 1), S(1, 1)], 4);

        Assert.Equal(new WidgetPlacement(0, 0, 3, 1), placements[0]);
        Assert.Equal(new WidgetPlacement(0, 1, 2, 1), placements[1]);
        Assert.Equal(new WidgetPlacement(3, 0, 1, 1), placements[2]);
    }

    [Theory]
    [InlineData(2, 2)]
    [InlineData(1, 1)]
    public void Pack_ClampsSpansWiderThanColumnCount(int columnCount, int expectedSpan)
    {
        var placements = _engine.Pack([S(4, 1)], columnCount);

        Assert.Equal(0, placements[0].Column);
        Assert.Equal(expectedSpan, placements[0].ColumnSpan);
    }

    [Fact]
    public void Pack_SingleColumn_StacksEverything()
    {
        var placements = _engine.Pack([S(2, 1), S(4, 2), S(1, 1)], 1);

        Assert.Equal(new WidgetPlacement(0, 0, 1, 1), placements[0]);
        Assert.Equal(new WidgetPlacement(0, 1, 1, 2), placements[1]);
        Assert.Equal(new WidgetPlacement(0, 3, 1, 1), placements[2]);
    }

    [Fact]
    public void Pack_Reorder_ChangesPlacementsAccordingly()
    {
        var sizes = new[] { S(2, 1), S(2, 1), S(2, 1) };
        var before = _engine.Pack(sizes, 4);
        Assert.Equal(new WidgetPlacement(0, 0, 2, 1), before[0]);
        Assert.Equal(new WidgetPlacement(2, 0, 2, 1), before[1]);
        Assert.Equal(new WidgetPlacement(0, 1, 2, 1), before[2]);

        // Moving the last widget to the front is a pure input reorder — same slots, new owners.
        var reordered = new[] { sizes[2], sizes[0], sizes[1] };
        var after = _engine.Pack(reordered, 4);
        Assert.Equal(new WidgetPlacement(0, 0, 2, 1), after[0]);
        Assert.Equal(new WidgetPlacement(2, 0, 2, 1), after[1]);
        Assert.Equal(new WidgetPlacement(0, 1, 2, 1), after[2]);
    }

    [Fact]
    public void Pack_Resize_RepacksFollowingWidgets()
    {
        var before = _engine.Pack([S(2, 1), S(2, 1)], 4);
        Assert.Equal(new WidgetPlacement(2, 0, 2, 1), before[1]);

        // Growing the first widget to full width pushes the second to the next row.
        var after = _engine.Pack([S(4, 1), S(2, 1)], 4);
        Assert.Equal(new WidgetPlacement(0, 0, 4, 1), after[0]);
        Assert.Equal(new WidgetPlacement(0, 1, 2, 1), after[1]);
    }

    [Fact]
    public void Pack_NonPositiveSpans_ClampToOne()
    {
        var placements = _engine.Pack([S(0, 0)], 4);
        Assert.Equal(new WidgetPlacement(0, 0, 1, 1), placements[0]);
    }

    [Fact]
    public void Pack_PlacementsNeverOverlap()
    {
        var placements = _engine.Pack(
            [S(2, 2), S(1, 1), S(3, 1), S(2, 1), S(1, 2), S(4, 1), S(1, 1)], 4);

        var occupied = new HashSet<(int Column, int Row)>();
        foreach (var p in placements)
        {
            for (var r = p.Row; r < p.Row + p.RowSpan; r++)
            {
                for (var c = p.Column; c < p.Column + p.ColumnSpan; c++)
                {
                    Assert.True(occupied.Add((c, r)), $"Cell ({c},{r}) is occupied twice.");
                    Assert.InRange(c, 0, 3);
                }
            }
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Pack_InvalidColumnCount_Throws(int columnCount)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => _engine.Pack([S(1, 1)], columnCount));
    }

    // ----- Resolve (free-grid placement) -----

    private static WidgetDesiredPlacement D(int column, int row, int columns, int rows)
        => new(column, row, new WidgetSize(columns, rows));

    [Fact]
    public void Resolve_HonorsStoredCoordinates()
    {
        var placements = _engine.Resolve([D(2, 0, 2, 1), D(0, 1, 1, 1)], 4);

        Assert.Equal(new WidgetPlacement(2, 0, 2, 1), placements[0]);
        Assert.Equal(new WidgetPlacement(0, 1, 1, 1), placements[1]);
    }

    [Fact]
    public void Resolve_LeavesGapAbove_NoUpwardCompaction()
    {
        // A lone tile placed in row 3 stays there — the empty rows above it are intentional.
        var placements = _engine.Resolve([D(0, 3, 1, 1)], 4);

        Assert.Equal(new WidgetPlacement(0, 3, 1, 1), placements[0]);
    }

    [Fact]
    public void Resolve_Overlap_PushesLaterWidgetDown()
    {
        // Two tiles want the same cell; the second in processing order (by row/col) yields downward.
        var placements = _engine.Resolve([D(0, 0, 2, 2), D(0, 0, 2, 1)], 4);

        Assert.Equal(new WidgetPlacement(0, 0, 2, 2), placements[0]);
        Assert.Equal(new WidgetPlacement(0, 2, 2, 1), placements[1]);
    }

    [Fact]
    public void Resolve_Anchor_KeepsItsCellWhileOthersYield()
    {
        // The anchor (index 1) is dropped onto index 0's cell; the anchor wins, index 0 pushes down.
        var placements = _engine.Resolve([D(0, 0, 2, 1), D(0, 0, 2, 1)], 4, anchorIndex: 1);

        Assert.Equal(new WidgetPlacement(0, 0, 2, 1), placements[1]);
        Assert.Equal(new WidgetPlacement(0, 1, 2, 1), placements[0]);
    }

    [Fact]
    public void Resolve_UnassignedCoordinates_DropIntoFirstFreeCell()
    {
        // (-1,-1) means "unassigned": placed densely after the positioned widget.
        var placements = _engine.Resolve([D(0, 0, 2, 1), D(-1, -1, 2, 1)], 4);

        Assert.Equal(new WidgetPlacement(0, 0, 2, 1), placements[0]);
        Assert.Equal(new WidgetPlacement(2, 0, 2, 1), placements[1]);
    }

    [Fact]
    public void Resolve_ClampsColumnAndSpanToGrid()
    {
        // Column 3 with a 3-wide span cannot fit in a 4-column grid; the column clamps to 1.
        var placements = _engine.Resolve([D(3, 0, 3, 1)], 4);

        Assert.Equal(new WidgetPlacement(1, 0, 3, 1), placements[0]);
    }

    [Fact]
    public void Resolve_PlacementsNeverOverlap()
    {
        var placements = _engine.Resolve(
            [D(0, 0, 2, 2), D(1, 0, 2, 1), D(0, 0, 1, 1), D(3, 1, 1, 2), D(2, 2, 2, 1)], 4);

        var occupied = new HashSet<(int Column, int Row)>();
        foreach (var p in placements)
        {
            for (var r = p.Row; r < p.Row + p.RowSpan; r++)
            {
                for (var c = p.Column; c < p.Column + p.ColumnSpan; c++)
                {
                    Assert.True(occupied.Add((c, r)), $"Cell ({c},{r}) is occupied twice.");
                    Assert.InRange(c, 0, 3);
                }
            }
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Resolve_InvalidColumnCount_Throws(int columnCount)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => _engine.Resolve([D(0, 0, 1, 1)], columnCount));
    }
}
