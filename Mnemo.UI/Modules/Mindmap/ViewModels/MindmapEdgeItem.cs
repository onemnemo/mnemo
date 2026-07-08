using System;
using System.ComponentModel;
using Avalonia;
using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>
/// A rendered edge on the editor canvas. Hierarchy edges are a curved connector between two node centers;
/// link edges are a straight connector clipped to each endpoint's box so an arrow cap can sit on the
/// boundary. The edge holds references to its endpoint items and recomputes its geometry whenever either
/// end moves, so edges follow elements live during a drag without a document round-trip.
/// </summary>
public partial class MindmapEdgeItem : ObservableObject, IDisposable
{
    private readonly MindmapNodeItem _from;
    private readonly MindmapNodeItem _to;
    private bool _disposed;

    public MindmapEdgeItem(
        string id,
        MindmapNodeItem from,
        MindmapNodeItem to,
        bool isHierarchy = true,
        string? colorToken = null,
        ArrowCap startCap = ArrowCap.None,
        ArrowCap endCap = ArrowCap.None,
        LineStyle lineStyle = LineStyle.Solid,
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
        Label = label;
        _from.PropertyChanged += OnEndpointChanged;
        _to.PropertyChanged += OnEndpointChanged;
    }

    public string Id { get; }

    public bool IsHierarchy { get; }

    /// <summary>Whether this edge is the selected one (link edges only); drawn highlighted.</summary>
    [ObservableProperty]
    private bool _isSelected;

    /// <summary>Style token for the line color (a branch palette token or hex), or null to use the default edge brush.</summary>
    public string? ColorToken { get; }

    /// <summary>Arrow caps and line style, resolved from the edge's style (link edges default to a solid line with an end arrow).</summary>
    public ArrowCap StartCap { get; }
    public ArrowCap EndCap { get; }
    public LineStyle LineStyle { get; }

    /// <summary>Optional label drawn at the connector midpoint.</summary>
    public string? Label { get; }

    public Point Start => new(_from.CenterX, _from.CenterY);

    public Point End => new(_to.CenterX, _to.CenterY);

    /// <summary>Line endpoints actually drawn: hierarchy edges run center to center; link edges stop at each box boundary.</summary>
    public Point DrawStart => IsHierarchy ? Start : BoxExit(_from, End);

    public Point DrawEnd => IsHierarchy ? End : BoxExit(_to, Start);

    /// <summary>Midpoint of the drawn connector, where the label sits.</summary>
    public Point Midpoint => new((DrawStart.X + DrawEnd.X) / 2, (DrawStart.Y + DrawEnd.Y) / 2);

    /// <summary>Connector geometry: a horizontal-ease cubic bezier for the tree, a straight segment for links.</summary>
    public Geometry Geometry => BuildGeometry();

    private void OnEndpointChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MindmapNodeItem.CenterX) or nameof(MindmapNodeItem.CenterY))
        {
            OnPropertyChanged(nameof(Start));
            OnPropertyChanged(nameof(End));
            OnPropertyChanged(nameof(Geometry));
        }
    }

    private Geometry BuildGeometry()
    {
        var geometry = new StreamGeometry();
        using (var ctx = geometry.Open())
        {
            if (IsHierarchy)
            {
                var start = Start;
                var end = End;
                var midX = (start.X + end.X) / 2;
                ctx.BeginFigure(start, isFilled: false);
                ctx.CubicBezierTo(new Point(midX, start.Y), new Point(midX, end.Y), end);
            }
            else
            {
                ctx.BeginFigure(DrawStart, isFilled: false);
                ctx.LineTo(DrawEnd);
            }
            ctx.EndFigure(isClosed: false);
        }
        return geometry;
    }

    /// <summary>Point where the ray from a box's center toward <paramref name="toward"/> exits the box.</summary>
    private static Point BoxExit(MindmapNodeItem box, Point toward)
    {
        var cx = box.CenterX;
        var cy = box.CenterY;
        var dx = toward.X - cx;
        var dy = toward.Y - cy;
        if (dx == 0 && dy == 0)
            return new Point(cx, cy);

        var scale = double.PositiveInfinity;
        if (dx != 0)
            scale = Math.Min(scale, box.Width / 2 / Math.Abs(dx));
        if (dy != 0)
            scale = Math.Min(scale, box.Height / 2 / Math.Abs(dy));
        return new Point(cx + dx * scale, cy + dy * scale);
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _from.PropertyChanged -= OnEndpointChanged;
        _to.PropertyChanged -= OnEndpointChanged;
    }
}
