using Avalonia;
using CommunityToolkit.Mvvm.ComponentModel;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>A rendered edge on the editor canvas: a curved connector between two node centers.</summary>
public partial class MindmapEdgeItem : ObservableObject
{
    public required string Id { get; init; }

    [ObservableProperty]
    private Point _start;

    [ObservableProperty]
    private Point _end;

    [ObservableProperty]
    private bool _isHierarchy = true;

    /// <summary>Cubic bezier control point 1 (horizontal ease out of the source).</summary>
    public Point Control1 => new((Start.X + End.X) / 2, Start.Y);

    /// <summary>Cubic bezier control point 2 (horizontal ease into the target).</summary>
    public Point Control2 => new((Start.X + End.X) / 2, End.Y);
}
