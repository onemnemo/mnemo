using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
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
    private const double EdgeStrokeThickness = 1.5;
    private const double FontSize = 13;
    private const double TextPadding = 12;
    private const double CullPadding = 240;

    // --- Bound data --------------------------------------------------------

    public static readonly DirectProperty<MindmapCanvasControl, IEnumerable?> NodesProperty =
        AvaloniaProperty.RegisterDirect<MindmapCanvasControl, IEnumerable?>(nameof(Nodes), o => o.Nodes, (o, v) => o.Nodes = v);

    public static readonly DirectProperty<MindmapCanvasControl, IEnumerable?> EdgesProperty =
        AvaloniaProperty.RegisterDirect<MindmapCanvasControl, IEnumerable?>(nameof(Edges), o => o.Edges, (o, v) => o.Edges = v);

    public static readonly StyledProperty<Matrix> TransformProperty =
        AvaloniaProperty.Register<MindmapCanvasControl, Matrix>(nameof(Transform), Matrix.Identity);

    // --- Brushes (bound to theme resources in XAML) ------------------------

    public static readonly StyledProperty<IBrush?> NodeFillProperty = AvaloniaProperty.Register<MindmapCanvasControl, IBrush?>(nameof(NodeFill));
    public static readonly StyledProperty<IBrush?> NodeStrokeProperty = AvaloniaProperty.Register<MindmapCanvasControl, IBrush?>(nameof(NodeStroke));
    public static readonly StyledProperty<IBrush?> NodeTextProperty = AvaloniaProperty.Register<MindmapCanvasControl, IBrush?>(nameof(NodeText));
    public static readonly StyledProperty<IBrush?> RootFillProperty = AvaloniaProperty.Register<MindmapCanvasControl, IBrush?>(nameof(RootFill));
    public static readonly StyledProperty<IBrush?> RootTextProperty = AvaloniaProperty.Register<MindmapCanvasControl, IBrush?>(nameof(RootText));
    public static readonly StyledProperty<IBrush?> SelectedStrokeProperty = AvaloniaProperty.Register<MindmapCanvasControl, IBrush?>(nameof(SelectedStroke));
    public static readonly StyledProperty<IBrush?> EdgeStrokeProperty = AvaloniaProperty.Register<MindmapCanvasControl, IBrush?>(nameof(EdgeStroke));

    private IEnumerable? _nodes;
    private IEnumerable? _edges;

    private readonly List<MindmapNodeItem> _nodeList = new();
    private readonly List<MindmapEdgeItem> _edgeList = new();
    private readonly List<int> _queryBuffer = new();
    private readonly Dictionary<(bool Root, string Text), FormattedText> _textCache = new();

    private MindmapQuadtree? _tree;
    private bool _treeDirty = true;

    static MindmapCanvasControl()
    {
        AffectsRender<MindmapCanvasControl>(
            TransformProperty, NodeFillProperty, NodeStrokeProperty, NodeTextProperty,
            RootFillProperty, RootTextProperty, SelectedStrokeProperty, EdgeStrokeProperty);
    }

    public MindmapCanvasControl()
    {
        // Focusable so the canvas can receive key events for the bubble-phase mindmap keybinds.
        Focusable = true;
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
    public IBrush? NodeFill { get => GetValue(NodeFillProperty); set => SetValue(NodeFillProperty, value); }
    public IBrush? NodeStroke { get => GetValue(NodeStrokeProperty); set => SetValue(NodeStrokeProperty, value); }
    public IBrush? NodeText { get => GetValue(NodeTextProperty); set => SetValue(NodeTextProperty, value); }
    public IBrush? RootFill { get => GetValue(RootFillProperty); set => SetValue(RootFillProperty, value); }
    public IBrush? RootText { get => GetValue(RootTextProperty); set => SetValue(RootTextProperty, value); }
    public IBrush? SelectedStroke { get => GetValue(SelectedStrokeProperty); set => SetValue(SelectedStrokeProperty, value); }
    public IBrush? EdgeStroke { get => GetValue(EdgeStrokeProperty); set => SetValue(EdgeStrokeProperty, value); }

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

        var pen = new Pen(EdgeStroke ?? Brushes.Gray, EdgeStrokeThickness) { LineCap = PenLineCap.Round };
        foreach (var edge in _edgeList)
        {
            if (!EdgeBounds(edge).Intersects(visible))
                continue;
            context.DrawGeometry(null, pen, edge.Geometry);
        }
    }

    private void DrawNodes(DrawingContext context, Rect visible)
    {
        EnsureTree();
        if (_tree is null)
            return;

        _queryBuffer.Clear();
        _tree.Query(visible, _queryBuffer);
        _queryBuffer.Sort(); // ascending index == draw order; also groups duplicates for dedupe

        var nodePen = new Pen(NodeStroke ?? Brushes.Gray, NodeStrokeThickness);
        var selectedPen = new Pen(SelectedStroke ?? Brushes.OrangeRed, NodeStrokeThickness);

        var previous = -1;
        foreach (var index in _queryBuffer)
        {
            if (index == previous)
                continue;
            previous = index;
            DrawNode(context, _nodeList[index], nodePen, selectedPen);
        }
    }

    private void DrawNode(DrawingContext context, MindmapNodeItem node, Pen nodePen, Pen selectedPen)
    {
        var rect = NodeRect(node);
        var fill = node.IsRoot ? RootFill : NodeFill;
        var pen = node.IsSelected ? selectedPen : nodePen;
        context.DrawRectangle(fill, pen, rect, CornerRadius, CornerRadius);

        var text = GetFormattedText(node);
        if (text is null)
            return;

        var origin = new Point(node.X + TextPadding / 2, node.Y + (node.Height - text.Height) / 2);
        context.DrawText(text, origin);
    }

    private FormattedText? GetFormattedText(MindmapNodeItem node)
    {
        var brush = node.IsRoot ? RootText : NodeText;
        if (brush is null || string.IsNullOrEmpty(node.Text))
            return null;

        var key = (node.IsRoot, node.Text);
        if (_textCache.TryGetValue(key, out var cached))
            return cached;

        var typeface = new Typeface(FontFamily.Default, FontStyle.Normal, node.IsRoot ? FontWeight.SemiBold : FontWeight.Normal);
        var text = new FormattedText(node.Text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, typeface, FontSize, brush)
        {
            MaxTextWidth = Math.Max(1, node.Width - TextPadding),
            Trimming = TextTrimming.CharacterEllipsis,
            TextAlignment = TextAlignment.Center,
        };
        _textCache[key] = text;
        return text;
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
            case nameof(MindmapNodeItem.Width):
            case nameof(MindmapNodeItem.Height):
                _treeDirty = true;
                break;
            case nameof(MindmapNodeItem.Text):
                _textCache.Clear();
                break;
        }
        InvalidateVisual();
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        // Rebuilt text bakes in the theme text brush, so drop the cache when those brushes change.
        if (change.Property == NodeTextProperty || change.Property == RootTextProperty)
            _textCache.Clear();

        // Repaint when first laid out or resized (culling depends on the control's bounds).
        if (change.Property == BoundsProperty)
            InvalidateVisual();
    }
}
