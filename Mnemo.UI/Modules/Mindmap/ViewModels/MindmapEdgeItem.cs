using System;
using System.Collections.Generic;
using System.ComponentModel;
using Avalonia;
using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>
/// A rendered edge on the editor canvas. Hierarchy edges are a curved connector between two node centers;
/// link edges are a routed connector clipped to each endpoint's box so an arrow cap can sit on the
/// boundary. The edge holds references to its endpoint items and recomputes its geometry whenever either
/// end moves, so edges follow elements live during a drag without a document round-trip.
/// </summary>
public partial class MindmapEdgeItem : ObservableObject, IDisposable
{
    /// <summary>Fallback stroke width when an edge carries no explicit thickness override.</summary>
    public const double DefaultThickness = 1.5;

    private readonly MindmapNodeItem _from;
    private readonly MindmapNodeItem _to;
    private bool _disposed;

    // Resolved link route (cached); recomputed on the next access after either endpoint moves. Hierarchy
    // edges never use it (they draw a fixed center-to-center bezier).
    private LinkRoute? _route;

    public MindmapEdgeItem(
        string id,
        MindmapNodeItem from,
        MindmapNodeItem to,
        bool isHierarchy = true,
        string? colorToken = null,
        ArrowCap startCap = ArrowCap.None,
        ArrowCap endCap = ArrowCap.None,
        LineStyle lineStyle = LineStyle.Solid,
        EdgeRouting routing = EdgeRouting.Curve,
        double thickness = DefaultThickness,
        string? label = null)
    {
        Id = id;
        _from = from;
        _to = to;
        IsHierarchy = isHierarchy;
        ColorToken = colorToken;
        StartCap = startCap;
        EndCap = endCap;
        LineStyle = lineStyle;
        Routing = routing;
        Thickness = thickness;
        Label = label;
        _from.PropertyChanged += OnEndpointChanged;
        _to.PropertyChanged += OnEndpointChanged;
    }

    public string Id { get; }

    public bool IsHierarchy { get; }

    /// <summary>Whether this edge is the selected one (link edges only); drawn highlighted.</summary>
    [ObservableProperty]
    private bool _isSelected;

    /// <summary>True while the edge's label is being edited inline; the canvas suppresses the drawn label chip so the overlay editor isn't doubled underneath.</summary>
    [ObservableProperty]
    private bool _isEditing;

    /// <summary>Style token for the line color (a branch palette token or hex), or null to use the default edge brush.</summary>
    public string? ColorToken { get; }

    /// <summary>Arrow caps and line style, resolved from the edge's style (link edges default to a solid line with an end arrow).</summary>
    public ArrowCap StartCap { get; }
    public ArrowCap EndCap { get; }
    public LineStyle LineStyle { get; }

    /// <summary>How the link edge is routed between its endpoints (link edges only).</summary>
    public EdgeRouting Routing { get; }

    /// <summary>Stroke width of the link edge.</summary>
    public double Thickness { get; }

    /// <summary>Optional label drawn at the connector midpoint.</summary>
    public string? Label { get; }

    public Point Start => new(_from.CenterX, _from.CenterY);

    public Point End => new(_to.CenterX, _to.CenterY);

    /// <summary>Line endpoints actually drawn: hierarchy edges run center to center; link edges stop on each element's outline.</summary>
    public Point DrawStart => IsHierarchy ? Start : Route.Points[0];

    public Point DrawEnd => IsHierarchy ? End : Route.Points[^1];

    // The resolved route for a link edge (lazy, cached until an endpoint moves).
    private LinkRoute Route => _route ??= LinkRoute.Build(_from, _to, Routing);

    /// <summary>Midpoint of the drawn connector, where the label sits; follows the routed path for link edges.</summary>
    public Point Midpoint => IsHierarchy
        ? new((DrawStart.X + DrawEnd.X) / 2, (DrawStart.Y + DrawEnd.Y) / 2)
        : Route.Midpoint;

    /// <summary>Unit vector a start cap points along (outward from the path at the start); link edges only.</summary>
    public Point StartDirection => Route.StartDirection;

    /// <summary>Unit vector an end cap points along (the path's travel direction at the end); link edges only.</summary>
    public Point EndDirection => Route.EndDirection;

    /// <summary>The routed path as a polyline (a curve is sampled), for hit-testing each segment.</summary>
    public IReadOnlyList<Point> HitPolyline => Route.Points;

    /// <summary>Connector geometry: a horizontal-ease cubic bezier for the tree, the routed path for links.
    /// Cached — the canvas re-reads it every render frame, so only edges whose endpoints moved rebuild.</summary>
    public Geometry Geometry => IsHierarchy
        ? _hierarchyGeometry ??= BuildHierarchyGeometry()
        : Route.GeometryFor(0);

    /// <summary>A copy of the link path shifted by <paramref name="offset"/> along its normals, for the double line style.</summary>
    public Geometry BuildParallelGeometry(double offset) => Route.GeometryFor(offset);

    private Geometry? _hierarchyGeometry;

    private void OnEndpointChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MindmapNodeItem.CenterX) or nameof(MindmapNodeItem.CenterY))
        {
            _route = null;
            _hierarchyGeometry = null;
            OnPropertyChanged(nameof(Start));
            OnPropertyChanged(nameof(End));
            OnPropertyChanged(nameof(Geometry));
        }
    }

    private Geometry BuildHierarchyGeometry()
    {
        var geometry = new StreamGeometry();
        using (var ctx = geometry.Open())
        {
            var start = Start;
            var end = End;
            var midX = (start.X + end.X) / 2;
            ctx.BeginFigure(start, isFilled: false);
            ctx.CubicBezierTo(new Point(midX, start.Y), new Point(midX, end.Y), end);
            ctx.EndFigure(isClosed: false);
        }
        return geometry;
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _from.PropertyChanged -= OnEndpointChanged;
        _to.PropertyChanged -= OnEndpointChanged;
    }

    /// <summary>
    /// A resolved link route between two box-exit points. Straight and orthogonal routes are a polyline;
    /// a curve stores its four bezier control points (and a sampled polyline for hit-testing). The label
    /// midpoint and the cap directions follow the actual path, and the geometry can be re-emitted offset
    /// along its normals for the double line style.
    /// </summary>
    private sealed class LinkRoute
    {
        private const double Epsilon = 1e-6;

        private readonly Point[] _points;   // route vertices; a curve stores its sampled points here
        private readonly Point[]? _bezier;  // four control points when the route is a curve

        // Geometry per normal offset (0 = centerline; ±gap for the double line style). The route is
        // replaced whenever an endpoint moves, so entries never go stale.
        private readonly Dictionary<double, Geometry> _geometryCache = new(1);

        private LinkRoute(Point[] points, Point[]? bezier, Point midpoint, Point startDir, Point endDir)
        {
            _points = points;
            _bezier = bezier;
            Midpoint = midpoint;
            StartDirection = startDir;
            EndDirection = endDir;
        }

        public IReadOnlyList<Point> Points => _points;
        public Point Midpoint { get; }
        public Point StartDirection { get; }
        public Point EndDirection { get; }

        public static LinkRoute Build(MindmapNodeItem from, MindmapNodeItem to, EdgeRouting routing)
        {
            var fromCenter = new Point(from.CenterX, from.CenterY);
            var toCenter = new Point(to.CenterX, to.CenterY);

            // Orthogonal routes leave through a face, so they anchor on face centers, not the chord exit.
            if (routing == EdgeRouting.Orthogonal)
                return Orthogonal(from, to, fromCenter, toCenter);

            var start = ShapeExit(from, toCenter);
            var end = ShapeExit(to, fromCenter);
            var dx = end.X - start.X;
            var dy = end.Y - start.Y;
            var chordLen = Math.Sqrt(dx * dx + dy * dy);

            // A zero-length route (overlapping boxes) has no meaningful direction; fall back to a segment.
            if (chordLen < Epsilon)
                return Straight(start, end);

            return routing == EdgeRouting.Straight
                ? Straight(start, end)
                : Curve(start, end, dx, dy, chordLen);
        }

        private static LinkRoute Straight(Point start, Point end)
        {
            var mid = new Point((start.X + end.X) / 2, (start.Y + end.Y) / 2);
            return new LinkRoute(new[] { start, end }, null, mid, OutwardDir(end, start), OutwardDir(start, end));
        }

        private static LinkRoute Orthogonal(MindmapNodeItem from, MindmapNodeItem to, Point fromCenter, Point toCenter)
        {
            var cdx = toCenter.X - fromCenter.X;
            var cdy = toCenter.Y - fromCenter.Y;

            // Anchor at the center of the face each end travels through — a face midpoint lies exactly on
            // the outline for every shape we draw (pill, rounded rect, ellipse, diamond), so the elbow path
            // meets the border flush and perpendicular.
            Point start, end;
            Point[] pts;
            Point mid;
            if (Math.Abs(cdx) >= Math.Abs(cdy))
            {
                var sign = cdx >= 0 ? 1 : -1;
                start = new Point(fromCenter.X + sign * from.Width / 2, fromCenter.Y);
                end = new Point(toCenter.X - sign * to.Width / 2, toCenter.Y);
                var midX = (start.X + end.X) / 2;
                pts = new[] { start, new Point(midX, start.Y), new Point(midX, end.Y), end };
                mid = new Point(midX, (start.Y + end.Y) / 2);
            }
            else
            {
                var sign = cdy >= 0 ? 1 : -1;
                start = new Point(fromCenter.X, fromCenter.Y + sign * from.Height / 2);
                end = new Point(toCenter.X, toCenter.Y - sign * to.Height / 2);
                var midY = (start.Y + end.Y) / 2;
                pts = new[] { start, new Point(start.X, midY), new Point(end.X, midY), end };
                mid = new Point((start.X + end.X) / 2, midY);
            }

            // Aligned boxes collapse the elbows into zero-length segments; drop them so tangents stay valid.
            pts = Dedupe(pts);
            var startDir = OutwardDir(pts[1], pts[0]);
            var endDir = OutwardDir(pts[^2], pts[^1]);
            return new LinkRoute(pts, null, mid, startDir, endDir);
        }

        /// <summary>Point where the ray from an element's center toward <paramref name="toward"/> crosses its drawn outline.</summary>
        private static Point ShapeExit(MindmapNodeItem node, Point toward)
        {
            var cx = node.CenterX;
            var cy = node.CenterY;
            var dx = toward.X - cx;
            var dy = toward.Y - cy;
            if (Math.Abs(dx) < Epsilon && Math.Abs(dy) < Epsilon)
                return new Point(cx, cy);

            var hw = node.Width / 2;
            var hh = node.Height / 2;

            if (node.FreeShape == ShapeType.Ellipse)
            {
                var t = 1 / Math.Sqrt(dx * dx / (hw * hw) + dy * dy / (hh * hh));
                return new Point(cx + dx * t, cy + dy * t);
            }
            if (node.FreeShape == ShapeType.Diamond)
            {
                var t = 1 / (Math.Abs(dx) / hw + Math.Abs(dy) / hh);
                return new Point(cx + dx * t, cy + dy * t);
            }

            var scale = double.PositiveInfinity;
            if (dx != 0)
                scale = Math.Min(scale, hw / Math.Abs(dx));
            if (dy != 0)
                scale = Math.Min(scale, hh / Math.Abs(dy));
            var exit = new Point(cx + dx * scale, cy + dy * scale);

            // The rect exit floats off the drawn outline inside a rounded corner (worst on pills, whose
            // rounding is half the height); pull it onto the corner arc.
            var r = Math.Min(CornerRoundingFor(node), Math.Min(hw, hh));
            if (r > Epsilon && Math.Abs(exit.X - cx) > hw - r && Math.Abs(exit.Y - cy) > hh - r)
            {
                var qx = cx + Math.Sign(exit.X - cx) * (hw - r);
                var qy = cy + Math.Sign(exit.Y - cy) * (hh - r);
                var ex = exit.X - qx;
                var ey = exit.Y - qy;
                var len = Math.Sqrt(ex * ex + ey * ey);
                if (len > Epsilon)
                    exit = new Point(qx + ex / len * r, qy + ey / len * r);
            }
            return exit;
        }

        // Corner rounding of the element's drawn outline (mirrors the canvas draw radii).
        private static double CornerRoundingFor(MindmapNodeItem node) => node.Kind switch
        {
            ElementKind.Node => node.Shape == NodeShape.Pill ? node.Height / 2 : 10,
            ElementKind.Frame => 10,
            ElementKind.Shape when node.FreeShape is null or ShapeType.Rectangle => 10,
            _ => 0,
        };

        private static LinkRoute Curve(Point start, Point end, double dx, double dy, double chordLen)
        {
            var ux = dx / chordLen;
            var uy = dy / chordLen;
            var nx = -uy; // chord normal
            var ny = ux;
            var offset = Math.Min(0.18 * chordLen, 36);

            var p1 = new Point(start.X + dx / 3 + nx * offset, start.Y + dy / 3 + ny * offset);
            var p2 = new Point(start.X + dx * 2 / 3 + nx * offset, start.Y + dy * 2 / 3 + ny * offset);
            var bezier = new[] { start, p1, p2, end };

            const int samples = 16;
            var pts = new Point[samples + 1];
            for (var i = 0; i <= samples; i++)
                pts[i] = BezierAt(bezier, (double)i / samples);

            // Cap directions follow the curve's tangents: outward at the start is the reverse of the
            // forward derivative there, outward at the end is the forward derivative.
            return new LinkRoute(pts, bezier, BezierAt(bezier, 0.5), OutwardDir(p1, start), OutwardDir(p2, end));
        }

        public Geometry GeometryFor(double offset)
        {
            if (_geometryCache.TryGetValue(offset, out var cached))
                return cached;
            var geometry = BuildGeometry(offset);
            _geometryCache[offset] = geometry;
            return geometry;
        }

        private Geometry BuildGeometry(double offset)
        {
            var geometry = new StreamGeometry();
            using (var ctx = geometry.Open())
            {
                if (_bezier is not null)
                {
                    var b = offset == 0 ? _bezier : OffsetBezier(_bezier, offset);
                    ctx.BeginFigure(b[0], isFilled: false);
                    ctx.CubicBezierTo(b[1], b[2], b[3]);
                }
                else
                {
                    var pts = offset == 0 ? _points : OffsetPolyline(_points, offset);
                    ctx.BeginFigure(pts[0], isFilled: false);
                    for (var i = 1; i < pts.Length; i++)
                        ctx.LineTo(pts[i]);
                }
                ctx.EndFigure(isClosed: false);
            }
            return geometry;
        }

        // Shift the whole bezier sideways by offsetting its control points along the chord normal.
        private static Point[] OffsetBezier(Point[] b, double offset)
        {
            var n = Normal(b[0], b[3]);
            return new[] { Shift(b[0], n, offset), Shift(b[1], n, offset), Shift(b[2], n, offset), Shift(b[3], n, offset) };
        }

        // Parallel polyline: shift each vertex along the (averaged, at corners) adjacent segment normal.
        private static Point[] OffsetPolyline(Point[] pts, double offset)
        {
            var result = new Point[pts.Length];
            for (var i = 0; i < pts.Length; i++)
            {
                Point n;
                if (i == 0)
                    n = Normal(pts[0], pts[1]);
                else if (i == pts.Length - 1)
                    n = Normal(pts[^2], pts[^1]);
                else
                {
                    var a = Normal(pts[i - 1], pts[i]);
                    var b = Normal(pts[i], pts[i + 1]);
                    var sx = a.X + b.X;
                    var sy = a.Y + b.Y;
                    var len = Math.Sqrt(sx * sx + sy * sy);
                    n = len < Epsilon ? a : new Point(sx / len, sy / len);
                }
                result[i] = Shift(pts[i], n, offset);
            }
            return result;
        }

        private static Point BezierAt(Point[] c, double t)
        {
            var mt = 1 - t;
            var a = mt * mt * mt;
            var b = 3 * mt * mt * t;
            var cc = 3 * mt * t * t;
            var d = t * t * t;
            return new Point(
                a * c[0].X + b * c[1].X + cc * c[2].X + d * c[3].X,
                a * c[0].Y + b * c[1].Y + cc * c[2].Y + d * c[3].Y);
        }

        private static Point[] Dedupe(Point[] pts)
        {
            var list = new List<Point>(pts.Length);
            foreach (var p in pts)
                if (list.Count == 0 || Distance(list[^1], p) > Epsilon)
                    list.Add(p);
            if (list.Count < 2)
                list.Add(pts[^1]);
            return list.ToArray();
        }

        // Unit vector from a toward b (the direction pointing out of the path at b's end).
        private static Point OutwardDir(Point from, Point to)
        {
            var dx = to.X - from.X;
            var dy = to.Y - from.Y;
            var len = Math.Sqrt(dx * dx + dy * dy);
            return len < Epsilon ? default : new Point(dx / len, dy / len);
        }

        // Unit normal (left of travel) of the segment a -> b.
        private static Point Normal(Point a, Point b)
        {
            var dx = b.X - a.X;
            var dy = b.Y - a.Y;
            var len = Math.Sqrt(dx * dx + dy * dy);
            return len < Epsilon ? default : new Point(-dy / len, dx / len);
        }

        private static Point Shift(Point p, Point n, double d) => new(p.X + n.X * d, p.Y + n.Y * d);

        private static double Distance(Point a, Point b)
        {
            var dx = a.X - b.X;
            var dy = a.Y - b.Y;
            return Math.Sqrt(dx * dx + dy * dy);
        }
    }
}
