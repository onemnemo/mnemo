using Avalonia.Media;
using Mnemo.UI.Modules.Mindmap.Services;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

public class NodePreviewViewModel
{
    public double X { get; set; }
    public double Y { get; set; }

    /// <summary>Diameter of the node dot (root nodes render larger).</summary>
    public double Size { get; set; } = 8;

    /// <summary>Margin that recenters the dot on its <see cref="X"/>/<see cref="Y"/> point.</summary>
    public Avalonia.Thickness CenterMargin => new(-Size / 2, -Size / 2, 0, 0);

    /// <summary>Fill for the node dot; defaults to the primary branch tone.</summary>
    public IBrush Fill { get; set; } = MindmapPreviewPalette.Root;
}
