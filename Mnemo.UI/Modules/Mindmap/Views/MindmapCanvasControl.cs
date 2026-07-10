using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Globalization;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.LaTeX;
using Mnemo.UI.Modules.Mindmap.ViewModels;
using Mnemo.UI.Services.LaTeX.Layout.Boxes;
using Mnemo.UI.Services.LaTeX.Rendering;

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

    // Zoom-detail thresholds. Below ChromeZoom the node/edge chrome (pin badges, task checkboxes, ref
    // glyphs and badges, language chips, edge labels, resize handles, code bodies) is skipped so frame
    // times stay flat on dense maps; below LabelZoom the label text is dropped too, leaving only fills,
    // strokes and edges. Chrome implies labels, since ChromeZoom sits above LabelZoom.
    private const double ChromeZoomThreshold = 0.4;
    private const double LabelZoomThreshold = 0.15;

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

    /// <summary>Monospace font for code-node labels; bound to Geist Mono in XAML.</summary>
    public static readonly StyledProperty<FontFamily> MonoFontFamilyProperty =
        AvaloniaProperty.Register<MindmapCanvasControl, FontFamily>(nameof(MonoFontFamily), FontFamily.Default);

    /// <summary>Localized label drawn in place of an image whose asset is missing; bound via markup:T in XAML.</summary>
    public static readonly StyledProperty<string?> MissingImageLabelProperty =
        AvaloniaProperty.Register<MindmapCanvasControl, string?>(nameof(MissingImageLabel));

    /// <summary>Localized label drawn for a reference node whose target is gone; bound via markup:T in XAML.</summary>
    public static readonly StyledProperty<string?> MissingRefLabelProperty =
        AvaloniaProperty.Register<MindmapCanvasControl, string?>(nameof(MissingRefLabel));

    private IEnumerable? _nodes;
    private IEnumerable? _edges;

    private readonly List<MindmapNodeItem> _nodeList = new();
    private readonly List<MindmapEdgeItem> _edgeList = new();
    private readonly List<int> _queryBuffer = new();
    private readonly Dictionary<(string Text, bool Root, FontScale Scale, string TextToken, string ContentType, int WidthBucket), FormattedText> _textCache = new();

    // Decoded image assets keyed by absolute path, loaded lazily on first draw; a failed load caches null so
    // the placeholder draws without retrying every frame. Disposed and cleared when the control detaches.
    private readonly Dictionary<string, Bitmap?> _bitmapCache = new();

    // Per-token brush cache, keyed by style token; cleared when the theme changes so colors re-resolve.
    private readonly Dictionary<string, IBrush?> _brushCache = new();

    // Per-token edge pens (branch coloring); cleared alongside the brush cache on a theme change.
    private readonly Dictionary<string, Pen?> _edgePenCache = new();

    // Math nodes render through the LaTeX engine's layout-box tree, cached by (latex, fontSize). A cached null
    // marks invalid LaTeX so the node falls back to raw text without re-fetching. Boxes are theme-agnostic
    // (color is injected at draw time), so this survives a theme change. Requests are deduped via the in-flight
    // set, both touched only on the UI thread.
    private readonly LRUCache<(string Latex, double FontSize), Box?> _boxCache = new(300);
    private readonly HashSet<(string Latex, double FontSize)> _pendingBoxRequests = new();

    // Glyph cache for the math renderer; its key carries the color, so no clearing is needed on a theme change.
    private readonly LRUCache<(string, double, uint), FormattedText> _mathTextCache = new(500);

    // Language chips on code nodes, keyed by language; cleared with the text cache (the brush is baked in).
    private readonly Dictionary<string, FormattedText> _chipCache = new();

    // Trailing chips on reference nodes (e.g. a deck's due count), keyed by badge text; cleared alongside
    // _chipCache since both bake in the theme brush.
    private readonly Dictionary<string, FormattedText> _badgeCache = new();

    private MindmapQuadtree? _tree;
    private bool _treeDirty = true;

    // Rubber-band line shown while the connect tool drags from a source element to the cursor (content coords).
    private Point? _pendingLinkStart;
    private Point _pendingLinkEnd;

    // Selection rectangle shown while a Shift+drag marquee is in progress (content coords; null when idle).
    private Rect? _marquee;

    // Detail level of the current paint pass, derived from the camera zoom (or forced fully on for a PNG
    // export). Read by the per-kind draw code to skip chrome/labels when zoomed far out. Independent of the
    // hit-test-facing ChromeVisible, which always reflects the live camera transform.
    private bool _paintChrome = true;
    private bool _paintLabels = true;

    // Set only while rendering a PNG export, so selection highlights and resize handles stay out of the
    // exported image (a flat export shows content, not the editor's current selection).
    private bool _exporting;

    static MindmapCanvasControl()
    {
        AffectsRender<MindmapCanvasControl>(TransformProperty, SelectedStrokeProperty, EdgeStrokeProperty, FontFamilyProperty, MonoFontFamilyProperty, MissingImageLabelProperty, MissingRefLabelProperty);
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
        _chipCache.Clear();
        _badgeCache.Clear();
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
    public FontFamily MonoFontFamily { get => GetValue(MonoFontFamilyProperty); set => SetValue(MonoFontFamilyProperty, value); }
    public string? MissingImageLabel { get => GetValue(MissingImageLabelProperty); set => SetValue(MissingImageLabelProperty, value); }
    public string? MissingRefLabel { get => GetValue(MissingRefLabelProperty); set => SetValue(MissingRefLabelProperty, value); }

    /// <summary>The LaTeX layout engine used to render math nodes; set once by the view. Null falls back to raw text.</summary>
    public ILaTeXEngine? LatexEngine { get; set; }

    /// <summary>
    /// Whether node/edge chrome (pin badges, task checkboxes, ref glyphs, resize handles, ...) is drawn at
    /// the current camera zoom. The view consults this so simplified-away chrome does not respond to clicks.
    /// Derived from the live camera transform, so it is unaffected by an in-progress export paint pass.
    /// </summary>
    public bool ChromeVisible => ZoomScale(Transform) >= ChromeZoomThreshold;

    // Uniform scale factor of a camera/export transform (no rotation or skew, so this is the zoom).
    private static double ZoomScale(Matrix m) => Math.Sqrt(Math.Abs(m.M11 * m.M22 - m.M12 * m.M21));

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

    /// <summary>Returns every element whose bounds intersect <paramref name="contentRect"/> (marquee selection).</summary>
    public IReadOnlyList<MindmapNodeItem> HitTestNodes(Rect contentRect)
    {
        var results = new List<MindmapNodeItem>();
        EnsureTree();
        if (_tree is null)
            return results;

        _queryBuffer.Clear();
        _tree.Query(contentRect, _queryBuffer);

        // The quadtree stores a straddling entry in every quadrant it touches, so dedupe by index.
        var seen = new HashSet<int>();
        foreach (var index in _queryBuffer)
            if (seen.Add(index) && NodeRect(_nodeList[index]).Intersects(contentRect))
                results.Add(_nodeList[index]);
        return results;
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

            // Test each segment of the routed path (a curve arrives here already sampled into segments).
            var poly = edge.HitPolyline;
            for (var s = 0; s + 1 < poly.Count; s++)
                if (DistanceToSegment(contentPoint, poly[s], poly[s + 1]) <= threshold)
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

    /// <summary>Shows or clears the marquee selection rectangle (content coordinates; null hides it).</summary>
    public void SetMarquee(Rect? contentRect)
    {
        _marquee = contentRect;
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        if (_nodeList.Count == 0 && _edgeList.Count == 0 && _pendingLinkStart is null && _marquee is null)
            return;

        var transform = Transform;
        var det = transform.M11 * transform.M22 - transform.M12 * transform.M21;
        if (Math.Abs(det) < 1e-9)
            return;

        var visible = VisibleContentRect(transform);
        var scale = ZoomScale(transform);
        _paintChrome = scale >= ChromeZoomThreshold;
        _paintLabels = scale >= LabelZoomThreshold;

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

            if (_marquee is { } marquee)
                DrawMarquee(context, marquee, scale);
        }
    }

    // The Shift+drag selection rectangle: a faint accent fill with a dashed outline. Stroke and dashes are
    // divided by the zoom so they stay ~constant on screen at any scale (drawn under the camera transform).
    private void DrawMarquee(DrawingContext context, Rect rect, double scale)
    {
        var brush = SelectedStroke ?? Brushes.OrangeRed;
        using (context.PushOpacity(0.12))
            context.DrawRectangle(brush, null, rect);

        var stroke = Math.Max(0.0001, scale);
        var pen = new Pen(brush, 1.25 / stroke)
        {
            DashStyle = new DashStyle(new double[] { 4, 3 }, 0),
        };
        context.DrawRectangle(null, pen, rect);
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

    // A link edge: a routed connector (straight/curved/orthogonal) with arrow/dot caps and an optional label.
    private void DrawLinkEdge(DrawingContext context, MindmapEdgeItem edge, Pen defaultPen)
    {
        var selected = edge.IsSelected && !_exporting;
        var brush = selected
            ? SelectedStroke ?? Brushes.OrangeRed
            : (edge.ColorToken is { } token ? ResolveBrush(token) : null) ?? defaultPen.Brush ?? Brushes.Gray;
        // Selection keeps a visible boost over the edge's own thickness.
        var thickness = selected ? Math.Max(edge.Thickness + 0.5, SelectedStrokeThickness) : edge.Thickness;

        if (edge.LineStyle == LineStyle.Double)
        {
            // Two strokes straddling the centerline; the caps below still sit on the true path.
            var gap = thickness / 2 + 0.9;
            var doublePen = new Pen(brush, thickness) { LineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
            context.DrawGeometry(null, doublePen, edge.BuildParallelGeometry(gap));
            context.DrawGeometry(null, doublePen, edge.BuildParallelGeometry(-gap));
        }
        else
        {
            var linePen = new Pen(brush, thickness)
            {
                LineCap = PenLineCap.Round,
                LineJoin = PenLineJoin.Round,
                DashStyle = DashFor(edge.LineStyle),
            };
            context.DrawGeometry(null, linePen, edge.Geometry);
        }

        var start = edge.DrawStart;
        var end = edge.DrawEnd;
        var dx = end.X - start.X;
        var dy = end.Y - start.Y;
        if (dx * dx + dy * dy >= 1)
        {
            var capPen = new Pen(brush, thickness) { LineCap = PenLineCap.Round };
            if (edge.EndCap != ArrowCap.None)
                DrawCap(context, brush, capPen, end, edge.EndDirection, edge.EndCap);
            if (edge.StartCap != ArrowCap.None)
                DrawCap(context, brush, capPen, start, edge.StartDirection, edge.StartCap);
        }

        if (_paintChrome && !string.IsNullOrEmpty(edge.Label) && !edge.IsEditing)
            DrawEdgeLabel(context, edge, brush);
    }

    private static readonly DashStyle DashedStyle = new(new double[] { 4, 3 }, 0);
    private static readonly DashStyle DottedStyle = new(new double[] { 1, 2 }, 0);

    private static DashStyle? DashFor(LineStyle style) => style switch
    {
        LineStyle.Dashed => DashedStyle,
        LineStyle.Dotted => DottedStyle,
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
            if (!NodeRect(node).Intersects(visible))
                continue;
            DrawNode(context, node, selectedPen);

            // Free elements and frames get a bottom-right resize handle while selected (chrome-level detail).
            if (_paintChrome && !_exporting && node.IsSelected && node.IsFree)
                DrawResizeHandle(context, node);
        }
    }

    private void DrawResizeHandle(DrawingContext context, MindmapNodeItem node)
    {
        var size = MindmapNodeItem.ResizeHandleSize;
        var cx = node.X + node.Width;
        var cy = node.Y + node.Height;
        var rect = new Rect(cx - size / 2, cy - size / 2, size, size);
        context.DrawRectangle(SelectedStroke ?? Brushes.OrangeRed, null, rect, 2, 2);
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
            case ElementKind.Image:
                DrawImage(context, node, selectedPen);
                return;
        }

        var rect = NodeRect(node);
        var radius = node.Shape == NodeShape.Pill ? node.Height / 2 : CornerRadius;

        // Card/Pill have a fill; Outline/Plain don't. Plain has no border either, unless it's selected.
        var fill = node.Shape is NodeShape.Card or NodeShape.Pill
            ? ResolveBrush(node.FillToken) ?? ResolveBrush(MindmapStyleTokens.Surface)
            : null;
        Pen? border = node.IsSelected && !_exporting
            ? selectedPen
            : node.Shape == NodeShape.Plain
                ? null
                : new Pen(ResolveBrush(node.StrokeToken) ?? Brushes.Gray, NodeStrokeThickness);

        if (fill is not null || border is not null)
            context.DrawRectangle(fill, border, rect, radius, radius);

        var isTask = node.ContentType == ElementContentDiscriminators.Task;
        if (isTask && _paintChrome)
            DrawTaskCheckbox(context, node);

        if (_paintLabels)
        {
            if (node.ContentType == ElementContentDiscriminators.Math && TryDrawMath(context, node, rect))
            {
                // The rendered layout box stands in for the label; nothing else to draw for a math node here.
            }
            else if (node.ContentType == ElementContentDiscriminators.Code)
            {
                // The code body reads as chrome-level detail; the node box still draws when it is skipped.
                if (_paintChrome)
                    DrawCodeLabel(context, node, rect, fill);
            }
            else if (IsRefContent(node.ContentType))
            {
                DrawRefContent(context, node, rect, fill);
            }
            else
            {
                var text = GetFormattedText(node);
                if (text is not null)
                {
                    var textLeft = isTask
                        ? node.X + MindmapNodeItem.TaskCheckboxInset + MindmapNodeItem.TaskCheckboxSize + MindmapNodeItem.TaskTextGap
                        : node.X + TextPadding / 2;
                    var textTop = node.Y + (node.Height - text.Height) / 2;
                    context.DrawText(text, new Point(textLeft, textTop));

                    // Strike a completed task's label through.
                    if (isTask && node.IsTaskDone)
                    {
                        var y = textTop + text.Height / 2;
                        var strikePen = new Pen(ResolveBrush(node.TextToken) ?? Brushes.Gray, 1.2);
                        context.DrawLine(strikePen, new Point(textLeft, y), new Point(textLeft + text.Width, y));
                    }
                }
            }
        }

        if (_paintChrome && node.IsPinned)
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

    // A task node's checkbox: an outlined box on the left, filled with a checkmark when done.
    private void DrawTaskCheckbox(DrawingContext context, MindmapNodeItem node)
    {
        var size = MindmapNodeItem.TaskCheckboxSize;
        var x = node.X + MindmapNodeItem.TaskCheckboxInset;
        var y = node.Y + (node.Height - size) / 2;
        var box = new Rect(x, y, size, size);
        var stroke = ResolveBrush(node.TextToken) ?? Brushes.Gray;

        if (node.IsTaskDone)
        {
            var fill = ResolveBrush(MindmapStyleTokens.Accent) ?? stroke;
            context.DrawRectangle(fill, null, box, 3, 3);
            var checkPen = new Pen(ResolveBrush(MindmapStyleTokens.OnAccent) ?? Brushes.White, 1.6)
            {
                LineCap = PenLineCap.Round,
                LineJoin = PenLineJoin.Round,
            };
            context.DrawLine(checkPen, new Point(x + size * 0.24, y + size * 0.52), new Point(x + size * 0.43, y + size * 0.72));
            context.DrawLine(checkPen, new Point(x + size * 0.43, y + size * 0.72), new Point(x + size * 0.76, y + size * 0.30));
        }
        else
        {
            context.DrawRectangle(null, new Pen(stroke, 1.4), box, 3, 3);
        }
    }

    private static bool IsRefContent(string contentType) =>
        contentType is ElementContentDiscriminators.Link
            or ElementContentDiscriminators.Note
            or ElementContentDiscriminators.Flashcard;

    // A reference node: a kind glyph on the left, then the resolved title — or a muted "missing" label when the
    // target is gone, or nothing while it's still resolving — plus an optional trailing chip on the right.
    private void DrawRefContent(DrawingContext context, MindmapNodeItem node, Rect rect, IBrush? fill)
    {
        if (_paintChrome)
            DrawRefGlyph(context, node);

        var textLeft = node.X + MindmapNodeItem.RefGlyphInset + MindmapNodeItem.RefGlyphSize + MindmapNodeItem.RefTextGap;

        if (node.IsRefMissing)
        {
            DrawMissingRef(context, node, textLeft);
            return;
        }

        var text = GetFormattedText(node);
        if (text is not null)
            context.DrawText(text, new Point(textLeft, node.Y + (node.Height - text.Height) / 2));

        if (_paintChrome && !string.IsNullOrEmpty(node.RefBadge))
            DrawRefBadge(context, node.RefBadge!, rect, fill);
    }

    // The kind glyph, drawn in the node's text color: an external-link arrow, a document, or stacked cards.
    private void DrawRefGlyph(DrawingContext context, MindmapNodeItem node)
    {
        var size = MindmapNodeItem.RefGlyphSize;
        var x = node.X + MindmapNodeItem.RefGlyphInset;
        var y = node.Y + (node.Height - size) / 2;
        var brush = ResolveBrush(node.TextToken) ?? Brushes.Gray;
        var pen = new Pen(brush, 1.4) { LineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };

        switch (node.ContentType)
        {
            case ElementContentDiscriminators.Link:
                DrawLinkGlyph(context, pen, x, y, size);
                break;
            case ElementContentDiscriminators.Note:
                DrawNoteGlyph(context, pen, x, y, size);
                break;
            case ElementContentDiscriminators.Flashcard:
                DrawFlashcardGlyph(context, pen, node, x, y, size);
                break;
        }
    }

    // A diagonal arrow pointing up-right — the node opens something elsewhere.
    private static void DrawLinkGlyph(DrawingContext context, Pen pen, double x, double y, double size)
    {
        var tail = new Point(x + size * 0.22, y + size * 0.78);
        var tip = new Point(x + size * 0.80, y + size * 0.20);
        context.DrawLine(pen, tail, tip);
        context.DrawLine(pen, tip, new Point(x + size * 0.46, y + size * 0.20));
        context.DrawLine(pen, tip, new Point(x + size * 0.80, y + size * 0.54));
    }

    // A document outline with two text lines.
    private static void DrawNoteGlyph(DrawingContext context, Pen pen, double x, double y, double size)
    {
        var body = new Rect(x + size * 0.20, y + size * 0.10, size * 0.60, size * 0.80);
        context.DrawRectangle(null, pen, body, 2, 2);
        var lineLeft = body.X + size * 0.12;
        var lineRight = body.Right - size * 0.12;
        context.DrawLine(pen, new Point(lineLeft, y + size * 0.40), new Point(lineRight, y + size * 0.40));
        context.DrawLine(pen, new Point(lineLeft, y + size * 0.58), new Point(lineRight, y + size * 0.58));
    }

    // Two offset rounded rects (a stack of cards); the front is filled with the node fill so it reads as stacked.
    private void DrawFlashcardGlyph(DrawingContext context, Pen pen, MindmapNodeItem node, double x, double y, double size)
    {
        var cardFill = ResolveBrush(node.FillToken) ?? ResolveBrush(MindmapStyleTokens.Surface);
        var back = new Rect(x + size * 0.30, y + size * 0.14, size * 0.52, size * 0.52);
        var front = new Rect(x + size * 0.12, y + size * 0.34, size * 0.52, size * 0.52);
        context.DrawRectangle(null, pen, back, 2, 2);
        context.DrawRectangle(cardFill, pen, front, 2, 2);
    }

    // The muted, italic "missing reference" label, left-aligned after the glyph. Built fresh each draw (mirrors
    // the missing-image placeholder); a missing ref is rare enough not to warrant caching.
    private void DrawMissingRef(DrawingContext context, MindmapNodeItem node, double textLeft)
    {
        var label = MissingRefLabel;
        if (string.IsNullOrEmpty(label))
            return;

        var brush = ResolveBrush(MindmapStyleTokens.TextMuted) ?? Brushes.Gray;
        var text = new FormattedText(label, CultureInfo.CurrentCulture, FlowDirection.LeftToRight,
            new Typeface(FontFamily, FontStyle.Italic), FontSizeFor(node.FontScale), brush)
        {
            MaxTextWidth = Math.Max(1, node.X + node.Width - textLeft - TextPadding / 2),
            Trimming = TextTrimming.CharacterEllipsis,
        };
        context.DrawText(text, new Point(textLeft, node.Y + (node.Height - text.Height) / 2));
    }

    // A small muted chip pinned to the node's right edge (e.g. a deck's due count). Paints its own background so
    // a long title beneath doesn't show through, mirroring the code-node language chip.
    private void DrawRefBadge(DrawingContext context, string badge, Rect rect, IBrush? fill)
    {
        const double pad = MindmapNodeItem.TaskCheckboxInset;
        if (!_badgeCache.TryGetValue(badge, out var chip))
        {
            var brush = ResolveBrush(MindmapStyleTokens.TextMuted) ?? Brushes.Gray;
            chip = new FormattedText(badge, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, new Typeface(FontFamily), 9.5, brush);
            _badgeCache[badge] = chip;
        }

        var chipX = Math.Max(rect.X + pad, rect.Right - pad - chip.Width);
        var chipY = rect.Y + (rect.Height - chip.Height) / 2;

        var background = fill ?? ResolveBrush(MindmapStyleTokens.Surface);
        if (background is not null)
        {
            const double bleed = 3;
            context.DrawRectangle(background, null, new Rect(chipX - bleed, chipY - 1, chip.Width + bleed * 2, chip.Height + 2), 3, 3);
        }
        context.DrawText(chip, new Point(chipX, chipY));
    }

    // A free text label: just the text, with a selection outline so it can be grabbed when empty.
    private void DrawFreeText(DrawingContext context, MindmapNodeItem node, Pen selectedPen)
    {
        if (node.IsSelected && !_exporting)
            context.DrawRectangle(null, selectedPen, NodeRect(node), CornerRadius, CornerRadius);

        if (!_paintLabels)
            return;

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
        var border = node.IsSelected && !_exporting
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

        if (shape is ShapeType.Line or ShapeType.Arrow || !_paintLabels)
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
        var border = node.IsSelected && !_exporting
            ? selectedPen
            : new Pen(ResolveBrush(node.StrokeToken) ?? Brushes.Gray, NodeStrokeThickness);

        if (fill is not null)
        {
            using (context.PushOpacity(0.3))
                context.DrawRectangle(fill, null, rect, CornerRadius, CornerRadius);
        }

        context.DrawRectangle(null, border, rect, CornerRadius, CornerRadius);

        var text = _paintLabels ? GetFormattedText(node) : null;
        if (text is not null)
        {
            var origin = new Point(
                node.X + TextPadding / 2,
                node.Y + (MindmapNodeItem.FrameTitleHeight - text.Height) / 2);
            context.DrawText(text, origin);
        }
    }

    // A canvas image: the decoded bitmap stretched to the element rect with a thin frame (accent when
    // selected). A missing or unreadable asset falls back to a labeled placeholder.
    private void DrawImage(DrawingContext context, MindmapNodeItem node, Pen selectedPen)
    {
        var rect = NodeRect(node);
        var bitmap = node.AssetPath is { } path ? GetBitmap(path) : null;
        var border = node.IsSelected && !_exporting
            ? selectedPen
            : new Pen(ResolveBrush(node.StrokeToken) ?? Brushes.Gray, NodeStrokeThickness);

        if (bitmap is null)
        {
            DrawMissingImage(context, rect, border);
            return;
        }

        // Plain stretch: the default size is aspect-correct, and a user resize may distort (accepted).
        context.DrawImage(bitmap, rect);
        context.DrawRectangle(null, border, rect);
    }

    // Placeholder for an image whose asset can't be loaded: a muted fill, the same frame, and a centered label.
    private void DrawMissingImage(DrawingContext context, Rect rect, Pen border)
    {
        var fill = ResolveBrush(MindmapStyleTokens.SurfaceAlt) ?? ResolveBrush(MindmapStyleTokens.Surface);
        context.DrawRectangle(fill, border, rect);

        var label = MissingImageLabel;
        if (!_paintLabels || string.IsNullOrEmpty(label))
            return;

        var brush = ResolveBrush(MindmapStyleTokens.TextMuted) ?? Brushes.Gray;
        var text = new FormattedText(label, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, new Typeface(FontFamily), 12, brush)
        {
            MaxTextWidth = Math.Max(1, rect.Width - TextPadding),
            TextAlignment = TextAlignment.Center,
            Trimming = TextTrimming.CharacterEllipsis,
        };
        context.DrawText(text, new Point(rect.X + (rect.Width - text.Width) / 2, rect.Y + (rect.Height - text.Height) / 2));
    }

    // Lazily decodes and caches an image asset by absolute path; a failed load caches null (drawn as the
    // placeholder) so a missing file doesn't retry decoding on every frame.
    private Bitmap? GetBitmap(string path)
    {
        if (_bitmapCache.TryGetValue(path, out var cached))
            return cached;

        Bitmap? bitmap = null;
        try
        {
            bitmap = new Bitmap(path);
        }
        catch
        {
            // Missing or unreadable asset: cache the null result and render the placeholder instead.
        }
        _bitmapCache[path] = bitmap;
        return bitmap;
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
        // While the inline editor is open over this element, the overlay TextBox shows the text instead.
        if (node.IsEditing || string.IsNullOrEmpty(node.Text))
            return null;

        var widthBucket = (int)node.Width;
        var key = (node.Text, node.IsRoot, node.FontScale, node.TextToken, node.ContentType, widthBucket);
        if (_textCache.TryGetValue(key, out var cached))
            return cached;

        var brush = ResolveBrush(node.TextToken) ?? Brushes.Black;
        var weight = node.IsRoot ? FontWeight.SemiBold : FontWeight.Normal;

        // Code nodes read as monospace, math as italic; task and reference labels sit left of their glyph.
        var isTask = node.ContentType == ElementContentDiscriminators.Task;
        var isRef = IsRefContent(node.ContentType);
        var typeface = node.ContentType switch
        {
            ElementContentDiscriminators.Code => new Typeface(MonoFontFamily, FontStyle.Normal, weight),
            ElementContentDiscriminators.Math => new Typeface(FontFamily, FontStyle.Italic, weight),
            _ => new Typeface(FontFamily, FontStyle.Normal, weight),
        };

        FormattedText text;
        if (node.ContentType == ElementContentDiscriminators.Code)
        {
            // A code snippet keeps its own line breaks and never wraps; the caller clips it to the node box.
            text = new FormattedText(node.Text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, typeface, FontSizeFor(node.FontScale), brush)
            {
                TextAlignment = TextAlignment.Left,
            };
        }
        else
        {
            var leftInset = isTask
                ? MindmapNodeItem.TaskCheckboxInset + MindmapNodeItem.TaskCheckboxSize + MindmapNodeItem.TaskTextGap
                : isRef
                    ? MindmapNodeItem.RefGlyphInset + MindmapNodeItem.RefGlyphSize + MindmapNodeItem.RefTextGap
                    : TextPadding;

            text = new FormattedText(node.Text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, typeface, FontSizeFor(node.FontScale), brush)
            {
                MaxTextWidth = Math.Max(1, node.Width - leftInset - TextPadding / 2),
                Trimming = TextTrimming.CharacterEllipsis,
                TextAlignment = isTask || isRef ? TextAlignment.Left : TextAlignment.Center,
            };
        }

        _textCache[key] = text;
        return text;
    }

    // Shared by the canvas draw path and the SVG exporter so both size text identically.
    internal static double FontSizeFor(FontScale scale) => scale switch
    {
        FontScale.S => 11.5,
        FontScale.L => 15.5,
        FontScale.XL => 19,
        _ => 13,
    };

    // --- Math node rendering -----------------------------------------------

    // Draws a math node's LaTeX as a rendered layout box centered in its content rect. Returns false — so the
    // caller falls back to the italic raw-text label — when the engine is missing, the LaTeX is invalid, or the
    // box hasn't been laid out yet (a fetch is kicked off and the node repaints when it lands).
    private bool TryDrawMath(DrawingContext context, MindmapNodeItem node, Rect rect)
    {
        if (LatexEngine is null || node.IsEditing || string.IsNullOrEmpty(node.Text))
            return false;

        var fontSize = FontSizeFor(node.FontScale);
        var key = (node.Text, fontSize);
        if (_boxCache.TryGetValue(key, out var box))
        {
            if (box is null)
                return false;
            DrawMathBox(context, node, rect, box);
            return true;
        }

        RequestMathBox(node.Text, fontSize);
        return false;
    }

    private void DrawMathBox(DrawingContext context, MindmapNodeItem node, Rect rect, Box box)
    {
        if (box.Width <= 0 || box.TotalHeight <= 0)
            return;

        const double pad = 6;
        var availWidth = Math.Max(1, rect.Width - pad * 2);
        var availHeight = Math.Max(1, rect.Height - pad * 2);

        // Fit uniformly, never upscaling, so the expression stays crisp and centered inside the node box.
        var scale = Math.Min(1, Math.Min(availWidth / box.Width, availHeight / box.TotalHeight));
        var drawWidth = box.Width * scale;
        var drawHeight = box.TotalHeight * scale;
        var offsetX = rect.X + (rect.Width - drawWidth) / 2;
        var offsetY = rect.Y + (rect.Height - drawHeight) / 2;

        var brush = ResolveBrush(node.TextToken) ?? Brushes.Black;
        using (context.PushTransform(Matrix.CreateScale(scale, scale) * Matrix.CreateTranslation(offsetX, offsetY)))
        {
            var mathContext = new MathRenderContext(context, brush, _mathTextCache);
            box.Render(mathContext, 0, box.Height);
        }
    }

    // Fetches a layout box off the render loop, then repaints. Deduped through the in-flight set so a node
    // waiting on its box doesn't queue a fetch every frame.
    private void RequestMathBox(string latex, double fontSize)
    {
        var key = (latex, fontSize);
        if (!_pendingBoxRequests.Add(key))
            return;
        _ = FetchMathBoxAsync(latex, fontSize);
    }

    private async Task FetchMathBoxAsync(string latex, double fontSize)
    {
        Box? box = null;
        try
        {
            if (LatexEngine is { } engine)
            {
                var layout = await engine.GetLayoutBoxAsync(latex, fontSize).ConfigureAwait(true);
                box = layout as Box;
            }
        }
        catch
        {
            // Invalid or failed layout: cache the null result so the node renders raw text without retrying,
            // mirroring the image-decode fallback. The render loop must never see this throw.
            box = null;
        }

        _boxCache.Add((latex, fontSize), box);
        _pendingBoxRequests.Remove((latex, fontSize));
        InvalidateVisual();
    }

    // --- Code node rendering -----------------------------------------------

    // Draws a code snippet as left/top-aligned monospace text clipped to the node box (no wrapping), with an
    // optional language chip in the top-right. The chip paints on the node fill so it never overlaps the code.
    private void DrawCodeLabel(DrawingContext context, MindmapNodeItem node, Rect rect, IBrush? fill)
    {
        var text = GetFormattedText(node);
        if (text is null)
            return;

        const double pad = MindmapNodeItem.CodePadding;
        var inner = new Rect(rect.X + pad, rect.Y + pad, Math.Max(1, rect.Width - pad * 2), Math.Max(1, rect.Height - pad * 2));

        using (context.PushClip(inner))
            context.DrawText(text, new Point(inner.X, inner.Y));

        if (!string.IsNullOrEmpty(node.CodeLanguage))
            DrawLanguageChip(context, node.CodeLanguage!, rect, fill);
    }

    private void DrawLanguageChip(DrawingContext context, string language, Rect rect, IBrush? fill)
    {
        const double pad = MindmapNodeItem.CodePadding;
        if (!_chipCache.TryGetValue(language, out var chip))
        {
            var brush = ResolveBrush(MindmapStyleTokens.TextMuted) ?? Brushes.Gray;
            chip = new FormattedText(language, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, new Typeface(MonoFontFamily), 9.5, brush);
            _chipCache[language] = chip;
        }

        var chipX = Math.Max(rect.X + pad, rect.Right - pad - chip.Width);
        var chipY = rect.Y + pad;

        // Paint the chip's own background (the node fill) so the first code line can't show through beneath it.
        var background = fill ?? ResolveBrush(MindmapStyleTokens.Surface);
        if (background is not null)
        {
            const double bleed = 2;
            context.DrawRectangle(background, null, new Rect(chipX - bleed, chipY, chip.Width + bleed * 2, chip.Height));
        }

        context.DrawText(chip, new Point(chipX, chipY));
    }

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

    // Resolves a style token to a "#RRGGBB" string for the vector export; null when it has no solid brush.
    private string? ResolveHex(string? token) =>
        ResolveBrush(token) is ISolidColorBrush solid ? ToHex(solid.Color) : null;

    private static string ToHex(Color c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";

    // --- Export ------------------------------------------------------------

    /// <summary>
    /// The full-map extent (union of every element and edge bound) expanded by <paramref name="margin"/>,
    /// in content coordinates. Default when the map is empty.
    /// </summary>
    private Rect ContentBounds(double margin)
    {
        double minX = double.MaxValue, minY = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue;
        foreach (var node in _nodeList)
        {
            minX = Math.Min(minX, node.X);
            minY = Math.Min(minY, node.Y);
            maxX = Math.Max(maxX, node.X + node.Width);
            maxY = Math.Max(maxY, node.Y + node.Height);
        }
        foreach (var edge in _edgeList)
        {
            var b = EdgeBounds(edge);
            minX = Math.Min(minX, b.X);
            minY = Math.Min(minY, b.Y);
            maxX = Math.Max(maxX, b.Right);
            maxY = Math.Max(maxY, b.Bottom);
        }
        if (minX > maxX || minY > maxY)
            return default;
        return new Rect(minX - margin, minY - margin, (maxX - minX) + margin * 2, (maxY - minY) + margin * 2);
    }

    /// <summary>
    /// Renders the whole map (not just the viewport) into a bitmap at content scale over an opaque
    /// <paramref name="background"/>, reusing the live draw path with all detail forced on. The longest
    /// dimension is clamped to <paramref name="maxDimension"/> px by uniformly downscaling. Returns null for
    /// an empty map. Must run on the UI thread; encoding the result can then move off it.
    /// </summary>
    public RenderTargetBitmap? RenderFullMap(IBrush background, double margin, double maxDimension)
    {
        if (_nodeList.Count == 0 && _edgeList.Count == 0)
            return null;

        var bounds = ContentBounds(margin);
        if (bounds.Width <= 0 || bounds.Height <= 0)
            return null;

        var scale = 1.0;
        var longest = Math.Max(bounds.Width, bounds.Height);
        if (longest > maxDimension)
            scale = maxDimension / longest;

        var pixelWidth = Math.Max(1, (int)Math.Ceiling(bounds.Width * scale));
        var pixelHeight = Math.Max(1, (int)Math.Ceiling(bounds.Height * scale));

        var bitmap = new RenderTargetBitmap(new PixelSize(pixelWidth, pixelHeight), new Vector(96, 96));
        using (var context = bitmap.CreateDrawingContext())
        {
            context.DrawRectangle(background, null, new Rect(0, 0, pixelWidth, pixelHeight));

            var transform = Matrix.CreateTranslation(-bounds.X, -bounds.Y) * Matrix.CreateScale(scale, scale);
            var prevChrome = _paintChrome;
            var prevLabels = _paintLabels;
            _paintChrome = true;
            _paintLabels = true;
            _exporting = true;
            try
            {
                using (context.PushTransform(transform))
                {
                    DrawEdges(context, bounds);
                    DrawNodes(context, bounds);
                }
            }
            finally
            {
                // A draw failure must not leave the live canvas stuck in export mode (no selection chrome).
                _exporting = false;
                _paintChrome = prevChrome;
                _paintLabels = prevLabels;
            }
        }
        return bitmap;
    }

    /// <summary>
    /// Snapshots the map into a pure, Avalonia-visual-free scene the SVG emitter can serialize off-thread:
    /// element geometry plus each item's fill/stroke/text colors resolved to hex against the active theme.
    /// Must run on the UI thread (it resolves theme brushes).
    /// </summary>
    public MindmapSvgScene BuildSvgScene(string backgroundColor, double margin)
    {
        var edges = new List<MindmapSvgEdge>(_edgeList.Count);
        foreach (var edge in _edgeList)
            edges.Add(BuildSvgEdge(edge));

        var nodes = new List<MindmapSvgNode>(_nodeList.Count);
        foreach (var node in _nodeList)
            nodes.Add(BuildSvgNode(node));

        return new MindmapSvgScene
        {
            Bounds = ContentBounds(margin),
            BackgroundColor = backgroundColor,
            AccentColor = ResolveHex(MindmapStyleTokens.Accent) ?? "#C64F33",
            OnAccentColor = ResolveHex(MindmapStyleTokens.OnAccent) ?? "#FFFFFF",
            MutedColor = ResolveHex(MindmapStyleTokens.TextMuted) ?? "#808080",
            SurfaceColor = ResolveHex(MindmapStyleTokens.Surface) ?? "#FFFFFF",
            DefaultEdgeColor = EdgeStroke is ISolidColorBrush es ? ToHex(es.Color) : ResolveHex(MindmapStyleTokens.Stroke) ?? "#808080",
            MissingImageLabel = MissingImageLabel ?? string.Empty,
            MissingRefLabel = MissingRefLabel ?? string.Empty,
            Edges = edges,
            Nodes = nodes,
        };
    }

    private MindmapSvgEdge BuildSvgEdge(MindmapEdgeItem edge)
    {
        IReadOnlyList<Point> points;
        if (edge.IsHierarchy)
        {
            // A hierarchy edge is a fixed centre-to-centre cubic with horizontal-eased control points.
            var s = edge.Start;
            var e = edge.End;
            var midX = (s.X + e.X) / 2;
            points = new[] { s, new Point(midX, s.Y), new Point(midX, e.Y), e };
        }
        else
        {
            // A link route arrives here already sampled into polyline vertices (a curve into 16 segments).
            points = new List<Point>(edge.HitPolyline);
        }

        return new MindmapSvgEdge
        {
            IsHierarchy = edge.IsHierarchy,
            Points = points,
            Color = edge.ColorToken is { } token ? ResolveHex(token) : null,
            Thickness = edge.IsHierarchy ? EdgeStrokeThickness : edge.Thickness,
            LineStyle = edge.LineStyle,
            // Caps, directions and labels are link-edge concepts; hierarchy edges are a plain solid stroke.
            StartCap = edge.IsHierarchy ? ArrowCap.None : edge.StartCap,
            EndCap = edge.IsHierarchy ? ArrowCap.None : edge.EndCap,
            StartDirection = edge.IsHierarchy ? default : edge.StartDirection,
            EndDirection = edge.IsHierarchy ? default : edge.EndDirection,
            Midpoint = edge.Midpoint,
            Label = edge.IsHierarchy ? null : edge.Label,
        };
    }

    private MindmapSvgNode BuildSvgNode(MindmapNodeItem node)
    {
        // Fill mirrors the draw path: nodes fill only for card/pill; shapes and frames always fill; text and
        // image elements have none. A null fill tells the emitter to leave the shape unfilled.
        var fill = node.Kind switch
        {
            ElementKind.Node => node.Shape is NodeShape.Card or NodeShape.Pill
                ? ResolveHex(node.FillToken) ?? ResolveHex(MindmapStyleTokens.Surface)
                : null,
            ElementKind.Shape or ElementKind.Frame => ResolveHex(node.FillToken) ?? ResolveHex(MindmapStyleTokens.Surface),
            _ => null,
        };

        return new MindmapSvgNode
        {
            Kind = node.Kind,
            X = node.X,
            Y = node.Y,
            Width = node.Width,
            Height = node.Height,
            ContentType = node.ContentType,
            Shape = node.Shape,
            FreeShape = node.FreeShape,
            FontScale = node.FontScale,
            IsRoot = node.IsRoot,
            Text = node.Text,
            FillColor = fill,
            StrokeColor = ResolveHex(node.StrokeToken) ?? "#808080",
            TextColor = ResolveHex(node.TextToken) ?? "#000000",
            IsTaskDone = node.IsTaskDone,
            CodeLanguage = node.CodeLanguage,
            IsRefMissing = node.IsRefMissing,
            RefBadge = node.RefBadge,
            AssetPath = node.AssetPath,
        };
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
        // Inflated because a curved route bulges past the endpoint box (up to ~36px, plus caps/double gap).
        const double bulge = 40;
        var x = Math.Min(edge.Start.X, edge.End.X);
        var y = Math.Min(edge.Start.Y, edge.End.Y);
        return new Rect(x - bulge, y - bulge,
            Math.Abs(edge.End.X - edge.Start.X) + bulge * 2,
            Math.Abs(edge.End.Y - edge.Start.Y) + bulge * 2);
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
        // Endpoint moves already repaint via node changes; the selection highlight and edit-suppression need a nudge here.
        if (e.PropertyName is nameof(MindmapEdgeItem.IsSelected) or nameof(MindmapEdgeItem.IsEditing))
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
                // The text cache key includes the width bucket, so other nodes' entries stay valid; only the
                // resized node misses. Clearing here made every visible label re-shape on each resize frame.
                _treeDirty = true;
                break;
            case nameof(MindmapNodeItem.Text):
            case nameof(MindmapNodeItem.TextToken):
            case nameof(MindmapNodeItem.FontScale):
                _textCache.Clear();
                break;
            case nameof(MindmapNodeItem.IsRefMissing):
            case nameof(MindmapNodeItem.RefBadge):
                // Lazy ref resolution lands here; the label itself arrives via Text, these only need a repaint.
                break;
        }
        InvalidateVisual();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);

        // Release decoded image assets so navigating away from the editor doesn't leak their pixel buffers.
        foreach (var bitmap in _bitmapCache.Values)
            bitmap?.Dispose();
        _bitmapCache.Clear();
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        // Repaint when first laid out or resized (culling depends on the control's bounds).
        if (change.Property == BoundsProperty)
            InvalidateVisual();

        // A font change invalidates the measured/cached text.
        if (change.Property == FontFamilyProperty || change.Property == MonoFontFamilyProperty)
        {
            _textCache.Clear();
            _chipCache.Clear();
            _badgeCache.Clear();
            InvalidateVisual();
        }
    }
}
