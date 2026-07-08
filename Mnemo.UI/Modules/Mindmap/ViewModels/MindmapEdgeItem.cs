using System;
using System.ComponentModel;
using Avalonia;
using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>
/// A rendered edge on the editor canvas: a curved connector between two node centers. The edge holds
/// references to its endpoint node items and recomputes its geometry whenever either end moves, so edges
/// follow nodes live during a drag without a document round-trip.
/// </summary>
public partial class MindmapEdgeItem : ObservableObject, IDisposable
{
    private readonly MindmapNodeItem _from;
    private readonly MindmapNodeItem _to;
    private bool _disposed;

    public MindmapEdgeItem(string id, MindmapNodeItem from, MindmapNodeItem to, bool isHierarchy = true, string? colorToken = null)
    {
        Id = id;
        _from = from;
        _to = to;
        IsHierarchy = isHierarchy;
        ColorToken = colorToken;
        _from.PropertyChanged += OnEndpointChanged;
        _to.PropertyChanged += OnEndpointChanged;
    }

    public string Id { get; }

    public bool IsHierarchy { get; }

    /// <summary>Style token for the line color (a branch palette token), or null to use the default edge brush.</summary>
    public string? ColorToken { get; }

    public Point Start => new(_from.CenterX, _from.CenterY);

    public Point End => new(_to.CenterX, _to.CenterY);

    /// <summary>Cubic bezier connector with a horizontal ease out of the source and into the target.</summary>
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
        var start = Start;
        var end = End;
        var midX = (start.X + end.X) / 2;
        var control1 = new Point(midX, start.Y);
        var control2 = new Point(midX, end.Y);

        var geometry = new StreamGeometry();
        using (var ctx = geometry.Open())
        {
            ctx.BeginFigure(start, isFilled: false);
            ctx.CubicBezierTo(control1, control2, end);
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
}
