using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Controls;
using Avalonia.VisualTree;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Controls;

/// <summary>
/// Custom flow panel for the overview board. Derives the responsive column count from its
/// width, reads each child's span from the attached properties, and delegates all packing to
/// <see cref="IWidgetLayoutEngine"/> — the panel only converts placements to pixels, computes
/// the edit-mode hint cells (drawn by <see cref="WidgetBoardHintLayer"/>, because
/// <c>Panel.Render</c> is sealed), and offers pointer-to-insertion-index translation.
/// </summary>
public sealed class WidgetBoardPanel : Panel
{
    /// <summary>Column span of a child, bound from the widget instance's size.</summary>
    public static readonly AttachedProperty<int> ColumnSpanProperty =
        AvaloniaProperty.RegisterAttached<WidgetBoardPanel, Control, int>("ColumnSpan", 1);

    /// <summary>Row span of a child, bound from the widget instance's size.</summary>
    public static readonly AttachedProperty<int> RowSpanProperty =
        AvaloniaProperty.RegisterAttached<WidgetBoardPanel, Control, int>("RowSpan", 1);

    /// <summary>Packing engine; injected via binding from the ViewModel.</summary>
    public static readonly StyledProperty<IWidgetLayoutEngine?> LayoutEngineProperty =
        AvaloniaProperty.Register<WidgetBoardPanel, IWidgetLayoutEngine?>(nameof(LayoutEngine));

    /// <summary>Edit mode: computes dashed placeholder cells for the free grid slots.</summary>
    public static readonly StyledProperty<bool> ShowEmptyCellsProperty =
        AvaloniaProperty.Register<WidgetBoardPanel, bool>(nameof(ShowEmptyCells));

    private const double FallbackWidth = 1200;

    private readonly List<Rect> _childRects = new();
    private readonly List<Rect> _hintCells = new();

    static WidgetBoardPanel()
    {
        AffectsMeasure<WidgetBoardPanel>(LayoutEngineProperty, ShowEmptyCellsProperty);
        ColumnSpanProperty.Changed.AddClassHandler<Control>((child, _) => InvalidateOwner(child));
        RowSpanProperty.Changed.AddClassHandler<Control>((child, _) => InvalidateOwner(child));
    }

    public static void SetColumnSpan(Control element, int value) => element.SetValue(ColumnSpanProperty, value);
    public static int GetColumnSpan(Control element) => element.GetValue(ColumnSpanProperty);

    public static void SetRowSpan(Control element, int value) => element.SetValue(RowSpanProperty, value);
    public static int GetRowSpan(Control element) => element.GetValue(RowSpanProperty);

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
        for (var i = 0; i < Children.Count; i++)
        {
            Children[i].Arrange(layout.ChildRects[i]);
            _childRects.Add(layout.ChildRects[i]);
        }

        RebuildHintCells(layout);
        HintCellsChanged?.Invoke(this, EventArgs.Empty);
        return new Size(finalSize.Width, layout.ExtentHeight);
    }

    /// <summary>
    /// Translates a pointer position (panel coordinates) into the index of the board slot it
    /// hovers, for drag reordering. Falls back to the nearest cell center; empty board → 0.
    /// </summary>
    public int GetInsertionIndex(Point point)
    {
        if (_childRects.Count == 0)
            return 0;

        var nearest = 0;
        var nearestDistance = double.MaxValue;
        for (var i = 0; i < _childRects.Count; i++)
        {
            if (_childRects[i].Contains(point))
                return i;

            var center = _childRects[i].Center;
            var dx = center.X - point.X;
            var dy = center.Y - point.Y;
            var distance = dx * dx + dy * dy;
            if (distance < nearestDistance)
            {
                nearestDistance = distance;
                nearest = i;
            }
        }

        return nearest;
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

        var sizes = new WidgetSize[Children.Count];
        for (var i = 0; i < Children.Count; i++)
            sizes[i] = new WidgetSize(GetColumnSpan(Children[i]), GetRowSpan(Children[i]));

        var placements = new WidgetPlacement[Children.Count];
        var packed = engine.Pack(sizes, columnCount);
        for (var i = 0; i < packed.Count; i++)
        {
            var p = packed[i];
            var x = p.Column * (cellWidth + gap);
            var y = p.Row * (rowHeight + gap);
            var w = p.ColumnSpan * cellWidth + (p.ColumnSpan - 1) * gap;
            var h = p.RowSpan * rowHeight + (p.RowSpan - 1) * gap;
            rects[i] = new Rect(x, y, w, h);
            placements[i] = p;
            extentHeight = Math.Max(extentHeight, y + h);
        }

        if (ShowEmptyCells)
        {
            // Reserve one extra hint row below the packed extent so there is always a
            // visible place to grow the board.
            extentHeight += (extentHeight > 0 ? gap : 0) + rowHeight;
        }

        return new BoardLayout(rects, placements, columnCount, cellWidth, extentHeight);
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
            for (var r = p.Row; r < p.Row + p.RowSpan; r++)
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
