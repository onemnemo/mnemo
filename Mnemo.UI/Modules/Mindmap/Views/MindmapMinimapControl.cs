using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Mnemo.Core.Models.Mindmap;
using Mnemo.UI.Modules.Mindmap.ViewModels;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>
/// The bottom-right minimap: every element drawn as a tiny swatch in its resolved fill color, with the
/// current viewport as an outlined rectangle. Clicking or dragging recenters the camera on the pointed-at
/// content position (via <see cref="PanRequested"/>; the view forwards it to the view model's camera).
/// </summary>
public sealed class MindmapMinimapControl : Control
{
    private const double ContentPadding = 80;
    private const double MinSwatchSize = 2;

    public static readonly DirectProperty<MindmapMinimapControl, IEnumerable?> NodesProperty =
        AvaloniaProperty.RegisterDirect<MindmapMinimapControl, IEnumerable?>(nameof(Nodes), o => o.Nodes, (o, v) => o.Nodes = v);

    /// <summary>The visible content rect (content coordinates), kept current by the view model's camera.</summary>
    public static readonly StyledProperty<Rect> ViewportRectProperty =
        AvaloniaProperty.Register<MindmapMinimapControl, Rect>(nameof(ViewportRect));

    public static readonly StyledProperty<IBrush?> ViewportStrokeProperty =
        AvaloniaProperty.Register<MindmapMinimapControl, IBrush?>(nameof(ViewportStroke));

    private IEnumerable? _nodes;
    private readonly List<MindmapNodeItem> _items = new();
    private readonly Dictionary<string, IBrush?> _brushCache = new();

    // Content→minimap mapping of the last render (minimap = content * scale + offset), reused to map
    // pointer positions back to content space. Invalid until something has been drawn.
    private double _mapScale;
    private Point _mapOffset;
    private bool _hasMapping;
    private bool _isDragging;

    /// <summary>Raised with the content point the camera should center on (press or drag on the map).</summary>
    public event Action<Point>? PanRequested;

    static MindmapMinimapControl()
    {
        AffectsRender<MindmapMinimapControl>(ViewportRectProperty, ViewportStrokeProperty);
    }

    public MindmapMinimapControl()
    {
        ActualThemeVariantChanged += OnActualThemeVariantChanged;
    }

    private void OnActualThemeVariantChanged(object? sender, EventArgs e)
    {
        _brushCache.Clear();
        InvalidateVisual();
    }

    public IEnumerable? Nodes
    {
        get => _nodes;
        set
        {
            if (ReferenceEquals(_nodes, value))
                return;
            if (_nodes is INotifyCollectionChanged oldObservable)
                oldObservable.CollectionChanged -= OnNodesChanged;
            SetAndRaise(NodesProperty, ref _nodes, value);
            if (_nodes is INotifyCollectionChanged newObservable)
                newObservable.CollectionChanged += OnNodesChanged;
            RebuildItems();
        }
    }

    public Rect ViewportRect { get => GetValue(ViewportRectProperty); set => SetValue(ViewportRectProperty, value); }
    public IBrush? ViewportStroke { get => GetValue(ViewportStrokeProperty); set => SetValue(ViewportStrokeProperty, value); }

    public override void Render(DrawingContext context)
    {
        _hasMapping = false;
        if (_items.Count == 0 || Bounds.Width <= 0 || Bounds.Height <= 0)
            return;

        double minX = double.MaxValue, minY = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue;
        foreach (var item in _items)
        {
            minX = Math.Min(minX, item.X);
            minY = Math.Min(minY, item.Y);
            maxX = Math.Max(maxX, item.X + item.Width);
            maxY = Math.Max(maxY, item.Y + item.Height);
        }
        if (minX > maxX)
            return;

        var content = new Rect(
            minX - ContentPadding, minY - ContentPadding,
            (maxX - minX) + ContentPadding * 2, (maxY - minY) + ContentPadding * 2);

        var scale = Math.Min(Bounds.Width / content.Width, Bounds.Height / content.Height);
        var offset = new Point(
            (Bounds.Width - content.Width * scale) / 2 - content.X * scale,
            (Bounds.Height - content.Height * scale) / 2 - content.Y * scale);
        _mapScale = scale;
        _mapOffset = offset;
        _hasMapping = true;

        foreach (var item in _items)
        {
            var rect = new Rect(
                item.X * scale + offset.X,
                item.Y * scale + offset.Y,
                Math.Max(MinSwatchSize, item.Width * scale),
                Math.Max(MinSwatchSize, item.Height * scale));

            // Frames read as containers: outline only, so their members stay visible inside.
            if (item.Kind == ElementKind.Frame)
            {
                var framePen = new Pen(ResolveBrush(item.StrokeToken) ?? ResolveBrush(MindmapStyleTokens.Stroke) ?? Brushes.Gray, 1);
                context.DrawRectangle(null, framePen, rect, 1.5, 1.5);
                continue;
            }

            var fill = ResolveBrush(item.FillToken)
                ?? ResolveBrush(item.StrokeToken)
                ?? ResolveBrush(MindmapStyleTokens.TextMuted)
                ?? Brushes.Gray;
            context.DrawRectangle(fill, null, rect, 1.5, 1.5);
        }

        var viewport = ViewportRect;
        if (viewport.Width > 0 && viewport.Height > 0 && ViewportStroke is { } stroke)
        {
            var vr = new Rect(
                viewport.X * scale + offset.X,
                viewport.Y * scale + offset.Y,
                viewport.Width * scale,
                viewport.Height * scale);
            context.DrawRectangle(null, new Pen(stroke, 1.5), vr.Intersect(new Rect(Bounds.Size).Inflate(-0.75)), 2, 2);
        }
    }

    // --- Pointer: click or drag recenters the camera -------------------------

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (!_hasMapping || !e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            return;
        _isDragging = true;
        e.Pointer.Capture(this);
        RequestPan(e.GetPosition(this));
        e.Handled = true;
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_isDragging && _hasMapping)
            RequestPan(e.GetPosition(this));
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        _isDragging = false;
        e.Pointer.Capture(null);
    }

    private void RequestPan(Point minimapPoint)
    {
        var content = new Point(
            (minimapPoint.X - _mapOffset.X) / _mapScale,
            (minimapPoint.Y - _mapOffset.Y) / _mapScale);
        PanRequested?.Invoke(content);
    }

    // --- Item tracking --------------------------------------------------------

    // Handle Add/Remove incrementally so the projection's clear-then-append reload is O(n), not O(n²).
    private void OnNodesChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        switch (e.Action)
        {
            case NotifyCollectionChangedAction.Add when e.NewItems is not null:
                foreach (var candidate in e.NewItems)
                    if (candidate is MindmapNodeItem item)
                    {
                        _items.Add(item);
                        item.PropertyChanged += OnItemChanged;
                    }
                break;
            case NotifyCollectionChangedAction.Remove when e.OldItems is not null:
                foreach (var candidate in e.OldItems)
                    if (candidate is MindmapNodeItem item)
                    {
                        _items.Remove(item);
                        item.PropertyChanged -= OnItemChanged;
                    }
                break;
            default:
                RebuildItems();
                return;
        }

        InvalidateVisual();
    }

    private void RebuildItems()
    {
        foreach (var item in _items)
            item.PropertyChanged -= OnItemChanged;
        _items.Clear();
        if (_nodes is not null)
            foreach (var candidate in _nodes)
                if (candidate is MindmapNodeItem item)
                {
                    _items.Add(item);
                    item.PropertyChanged += OnItemChanged;
                }
        InvalidateVisual();
    }

    private void OnItemChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MindmapNodeItem.X) or nameof(MindmapNodeItem.Y)
            or nameof(MindmapNodeItem.Width) or nameof(MindmapNodeItem.Height)
            or nameof(MindmapNodeItem.FillToken) or nameof(MindmapNodeItem.StrokeToken))
            InvalidateVisual();
    }

    /// <summary>Resolves a style token to a theme brush (cached); mirrors the canvas control's resolution.</summary>
    private IBrush? ResolveBrush(string? token)
    {
        if (token is null)
            return null;
        if (_brushCache.TryGetValue(token, out var cached))
            return cached;

        IBrush? brush;
        if (token.StartsWith('#') && Color.TryParse(token, out var color))
        {
            brush = new SolidColorBrush(color);
        }
        else
        {
            brush = null;
            var key = MindmapStyleBrushes.ResourceKey(token);
            if (key is not null && this.TryFindResource(key, out var value) && value is IBrush resolved)
                brush = resolved;
        }

        _brushCache[token] = brush;
        return brush;
    }
}
