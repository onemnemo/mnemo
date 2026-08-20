using System.Collections.Generic;
using Avalonia;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>
/// A region quadtree over content-space rectangles, indexing node items by their position in the draw
/// list. It backs two hot paths on the canvas: view-frustum culling (<see cref="Query"/> the visible
/// rect so only on-screen nodes are drawn) and hit-testing (<see cref="QueryPoint"/> under the pointer).
/// Entries that straddle a boundary are stored in every quadrant they touch, so queries may return an index
/// more than once; callers dedupe (culling sorts; hit-testing takes the topmost).
/// </summary>
internal sealed class MindmapQuadtree
{
    private const int Capacity = 8;
    private const int MaxDepth = 8;

    private readonly Rect _bounds;
    private readonly int _depth;
    private readonly List<Entry> _entries = new();
    private MindmapQuadtree[]? _quadrants;

    private readonly record struct Entry(Rect Rect, int Index);

    public MindmapQuadtree(Rect bounds, int depth = 0)
    {
        _bounds = bounds;
        _depth = depth;
    }

    public void Insert(Rect rect, int index)
    {
        if (!_bounds.Intersects(rect))
            return;

        if (_quadrants is null)
        {
            _entries.Add(new Entry(rect, index));
            if (_entries.Count > Capacity && _depth < MaxDepth)
                Subdivide();
            return;
        }

        foreach (var quadrant in _quadrants)
            quadrant.Insert(rect, index);
    }

    /// <summary>Collects the indices of every entry whose rect intersects <paramref name="area"/> (may repeat).</summary>
    public void Query(Rect area, List<int> results)
    {
        if (!_bounds.Intersects(area))
            return;

        if (_quadrants is null)
        {
            foreach (var entry in _entries)
                if (entry.Rect.Intersects(area))
                    results.Add(entry.Index);
            return;
        }

        foreach (var quadrant in _quadrants)
            quadrant.Query(area, results);
    }

    /// <summary>Collects the indices of every entry whose rect contains <paramref name="point"/> (may repeat).</summary>
    public void QueryPoint(Point point, List<int> results)
    {
        if (!_bounds.Contains(point))
            return;

        if (_quadrants is null)
        {
            foreach (var entry in _entries)
                if (entry.Rect.Contains(point))
                    results.Add(entry.Index);
            return;
        }

        foreach (var quadrant in _quadrants)
            quadrant.QueryPoint(point, results);
    }

    private void Subdivide()
    {
        var hw = _bounds.Width / 2;
        var hh = _bounds.Height / 2;
        var x = _bounds.X;
        var y = _bounds.Y;

        _quadrants = new[]
        {
            new MindmapQuadtree(new Rect(x, y, hw, hh), _depth + 1),
            new MindmapQuadtree(new Rect(x + hw, y, hw, hh), _depth + 1),
            new MindmapQuadtree(new Rect(x, y + hh, hw, hh), _depth + 1),
            new MindmapQuadtree(new Rect(x + hw, y + hh, hw, hh), _depth + 1),
        };

        foreach (var entry in _entries)
            foreach (var quadrant in _quadrants)
                quadrant.Insert(entry.Rect, entry.Index);
        _entries.Clear();
    }
}
