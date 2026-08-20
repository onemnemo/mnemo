using System;
using System.Collections.Generic;
using System.Linq;
using Avalonia;
using Avalonia.Animation;
using Avalonia.Animation.Easings;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Transformation;
using Avalonia.VisualTree;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Controls;

/// <summary>
/// Custom grid panel for the overview board. Derives the responsive column count from its width,
/// reads each child's span and canonical coordinates from attached properties, and delegates
/// placement to <see cref="IWidgetLayoutEngine"/>: at the widest breakpoint it honors stored
/// coordinates (<see cref="IWidgetLayoutEngine.Resolve"/>, free-grid placement); at narrower
/// breakpoints it flow-compacts (<see cref="IWidgetLayoutEngine.Pack"/>) so nothing is lost.
/// The panel converts placements to pixels, animates tiles between layouts (FLIP, via a
/// render-transform, never a layout property), computes edit-mode hint cells (drawn by
/// <see cref="WidgetBoardHintLayer"/> because <c>Panel.Render</c> is sealed), and translates a
/// pointer position to the grid cell under it for drag placement.
/// </summary>
public sealed class WidgetBoardPanel : Panel
{
    /// <summary>Column span of a child, bound from the widget instance's size.</summary>
    public static readonly AttachedProperty<int> ColumnSpanProperty =
        AvaloniaProperty.RegisterAttached<WidgetBoardPanel, Control, int>("ColumnSpan", 1);

    /// <summary>Row span of a child, bound from the widget instance's size.</summary>
    public static readonly AttachedProperty<int> RowSpanProperty =
        AvaloniaProperty.RegisterAttached<WidgetBoardPanel, Control, int>("RowSpan", 1);

    /// <summary>Canonical grid column of a child (-1 = unassigned), bound from the widget instance.</summary>
    public static readonly AttachedProperty<int> ColumnProperty =
        AvaloniaProperty.RegisterAttached<WidgetBoardPanel, Control, int>("Column", -1);

    /// <summary>Canonical grid row of a child (-1 = unassigned), bound from the widget instance.</summary>
    public static readonly AttachedProperty<int> RowProperty =
        AvaloniaProperty.RegisterAttached<WidgetBoardPanel, Control, int>("Row", -1);

    /// <summary>Packing engine; injected via binding from the ViewModel.</summary>
    public static readonly StyledProperty<IWidgetLayoutEngine?> LayoutEngineProperty =
        AvaloniaProperty.Register<WidgetBoardPanel, IWidgetLayoutEngine?>(nameof(LayoutEngine));

    /// <summary>Edit mode: computes dashed placeholder cells for the free grid slots.</summary>
    public static readonly StyledProperty<bool> ShowEmptyCellsProperty =
        AvaloniaProperty.Register<WidgetBoardPanel, bool>(nameof(ShowEmptyCells));

    /// <summary>Index of the child being dragged (-1 = none): it keeps the cell it was dropped on.</summary>
    public static readonly StyledProperty<int> AnchorIndexProperty =
        AvaloniaProperty.Register<WidgetBoardPanel, int>(nameof(AnchorIndex), -1);

    private const double FallbackWidth = 1200;
    private static readonly TimeSpan SlideDuration = TimeSpan.FromMilliseconds(200);

    private readonly List<Rect> _childRects = new();
    private readonly List<Rect> _hintCells = new();
    // Last arranged rect per child, keyed by the container; drives the FLIP slide animation.
    private readonly Dictionary<Control, Rect> _lastArranged = new();

    private int _lastColumnCount = OverviewBoardMetrics.MaxColumns;
    private double _lastCellWidth;
    private int _lastRowExtent;

    static WidgetBoardPanel()
    {
        AffectsMeasure<WidgetBoardPanel>(LayoutEngineProperty, ShowEmptyCellsProperty, AnchorIndexProperty);
        ColumnSpanProperty.Changed.AddClassHandler<Control>((child, _) => InvalidateOwner(child));
        RowSpanProperty.Changed.AddClassHandler<Control>((child, _) => InvalidateOwner(child));
        ColumnProperty.Changed.AddClassHandler<Control>((child, _) => InvalidateOwner(child));
        RowProperty.Changed.AddClassHandler<Control>((child, _) => InvalidateOwner(child));
    }

    public static void SetColumnSpan(Control element, int value) => element.SetValue(ColumnSpanProperty, value);
    public static int GetColumnSpan(Control element) => element.GetValue(ColumnSpanProperty);

    public static void SetRowSpan(Control element, int value) => element.SetValue(RowSpanProperty, value);
    public static int GetRowSpan(Control element) => element.GetValue(RowSpanProperty);

    public static void SetColumn(Control element, int value) => element.SetValue(ColumnProperty, value);
    public static int GetColumn(Control element) => element.GetValue(ColumnProperty);

    public static void SetRow(Control element, int value) => element.SetValue(RowProperty, value);
    public static int GetRow(Control element) => element.GetValue(RowProperty);

    public IWidgetLayoutEngine? LayoutEngine
    {
        get => GetValue(LayoutEngineProperty);
        set => SetValue(LayoutEngineProperty, value);
    }

    public bool ShowEmptyCells
    {
        get => GetValue(ShowEmptyCellsProperty);
        set => SetValue(ShowEmptyCellsProperty, value);
    }

    public int AnchorIndex
    {
        get => GetValue(AnchorIndexProperty);
        set => SetValue(AnchorIndexProperty, value);
    }

    /// <summary>Free 1×1 cells (panel coordinates) shown as dashed hints in edit mode; empty otherwise.</summary>
    public IReadOnlyList<Rect> HintCells => _hintCells;

    /// <summary>Raised after arrange whenever the hint cells may have moved.</summary>
    public event EventHandler? HintCellsChanged;

    private static void InvalidateOwner(Control child)
    {
        if (child.GetVisualParent() is WidgetBoardPanel panel)
            panel.InvalidateMeasure();
    }

    protected override Size MeasureOverride(Size availableSize)
    {
        var layout = ComputeLayout(availableSize.Width);
        for (var i = 0; i < Children.Count; i++)
            Children[i].Measure(layout.ChildRects[i].Size);

        var width = double.IsFinite(availableSize.Width) ? availableSize.Width : FallbackWidth;
        return new Size(width, layout.ExtentHeight);
    }

    protected override Size ArrangeOverride(Size finalSize)
    {
        var layout = ComputeLayout(finalSize.Width);

        _childRects.Clear();
        var live = new HashSet<Control>();
        for (var i = 0; i < Children.Count; i++)
        {
            var child = Children[i];
            var rect = layout.ChildRects[i];
            child.Arrange(rect);
            _childRects.Add(rect);
            live.Add(child);

            // FLIP: if the tile moved since the last pass, jump it back to where it was and let a
            // render-transform transition slide it into place. The dragged tile (anchor) is
            // excluded; it is hidden and its floating ghost follows the pointer instead.
            if (i == AnchorIndex)
                child.RenderTransform = TransformOperations.Identity;
            else if (_lastArranged.TryGetValue(child, out var previous))
                AnimateSlide(child, previous, rect);
            _lastArranged[child] = rect;
        }

        // Drop tracking for containers the ItemsControl recycled away.
        if (_lastArranged.Count != live.Count)
        {
            foreach (var stale in _lastArranged.Keys.Where(c => !live.Contains(c)).ToList())
                _lastArranged.Remove(stale);
        }

        RebuildHintCells(layout);
        HintCellsChanged?.Invoke(this, EventArgs.Empty);
        return new Size(finalSize.Width, layout.ExtentHeight);
    }

    /// <summary>
    /// FLIP step: the child is already arranged at <paramref name="newRect"/>. Snap it (without
    /// animating) to its old offset, then animate the render-transform back to identity so it
    /// glides to the new cell. Uses <see cref="TransformOperations"/> so the 200ms transition runs.
    /// </summary>
    private static void AnimateSlide(Control child, Rect oldRect, Rect newRect)
    {
        var dx = oldRect.X - newRect.X;
        var dy = oldRect.Y - newRect.Y;
        if (Math.Abs(dx) < 0.5 && Math.Abs(dy) < 0.5)
            return;

        child.Transitions ??= new Transitions
        {
            new TransformOperationsTransition
            {
                Property = RenderTransformProperty,
                Duration = SlideDuration,
                Easing = new CubicEaseOut()
            }
        };

        var invert = child.Transitions;
        child.Transitions = null;
        child.RenderTransform = Translate(dx, dy);
        child.Transitions = invert;
        child.RenderTransform = TransformOperations.Identity;
    }

    private static ITransform Translate(double x, double y)
    {
        var builder = new TransformOperations.Builder(1);
        builder.AppendTranslate(x, y);
        return builder.Build();
    }

    /// <summary>
    /// Translates a pointer position (panel coordinates) into the grid cell under it, for drag
    /// placement. Columns clamp to the active grid; rows clamp to one past the current extent so a
    /// new bottom row is always reachable.
    /// </summary>
    public (int Column, int Row) GetTargetCell(Point point)
    {
        var gap = OverviewBoardMetrics.Gap;
        var rowHeight = OverviewBoardMetrics.RowHeight;
        var cellWidth = _lastCellWidth > 0 ? _lastCellWidth : FallbackWidth / _lastColumnCount;

        var column = (int)Math.Floor(point.X / (cellWidth + gap));
        var row = (int)Math.Floor(point.Y / (rowHeight + gap));

        column = Math.Clamp(column, 0, _lastColumnCount - 1);
        row = Math.Clamp(row, 0, _lastRowExtent);
        return (column, row);
    }

    private readonly record struct BoardLayout(
        Rect[] ChildRects,
        WidgetPlacement[]? Placements,
        int ColumnCount,
        double CellWidth,
        double ExtentHeight);

    private BoardLayout ComputeLayout(double width)
    {
        if (!double.IsFinite(width) || width <= 0)
            width = FallbackWidth;

        var columnCount = OverviewBoardMetrics.ColumnCountForWidth(width);
        var gap = OverviewBoardMetrics.Gap;
        var rowHeight = OverviewBoardMetrics.RowHeight;
        var cellWidth = Math.Max(0, (width - (columnCount - 1) * gap) / columnCount);

        var rects = new Rect[Children.Count];
        double extentHeight = 0;

        if (LayoutEngine is not { } engine)
        {
            // No engine bound (design-time): stack children full-width so nothing crashes.
            for (var i = 0; i < Children.Count; i++)
            {
                rects[i] = new Rect(0, extentHeight, width, rowHeight);
                extentHeight += rowHeight + gap;
            }
            return new BoardLayout(rects, null, columnCount, cellWidth, extentHeight);
        }

        var placements = ComputePlacements(engine, columnCount);
        var usedRows = 0;
        for (var i = 0; i < placements.Length; i++)
        {
            var p = placements[i];
            var x = p.Column * (cellWidth + gap);
            var y = p.Row * (rowHeight + gap);
            var w = p.ColumnSpan * cellWidth + (p.ColumnSpan - 1) * gap;
            var h = p.RowSpan * rowHeight + (p.RowSpan - 1) * gap;
            rects[i] = new Rect(x, y, w, h);
            extentHeight = Math.Max(extentHeight, y + h);
            usedRows = Math.Max(usedRows, p.Row + p.RowSpan);
        }

        _lastColumnCount = columnCount;
        _lastCellWidth = cellWidth;
        // One growth row below the content is always a valid drop target.
        _lastRowExtent = usedRows;

        if (ShowEmptyCells)
        {
            // Reserve one extra hint row below the packed extent so there is always a
            // visible place to grow the board.
            extentHeight += (extentHeight > 0 ? gap : 0) + rowHeight;
        }

        return new BoardLayout(rects, placements, columnCount, cellWidth, extentHeight);
    }

    /// <summary>
    /// Placements in child order: honor stored coordinates at the widest breakpoint (free grid),
    /// or flow-compact by canonical order at narrower ones so every tile stays visible.
    /// </summary>
    private WidgetPlacement[] ComputePlacements(IWidgetLayoutEngine engine, int columnCount)
    {
        if (Children.Count == 0)
            return Array.Empty<WidgetPlacement>();

        if (columnCount >= OverviewBoardMetrics.MaxColumns)
        {
            var desired = new WidgetDesiredPlacement[Children.Count];
            for (var i = 0; i < Children.Count; i++)
                desired[i] = new WidgetDesiredPlacement(
                    GetColumn(Children[i]),
                    GetRow(Children[i]),
                    new WidgetSize(GetColumnSpan(Children[i]), GetRowSpan(Children[i])));

            return engine.Resolve(desired, columnCount, AnchorIndex).ToArray();
        }

        // Narrow breakpoint: flow-compact in canonical (Row, Column) order; coordinates from the
        // 4-column grid no longer fit, so the board collapses to a gap-free flow.
        var order = Enumerable.Range(0, Children.Count)
            .OrderBy(i => NormalizedRow(Children[i]))
            .ThenBy(i => NormalizedColumn(Children[i]))
            .ThenBy(i => i)
            .ToArray();

        var sizes = order
            .Select(i => new WidgetSize(GetColumnSpan(Children[i]), GetRowSpan(Children[i])))
            .ToList();

        var packed = engine.Pack(sizes, columnCount);
        var result = new WidgetPlacement[Children.Count];
        for (var k = 0; k < order.Length; k++)
            result[order[k]] = packed[k];
        return result;
    }

    private static int NormalizedRow(Control child)
    {
        var row = GetRow(child);
        return row < 0 ? int.MaxValue : row;
    }

    private static int NormalizedColumn(Control child)
    {
        var column = GetColumn(child);
        return column < 0 ? int.MaxValue : column;
    }

    /// <summary>Collects the free 1×1 cells (packed rows + one growth row) shown as dashed hints in edit mode.</summary>
    private void RebuildHintCells(BoardLayout layout)
    {
        _hintCells.Clear();
        if (!ShowEmptyCells || layout.Placements is not { } placements)
            return;

        var usedRows = 0;
        foreach (var p in placements)
            usedRows = Math.Max(usedRows, p.Row + p.RowSpan);

        var hintRows = usedRows + 1;
        var occupied = new bool[hintRows, layout.ColumnCount];
        foreach (var p in placements)
        {
            for (var r = p.Row; r < Math.Min(p.Row + p.RowSpan, hintRows); r++)
            {
                for (var c = p.Column; c < Math.Min(p.Column + p.ColumnSpan, layout.ColumnCount); c++)
                    occupied[r, c] = true;
            }
        }

        var gap = OverviewBoardMetrics.Gap;
        var rowHeight = OverviewBoardMetrics.RowHeight;
        for (var r = 0; r < hintRows; r++)
        {
            for (var c = 0; c < layout.ColumnCount; c++)
            {
                if (occupied[r, c])
                    continue;

                _hintCells.Add(new Rect(
                    c * (layout.CellWidth + gap),
                    r * (rowHeight + gap),
                    layout.CellWidth,
                    rowHeight));
            }
        }
    }
}
