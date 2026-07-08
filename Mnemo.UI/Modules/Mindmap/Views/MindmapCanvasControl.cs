using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Mnemo.Core.Models.Mindmap;
using Mnemo.UI.Modules.Mindmap.ViewModels;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>
/// The virtualized mindmap canvas: a single custom-drawn control that renders every node and edge
/// itself under the camera transform, culling to the visible rect and hit-testing through a
/// <see cref="MindmapQuadtree"/> — so cost tracks what is on screen, not the size of the document. It
/// replaces the earlier pair of <c>ItemsControl</c>s. Interaction (pan/zoom/drag/create) still lives in the
/// view code-behind, which calls <see cref="HitTestNode"/> for topmost-node picking.
/// </summary>
public sealed class MindmapCanvasControl : Control
{
    private const double CornerRadius = 10;
    private const double NodeStrokeThickness = 1.5;
    private const double SelectedStrokeThickness = 2;
    private const double EdgeStrokeThickness = 1.5;
    private const double TextPadding = 12;
    private const double CullPadding = 240;

    // --- Bound data --------------------------------------------------------

    public static readonly DirectProperty<MindmapCanvasControl, IEnumerable?> NodesProperty =
        AvaloniaProperty.RegisterDirect<MindmapCanvasControl, IEnumerable?>(nameof(Nodes), o => o.Nodes, (o, v) => o.Nodes = v);

    public static readonly DirectProperty<MindmapCanvasControl, IEnumerable?> EdgesProperty =
        AvaloniaProperty.RegisterDirect<MindmapCanvasControl, IEnumerable?>(nameof(Edges), o => o.Edges, (o, v) => o.Edges = v);

    public static readonly StyledProperty<Matrix> TransformProperty =
        AvaloniaProperty.Register<MindmapCanvasControl, Matrix>(nameof(Transform), Matrix.Identity);

    // --- Brushes (selection + edges bind to theme resources in XAML; per-node colors resolve from the
    // element's resolved style tokens, see ResolveBrush) --------------------

    public static readonly StyledProperty<IBrush?> SelectedStrokeProperty = AvaloniaProperty.Register<MindmapCanvasControl, IBrush?>(nameof(SelectedStroke));
    public static readonly StyledProperty<IBrush?> EdgeStrokeProperty = AvaloniaProperty.Register<MindmapCanvasControl, IBrush?>(nameof(EdgeStroke));

    /// <summary>Font for node labels; bound to the app's Geist family in XAML.</summary>
    public static readonly StyledProperty<FontFamily> FontFamilyProperty =
        AvaloniaProperty.Register<MindmapCanvasControl, FontFamily>(nameof(FontFamily), FontFamily.Default);

    private IEnumerable? _nodes;
    private IEnumerable? _edges;

    private readonly List<MindmapNodeItem> _nodeList = new();
    private readonly List<MindmapEdgeItem> _edgeList = new();
    private readonly List<int> _queryBuffer = new();
    private readonly Dictionary<(string Text, bool Root, FontScale Scale, string TextToken, int WidthBucket), FormattedText> _textCache = new();

    // Per-token brush cache, keyed by style token; cleared when the theme changes so colors re-resolve.
    private readonly Dictionary<string, IBrush?> _brushCache = new();

    // Per-token edge pens (branch coloring); cleared alongside the brush cache on a theme change.
    private readonly Dictionary<string, Pen?> _edgePenCache = new();

    private MindmapQuadtree? _tree;
    private bool _treeDirty = true;

    static MindmapCanvasControl()
    {
        AffectsRender<MindmapCanvasControl>(TransformProperty, SelectedStrokeProperty, EdgeStrokeProperty, FontFamilyProperty);
    }

    public MindmapCanvasControl()
    {
        // Focusable so the canvas can receive key events for the bubble-phase mindmap keybinds.
        Focusable = true;
        ActualThemeVariantChanged += OnActualThemeVariantChanged;
    }

    private void OnActualThemeVariantChanged(object? sender, EventArgs e)
    {
        // Cached brushes, pens and formatted text bake in the theme; drop them so the next render re-resolves.
        _brushCache.Clear();
        _edgePenCache.Clear();
        _textCache.Clear();
        InvalidateVisual();
    }

    public IEnumerable? Nodes
    {
        get => _nodes;
        set
        {
            if (ReferenceEquals(_nodes, value))
                return;
            DetachNodes();
            SetAndRaise(NodesProperty, ref _nodes, value);
            AttachNodes();
            RebuildNodeList();
        }
    }

    public IEnumerable? Edges
    {
        get => _edges;
        set
        {
            if (ReferenceEquals(_edges, value))
                return;
            if (_edges is INotifyCollectionChanged oldObservable)
                oldObservable.CollectionChanged -= OnEdgesChanged;
            SetAndRaise(EdgesProperty, ref _edges, value);
            if (_edges is INotifyCollectionChanged newObservable)
                newObservable.CollectionChanged += OnEdgesChanged;
            RebuildEdgeList();
        }
    }

    public Matrix Transform { get => GetValue(TransformProperty); set => SetValue(TransformProperty, value); }
    public IBrush? SelectedStroke { get => GetValue(SelectedStrokeProperty); set => SetValue(SelectedStrokeProperty, value); }
    public IBrush? EdgeStroke { get => GetValue(EdgeStrokeProperty); set => SetValue(EdgeStrokeProperty, value); }
    public FontFamily FontFamily { get => GetValue(FontFamilyProperty); set => SetValue(FontFamilyProperty, value); }

    // --- Hit-testing -------------------------------------------------------

    /// <summary>Returns the topmost node whose bounds contain <paramref name="contentPoint"/>, or null.</summary>
    public MindmapNodeItem? HitTestNode(Point contentPoint)
    {
        EnsureTree();
        if (_tree is null)
            return null;

        _queryBuffer.Clear();
        _tree.QueryPoint(contentPoint, _queryBuffer);

        // Topmost wins: nodes are drawn in list order, so the highest index that actually contains the
        // point is the visually upper one.
        var best = -1;
        foreach (var index in _queryBuffer)
            if (index > best && NodeRect(_nodeList[index]).Contains(contentPoint))
                best = index;

        return best >= 0 ? _nodeList[best] : null;
    }

    // --- Rendering ---------------------------------------------------------

    public override void Render(DrawingContext context)
    {
        if (_nodeList.Count == 0 && _edgeList.Count == 0)
            return;

        var transform = Transform;
        var det = transform.M11 * transform.M22 - transform.M12 * transform.M21;
        if (Math.Abs(det) < 1e-9)
            return;

        var visible = VisibleContentRect(transform);

        using (context.PushTransform(transform))
        {
            DrawEdges(context, visible);
            DrawNodes(context, visible);
        }
    }

    private void DrawEdges(DrawingContext context, Rect visible)
    {
        if (_edgeList.Count == 0)
            return;

        var defaultPen = new Pen(EdgeStroke ?? Brushes.Gray, EdgeStrokeThickness) { LineCap = PenLineCap.Round };
        foreach (var edge in _edgeList)
        {
            if (!EdgeBounds(edge).Intersects(visible))
                continue;
            var pen = edge.ColorToken is { } token ? EdgePen(token) ?? defaultPen : defaultPen;
            context.DrawGeometry(null, pen, edge.Geometry);
        }
    }

    // Cached branch-colored pen for a token; null when the token has no theme brush (draw uses the default).
    private Pen? EdgePen(string token)
    {
        if (_edgePenCache.TryGetValue(token, out var cached))
            return cached;

        var brush = ResolveBrush(token);
        var pen = brush is null ? null : new Pen(brush, EdgeStrokeThickness) { LineCap = PenLineCap.Round };
        _edgePenCache[token] = pen;
        return pen;
    }

    private void DrawNodes(DrawingContext context, Rect visible)
    {
        EnsureTree();
        if (_tree is null)
            return;

        _queryBuffer.Clear();
        _tree.Query(visible, _queryBuffer);
        _queryBuffer.Sort(); // ascending index == draw order; also groups duplicates for dedupe

        var selectedPen = new Pen(SelectedStroke ?? Brushes.OrangeRed, SelectedStrokeThickness);

        var previous = -1;
        foreach (var index in _queryBuffer)
        {
            if (index == previous)
                continue;
            previous = index;
            DrawNode(context, _nodeList[index], selectedPen);
        }
    }

    private void DrawNode(DrawingContext context, MindmapNodeItem node, Pen selectedPen)
    {
        var rect = NodeRect(node);
        var radius = node.Shape == NodeShape.Pill ? node.Height / 2 : CornerRadius;

        // Card/Pill have a fill; Outline/Plain don't. Plain has no border either, unless it's selected.
        var fill = node.Shape is NodeShape.Card or NodeShape.Pill
            ? ResolveBrush(node.FillToken) ?? ResolveBrush(MindmapStyleTokens.Surface)
            : null;
        Pen? border = node.IsSelected
            ? selectedPen
            : node.Shape == NodeShape.Plain
                ? null
                : new Pen(ResolveBrush(node.StrokeToken) ?? Brushes.Gray, NodeStrokeThickness);

        if (fill is not null || border is not null)
            context.DrawRectangle(fill, border, rect, radius, radius);

        var text = GetFormattedText(node);
        if (text is not null)
        {
            var origin = new Point(node.X + TextPadding / 2, node.Y + (node.Height - text.Height) / 2);
            context.DrawText(text, origin);
        }

        if (node.IsPinned)
        {
            // Dot in the top-right in the node's text color, so it contrasts with the fill.
            var pinBrush = ResolveBrush(node.TextToken) ?? SelectedStroke;
            if (pinBrush is not null)
            {
                var center = new Point(
                    node.X + node.Width - MindmapNodeItem.PinBadgeInset,
                    node.Y + MindmapNodeItem.PinBadgeInset);
                context.DrawEllipse(pinBrush, null, center, MindmapNodeItem.PinBadgeRadius, MindmapNodeItem.PinBadgeRadius);
            }
        }
    }

    private FormattedText? GetFormattedText(MindmapNodeItem node)
    {
        if (string.IsNullOrEmpty(node.Text))
            return null;

        var widthBucket = (int)node.Width;
        var key = (node.Text, node.IsRoot, node.FontScale, node.TextToken, widthBucket);
        if (_textCache.TryGetValue(key, out var cached))
            return cached;

        var brush = ResolveBrush(node.TextToken) ?? Brushes.Black;
        var weight = node.IsRoot ? FontWeight.SemiBold : FontWeight.Normal;
        var typeface = new Typeface(FontFamily, FontStyle.Normal, weight);
        var text = new FormattedText(node.Text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, typeface, FontSizeFor(node.FontScale), brush)
        {
            MaxTextWidth = Math.Max(1, node.Width - TextPadding),
            Trimming = TextTrimming.CharacterEllipsis,
            TextAlignment = TextAlignment.Center,
        };
        _textCache[key] = text;
        return text;
    }

    private static double FontSizeFor(FontScale scale) => scale switch
    {
        FontScale.S => 11.5,
        FontScale.L => 15.5,
        FontScale.XL => 19,
        _ => 13,
    };

    /// <summary>Resolves a style token to a theme brush (cached); null if the token has no brush.</summary>
    private IBrush? ResolveBrush(string? token)
    {
        if (token is null)
            return null;
        if (_brushCache.TryGetValue(token, out var cached))
            return cached;

        IBrush? brush = null;
        var key = MindmapStyleBrushes.ResourceKey(token);
        if (key is not null && this.TryFindResource(key, out var value) && value is IBrush resolved)
            brush = resolved;

        _brushCache[token] = brush;
        return brush;
    }

    // --- Spatial index -----------------------------------------------------

    private void EnsureTree()
    {
        if (!_treeDirty)
            return;
        _treeDirty = false;

        if (_nodeList.Count == 0)
        {
            _tree = null;
            return;
        }

        double minX = double.MaxValue, minY = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue;
        foreach (var node in _nodeList)
        {
            minX = Math.Min(minX, node.X);
            minY = Math.Min(minY, node.Y);
            maxX = Math.Max(maxX, node.X + node.Width);
            maxY = Math.Max(maxY, node.Y + node.Height);
        }

        // Pad so a node sitting exactly on the outer edge still lands inside the root bounds.
        var bounds = new Rect(minX - 1, minY - 1, (maxX - minX) + 2, (maxY - minY) + 2);
        var tree = new MindmapQuadtree(bounds);
        for (var i = 0; i < _nodeList.Count; i++)
            tree.Insert(NodeRect(_nodeList[i]), i);
        _tree = tree;
    }

    private Rect VisibleContentRect(Matrix transform)
    {
        var inverse = transform.Invert();
        var topLeft = new Point(0, 0) * inverse;
        var bottomRight = new Point(Bounds.Width, Bounds.Height) * inverse;
        var x = Math.Min(topLeft.X, bottomRight.X) - CullPadding;
        var y = Math.Min(topLeft.Y, bottomRight.Y) - CullPadding;
        var w = Math.Abs(bottomRight.X - topLeft.X) + CullPadding * 2;
        var h = Math.Abs(bottomRight.Y - topLeft.Y) + CullPadding * 2;
        return new Rect(x, y, w, h);
    }

    private static Rect NodeRect(MindmapNodeItem node) => new(node.X, node.Y, node.Width, node.Height);

    private static Rect EdgeBounds(MindmapEdgeItem edge)
    {
        var x = Math.Min(edge.Start.X, edge.End.X);
        var y = Math.Min(edge.Start.Y, edge.End.Y);
        return new Rect(x, y, Math.Abs(edge.End.X - edge.Start.X), Math.Abs(edge.End.Y - edge.Start.Y));
    }

    // --- Collection / item change tracking ---------------------------------

    private void AttachNodes()
    {
        if (_nodes is INotifyCollectionChanged observable)
            observable.CollectionChanged += OnNodesChanged;
    }

    private void DetachNodes()
    {
        if (_nodes is INotifyCollectionChanged observable)
            observable.CollectionChanged -= OnNodesChanged;
        foreach (var node in _nodeList)
            node.PropertyChanged -= OnNodeItemChanged;
    }

    // Handle Add/Remove incrementally so a Clear-then-append reload is O(n), not O(n²).
    private void OnNodesChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        switch (e.Action)
        {
            case NotifyCollectionChangedAction.Add when e.NewItems is not null:
                var insertAt = e.NewStartingIndex >= 0 ? e.NewStartingIndex : _nodeList.Count;
                foreach (var item in e.NewItems)
                    if (item is MindmapNodeItem node)
                    {
                        _nodeList.Insert(Math.Min(insertAt++, _nodeList.Count), node);
                        node.PropertyChanged += OnNodeItemChanged;
                    }
                break;
            case NotifyCollectionChangedAction.Remove when e.OldItems is not null:
                foreach (var item in e.OldItems)
                    if (item is MindmapNodeItem node)
                    {
                        _nodeList.Remove(node);
                        node.PropertyChanged -= OnNodeItemChanged;
                    }
                break;
            default:
                RebuildNodeList();
                return;
        }

        _treeDirty = true;
        InvalidateVisual();
    }

    private void OnEdgesChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        switch (e.Action)
        {
            case NotifyCollectionChangedAction.Add when e.NewItems is not null:
                foreach (var item in e.NewItems)
                    if (item is MindmapEdgeItem edge)
                        _edgeList.Add(edge);
                break;
            case NotifyCollectionChangedAction.Remove when e.OldItems is not null:
                foreach (var item in e.OldItems)
                    if (item is MindmapEdgeItem edge)
                        _edgeList.Remove(edge);
                break;
            default:
                RebuildEdgeList();
                return;
        }

        InvalidateVisual();
    }

    private void RebuildNodeList()
    {
        foreach (var node in _nodeList)
            node.PropertyChanged -= OnNodeItemChanged;
        _nodeList.Clear();
        _textCache.Clear();

        if (_nodes is not null)
            foreach (var item in _nodes)
                if (item is MindmapNodeItem node)
                {
                    _nodeList.Add(node);
                    node.PropertyChanged += OnNodeItemChanged;
                }

        _treeDirty = true;
        InvalidateVisual();
    }

    private void RebuildEdgeList()
    {
        _edgeList.Clear();
        if (_edges is not null)
            foreach (var item in _edges)
                if (item is MindmapEdgeItem edge)
                    _edgeList.Add(edge);
        InvalidateVisual();
    }

    private void OnNodeItemChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(MindmapNodeItem.X):
            case nameof(MindmapNodeItem.Y):
                _treeDirty = true;
                break;
            case nameof(MindmapNodeItem.Width):
            case nameof(MindmapNodeItem.Height):
                _treeDirty = true;
                _textCache.Clear();
                break;
            case nameof(MindmapNodeItem.Text):
            case nameof(MindmapNodeItem.TextToken):
            case nameof(MindmapNodeItem.FontScale):
                _textCache.Clear();
                break;
        }
        InvalidateVisual();
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        // Repaint when first laid out or resized (culling depends on the control's bounds).
        if (change.Property == BoundsProperty)
            InvalidateVisual();

        // A font change invalidates the measured/cached text.
        if (change.Property == FontFamilyProperty)
        {
            _textCache.Clear();
            InvalidateVisual();
        }
    }
}
