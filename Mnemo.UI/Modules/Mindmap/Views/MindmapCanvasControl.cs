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

    // Rubber-band line shown while the connect tool drags from a source element to the cursor (content coords).
    private Point? _pendingLinkStart;
    private Point _pendingLinkEnd;

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

    /// <summary>Returns the topmost link edge within <paramref name="threshold"/> content units of the point, or null.</summary>
    public MindmapEdgeItem? HitTestEdge(Point contentPoint, double threshold)
    {
        // Later-drawn edges sit on top, so scan back-to-front and take the first within range.
        for (var i = _edgeList.Count - 1; i >= 0; i--)
        {
            var edge = _edgeList[i];
            if (edge.IsHierarchy)
                continue;
            if (DistanceToSegment(contentPoint, edge.DrawStart, edge.DrawEnd) <= threshold)
                return edge;
        }
        return null;
    }

    private static double DistanceToSegment(Point p, Point a, Point b)
    {
        var dx = b.X - a.X;
        var dy = b.Y - a.Y;
        var lengthSq = dx * dx + dy * dy;
        if (lengthSq < 1e-9)
            return Math.Sqrt((p.X - a.X) * (p.X - a.X) + (p.Y - a.Y) * (p.Y - a.Y));

        var t = Math.Clamp(((p.X - a.X) * dx + (p.Y - a.Y) * dy) / lengthSq, 0, 1);
        var projX = a.X + t * dx;
        var projY = a.Y + t * dy;
        return Math.Sqrt((p.X - projX) * (p.X - projX) + (p.Y - projY) * (p.Y - projY));
    }

    // --- Rendering ---------------------------------------------------------

    /// <summary>Shows or clears the connect tool's rubber-band line (content coordinates; null start hides it).</summary>
    public void SetPendingLink(Point? start, Point end)
    {
        _pendingLinkStart = start;
        _pendingLinkEnd = end;
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        if (_nodeList.Count == 0 && _edgeList.Count == 0 && _pendingLinkStart is null)
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

            if (_pendingLinkStart is { } pendingStart)
            {
                var pen = new Pen(SelectedStroke ?? Brushes.OrangeRed, EdgeStrokeThickness)
                {
                    LineCap = PenLineCap.Round,
                    DashStyle = new DashStyle(new double[] { 3, 3 }, 0),
                };
                context.DrawLine(pen, pendingStart, _pendingLinkEnd);
            }
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

            if (edge.IsHierarchy)
            {
                var pen = edge.ColorToken is { } token ? EdgePen(token) ?? defaultPen : defaultPen;
                context.DrawGeometry(null, pen, edge.Geometry);
            }
            else
            {
                DrawLinkEdge(context, edge, defaultPen);
            }
        }
    }

    // A link edge: a (possibly dashed) straight connector with arrow/dot caps and an optional label chip.
    private void DrawLinkEdge(DrawingContext context, MindmapEdgeItem edge, Pen defaultPen)
    {
        var brush = edge.IsSelected
            ? SelectedStroke ?? Brushes.OrangeRed
            : (edge.ColorToken is { } token ? ResolveBrush(token) : null) ?? defaultPen.Brush ?? Brushes.Gray;
        var thickness = edge.IsSelected ? SelectedStrokeThickness : EdgeStrokeThickness;
        var linePen = new Pen(brush, thickness) { LineCap = PenLineCap.Round, DashStyle = DashFor(edge.LineStyle) };
        context.DrawGeometry(null, linePen, edge.Geometry);

        var start = edge.DrawStart;
        var end = edge.DrawEnd;
        var dx = end.X - start.X;
        var dy = end.Y - start.Y;
        var len = Math.Sqrt(dx * dx + dy * dy);
        if (len >= 1)
        {
            var dir = new Point(dx / len, dy / len);
            var capPen = new Pen(brush, thickness) { LineCap = PenLineCap.Round };
            if (edge.EndCap != ArrowCap.None)
                DrawCap(context, brush, capPen, end, dir, edge.EndCap);
            if (edge.StartCap != ArrowCap.None)
                DrawCap(context, brush, capPen, start, new Point(-dir.X, -dir.Y), edge.StartCap);
        }

        if (!string.IsNullOrEmpty(edge.Label))
            DrawEdgeLabel(context, edge, brush);
    }

    private static DashStyle? DashFor(LineStyle style) => style switch
    {
        LineStyle.Dashed => new DashStyle(new double[] { 4, 3 }, 0),
        LineStyle.Dotted => new DashStyle(new double[] { 1, 2 }, 0),
        _ => null,
    };

    // Draws a cap at the tip, oriented so it points along dir (the connector's travel direction at that end).
    private static void DrawCap(DrawingContext context, IBrush brush, Pen pen, Point tip, Point dir, ArrowCap cap)
    {
        if (cap == ArrowCap.Dot)
        {
            context.DrawEllipse(brush, null, tip, 3.5, 3.5);
            return;
        }

        const double length = 9;
        const double spread = 0.45; // radians off the shaft
        var bx = -dir.X;
        var by = -dir.Y;
        var cos = Math.Cos(spread);
        var sin = Math.Sin(spread);
        var wing1 = new Point(tip.X + (bx * cos - by * sin) * length, tip.Y + (bx * sin + by * cos) * length);
        var wing2 = new Point(tip.X + (bx * cos + by * sin) * length, tip.Y + (-bx * sin + by * cos) * length);
        context.DrawLine(pen, tip, wing1);
        context.DrawLine(pen, tip, wing2);
    }

    private void DrawEdgeLabel(DrawingContext context, MindmapEdgeItem edge, IBrush brush)
    {
        var typeface = new Typeface(FontFamily);
        var text = new FormattedText(edge.Label!, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, typeface, 11, brush);
        var mid = edge.Midpoint;
        const double pad = 3;
        var rect = new Rect(mid.X - text.Width / 2 - pad, mid.Y - text.Height / 2 - pad, text.Width + pad * 2, text.Height + pad * 2);
        var background = ResolveBrush(MindmapStyleTokens.Surface) ?? Brushes.White;
        context.DrawRectangle(background, null, rect, 3, 3);
        context.DrawText(text, new Point(mid.X - text.Width / 2, mid.Y - text.Height / 2));
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
        if (_nodeList.Count == 0)
            return;

        // Cull with a straight pass over the list rather than the quadtree: a moved element marks the tree
        // dirty, so querying here would rebuild it on every drag frame. The tree is kept for hit-testing,
        // which rebuilds lazily on the next pointer press. List order is already the draw (z) order.
        var selectedPen = new Pen(SelectedStroke ?? Brushes.OrangeRed, SelectedStrokeThickness);
        for (var i = 0; i < _nodeList.Count; i++)
        {
            var node = _nodeList[i];
            if (NodeRect(node).Intersects(visible))
                DrawNode(context, node, selectedPen);
        }
    }

    private void DrawNode(DrawingContext context, MindmapNodeItem node, Pen selectedPen)
    {
        switch (node.Kind)
        {
            case ElementKind.Text:
                DrawFreeText(context, node, selectedPen);
                return;
            case ElementKind.Shape:
                DrawShape(context, node, selectedPen);
                return;
            case ElementKind.Frame:
                DrawFrame(context, node, selectedPen);
                return;
        }

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

    // A free text label: just the text, with a selection outline so it can be grabbed when empty.
    private void DrawFreeText(DrawingContext context, MindmapNodeItem node, Pen selectedPen)
    {
        if (node.IsSelected)
            context.DrawRectangle(null, selectedPen, NodeRect(node), CornerRadius, CornerRadius);

        var text = GetFormattedText(node);
        if (text is not null)
            context.DrawText(text, new Point(node.X + TextPadding / 2, node.Y + (node.Height - text.Height) / 2));
    }

    // A free shape: its geometry (filled + stroked) with optional inline text. Lines and arrows are stroke only.
    private void DrawShape(DrawingContext context, MindmapNodeItem node, Pen selectedPen)
    {
        var rect = NodeRect(node);
        var shape = node.FreeShape ?? ShapeType.Rectangle;
        var fill = ResolveBrush(node.FillToken) ?? ResolveBrush(MindmapStyleTokens.Surface);
        var border = node.IsSelected
            ? selectedPen
            : new Pen(ResolveBrush(node.StrokeToken) ?? Brushes.Gray, NodeStrokeThickness);

        switch (shape)
        {
            case ShapeType.Ellipse:
                context.DrawEllipse(fill, border, rect.Center, rect.Width / 2, rect.Height / 2);
                break;
            case ShapeType.Line:
                context.DrawLine(border, new Point(rect.Left, rect.Center.Y), new Point(rect.Right, rect.Center.Y));
                break;
            case ShapeType.Arrow:
                DrawArrow(context, border, rect);
                break;
            case ShapeType.Rectangle:
                context.DrawRectangle(fill, border, rect, CornerRadius, CornerRadius);
                break;
            default:
                context.DrawGeometry(fill, border, BuildPolygon(rect, shape));
                break;
        }

        if (shape is ShapeType.Line or ShapeType.Arrow)
            return;

        var text = GetFormattedText(node);
        if (text is not null)
            context.DrawText(text, new Point(node.X + TextPadding / 2, node.Y + (node.Height - text.Height) / 2));
    }

    // A frame: a translucent titled container drawn behind its members (projected first, so lowest z).
    // The faint fill lets the dot grid and members show through; only the title strip carries its label.
    private void DrawFrame(DrawingContext context, MindmapNodeItem node, Pen selectedPen)
    {
        var rect = NodeRect(node);
        var fill = ResolveBrush(node.FillToken) ?? ResolveBrush(MindmapStyleTokens.Surface);
        var border = node.IsSelected
            ? selectedPen
            : new Pen(ResolveBrush(node.StrokeToken) ?? Brushes.Gray, NodeStrokeThickness);

        if (fill is not null)
        {
            using (context.PushOpacity(0.3))
                context.DrawRectangle(fill, null, rect, CornerRadius, CornerRadius);
        }

        context.DrawRectangle(null, border, rect, CornerRadius, CornerRadius);

        var text = GetFormattedText(node);
        if (text is not null)
        {
            var origin = new Point(
                node.X + TextPadding / 2,
                node.Y + (MindmapNodeItem.FrameTitleHeight - text.Height) / 2);
            context.DrawText(text, origin);
        }
    }

    private static StreamGeometry BuildPolygon(Rect r, ShapeType shape)
    {
        var points = shape switch
        {
            ShapeType.Diamond => new[]
            {
                new Point(r.Center.X, r.Top), new Point(r.Right, r.Center.Y),
                new Point(r.Center.X, r.Bottom), new Point(r.Left, r.Center.Y),
            },
            ShapeType.Hexagon => new[]
            {
                new Point(r.Left + r.Width * 0.25, r.Top), new Point(r.Left + r.Width * 0.75, r.Top),
                new Point(r.Right, r.Center.Y),
                new Point(r.Left + r.Width * 0.75, r.Bottom), new Point(r.Left + r.Width * 0.25, r.Bottom),
                new Point(r.Left, r.Center.Y),
            },
            _ => new[] // Parallelogram
            {
                new Point(r.Left + r.Width * 0.18, r.Top), new Point(r.Right, r.Top),
                new Point(r.Right - r.Width * 0.18, r.Bottom), new Point(r.Left, r.Bottom),
            },
        };

        var geometry = new StreamGeometry();
        using (var ctx = geometry.Open())
        {
            ctx.BeginFigure(points[0], isFilled: true);
            for (var i = 1; i < points.Length; i++)
                ctx.LineTo(points[i]);
            ctx.EndFigure(isClosed: true);
        }
        return geometry;
    }

    private static void DrawArrow(DrawingContext context, Pen pen, Rect r)
    {
        var start = new Point(r.Left, r.Center.Y);
        var end = new Point(r.Right, r.Center.Y);
        context.DrawLine(pen, start, end);

        var head = Math.Min(12, r.Width * 0.3);
        context.DrawLine(pen, end, new Point(end.X - head, end.Y - head * 0.6));
        context.DrawLine(pen, end, new Point(end.X - head, end.Y + head * 0.6));
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

        IBrush? brush;
        if (token.StartsWith('#') && Color.TryParse(token, out var color))
        {
            // A literal hex color (custom, picked in the inspector) rather than a theme token.
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
                    {
                        _edgeList.Add(edge);
                        edge.PropertyChanged += OnEdgeItemChanged;
                    }
                break;
            case NotifyCollectionChangedAction.Remove when e.OldItems is not null:
                foreach (var item in e.OldItems)
                    if (item is MindmapEdgeItem edge)
                    {
                        _edgeList.Remove(edge);
                        edge.PropertyChanged -= OnEdgeItemChanged;
                    }
                break;
            default:
                RebuildEdgeList();
                return;
        }

        InvalidateVisual();
    }

    private void OnEdgeItemChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Endpoint moves already repaint via node changes; only the selection highlight needs a nudge here.
        if (e.PropertyName == nameof(MindmapEdgeItem.IsSelected))
            InvalidateVisual();
    }

    private void RebuildNodeList()
    {
        foreach (var node in _nodeList)
            node.PropertyChanged -= OnNodeItemChanged;
        _nodeList.Clear();
        // The text cache is keyed by content (text, scale, token, width), not by item instance, so it stays
        // valid across a reload. Keeping it means an edit or move does not re-shape every label.

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
        foreach (var edge in _edgeList)
            edge.PropertyChanged -= OnEdgeItemChanged;
        _edgeList.Clear();
        if (_edges is not null)
            foreach (var item in _edges)
                if (item is MindmapEdgeItem edge)
                {
                    _edgeList.Add(edge);
                    edge.PropertyChanged += OnEdgeItemChanged;
                }
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
