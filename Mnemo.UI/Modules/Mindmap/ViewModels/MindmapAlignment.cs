using System.Collections.Generic;
using System.Linq;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>The align/distribute operations offered for a multi-selection of free elements.</summary>
public enum MindmapAlignOp
{
    Left,
    CenterHorizontal,
    Right,
    Top,
    MiddleVertical,
    Bottom,
    DistributeHorizontal,
    DistributeVertical,
}

/// <summary>An element's axis-aligned box, the only input the alignment math needs.</summary>
public readonly record struct AlignBox(string Id, double X, double Y, double Width, double Height);

/// <summary>A resulting position for an element that the operation moved.</summary>
public readonly record struct AlignMove(string Id, double X, double Y);

/// <summary>
/// Pure geometry for aligning and distributing free canvas elements. Given each element's box, it returns
/// the new top-left for the ones that actually move: align snaps an edge or centre to the selection's
/// extent; distribute equalises the gaps between sorted edges with the outer two anchored. No document,
/// theme or Avalonia dependency, so the view model can turn the output straight into a <c>move</c> batch and
/// the behaviour is unit-testable in isolation.
/// </summary>
public static class MindmapAlignment
{
    private const double Epsilon = 1e-6;

    /// <summary>
    /// Computes the moves for <paramref name="op"/> over <paramref name="elements"/>. Fewer than two elements
    /// (or fewer than three for a distribute) is a no-op; already-aligned elements are omitted, so re-running
    /// the same op yields nothing.
    /// </summary>
    public static IReadOnlyList<AlignMove> Compute(MindmapAlignOp op, IReadOnlyList<AlignBox> elements)
    {
        if (elements.Count < 2)
            return System.Array.Empty<AlignMove>();

        return op switch
        {
            MindmapAlignOp.Left => AlignHorizontal(elements, e => Min(elements, b => b.X)),
            MindmapAlignOp.Right => AlignHorizontal(elements, e => Max(elements, b => b.X + b.Width) - e.Width),
            MindmapAlignOp.CenterHorizontal => AlignHorizontal(elements, e => CenterX(elements) - e.Width / 2),
            MindmapAlignOp.Top => AlignVertical(elements, e => Min(elements, b => b.Y)),
            MindmapAlignOp.Bottom => AlignVertical(elements, e => Max(elements, b => b.Y + b.Height) - e.Height),
            MindmapAlignOp.MiddleVertical => AlignVertical(elements, e => CenterY(elements) - e.Height / 2),
            MindmapAlignOp.DistributeHorizontal => DistributeHorizontal(elements),
            MindmapAlignOp.DistributeVertical => DistributeVertical(elements),
            _ => System.Array.Empty<AlignMove>(),
        };
    }

    private static List<AlignMove> AlignHorizontal(IReadOnlyList<AlignBox> elements, System.Func<AlignBox, double> newX)
    {
        var moves = new List<AlignMove>();
        foreach (var e in elements)
        {
            var x = newX(e);
            if (System.Math.Abs(x - e.X) > Epsilon)
                moves.Add(new AlignMove(e.Id, x, e.Y));
        }
        return moves;
    }

    private static List<AlignMove> AlignVertical(IReadOnlyList<AlignBox> elements, System.Func<AlignBox, double> newY)
    {
        var moves = new List<AlignMove>();
        foreach (var e in elements)
        {
            var y = newY(e);
            if (System.Math.Abs(y - e.Y) > Epsilon)
                moves.Add(new AlignMove(e.Id, e.X, y));
        }
        return moves;
    }

    // Even gaps between the sorted left/right edges, leftmost and rightmost anchored (the classic "distribute
    // horizontally"). Needs at least three elements; with two there is nothing between the anchors to space.
    private static List<AlignMove> DistributeHorizontal(IReadOnlyList<AlignBox> elements)
    {
        var moves = new List<AlignMove>();
        if (elements.Count < 3)
            return moves;

        var sorted = elements.OrderBy(e => e.X).ThenBy(e => e.Id, System.StringComparer.Ordinal).ToList();
        var first = sorted[0];
        var last = sorted[^1];

        double interior = 0;
        for (var i = 1; i < sorted.Count - 1; i++)
            interior += sorted[i].Width;

        var free = last.X - (first.X + first.Width);
        var gap = (free - interior) / (sorted.Count - 1);

        var cursor = first.X + first.Width;
        for (var i = 1; i < sorted.Count - 1; i++)
        {
            cursor += gap;
            if (System.Math.Abs(cursor - sorted[i].X) > Epsilon)
                moves.Add(new AlignMove(sorted[i].Id, cursor, sorted[i].Y));
            cursor += sorted[i].Width;
        }
        return moves;
    }

    private static List<AlignMove> DistributeVertical(IReadOnlyList<AlignBox> elements)
    {
        var moves = new List<AlignMove>();
        if (elements.Count < 3)
            return moves;

        var sorted = elements.OrderBy(e => e.Y).ThenBy(e => e.Id, System.StringComparer.Ordinal).ToList();
        var first = sorted[0];
        var last = sorted[^1];

        double interior = 0;
        for (var i = 1; i < sorted.Count - 1; i++)
            interior += sorted[i].Height;

        var free = last.Y - (first.Y + first.Height);
        var gap = (free - interior) / (sorted.Count - 1);

        var cursor = first.Y + first.Height;
        for (var i = 1; i < sorted.Count - 1; i++)
        {
            cursor += gap;
            if (System.Math.Abs(cursor - sorted[i].Y) > Epsilon)
                moves.Add(new AlignMove(sorted[i].Id, sorted[i].X, cursor));
            cursor += sorted[i].Height;
        }
        return moves;
    }

    private static double CenterX(IReadOnlyList<AlignBox> e) => (Min(e, b => b.X) + Max(e, b => b.X + b.Width)) / 2;
    private static double CenterY(IReadOnlyList<AlignBox> e) => (Min(e, b => b.Y) + Max(e, b => b.Y + b.Height)) / 2;

    private static double Min(IReadOnlyList<AlignBox> e, System.Func<AlignBox, double> f)
    {
        var m = double.MaxValue;
        foreach (var b in e) m = System.Math.Min(m, f(b));
        return m;
    }

    private static double Max(IReadOnlyList<AlignBox> e, System.Func<AlignBox, double> f)
    {
        var m = double.MinValue;
        foreach (var b in e) m = System.Math.Max(m, f(b));
        return m;
    }
}
