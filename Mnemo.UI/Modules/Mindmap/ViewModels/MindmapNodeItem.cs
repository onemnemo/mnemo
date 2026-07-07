using CommunityToolkit.Mvvm.ComponentModel;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>
/// A single node as rendered on the editor canvas (schema v2). A lightweight view projection of a
/// <c>MindmapElement</c> of kind Node — position, size, label and selection state — kept separate from
/// the immutable document model so the canvas can bind and update it without touching storage.
/// </summary>
public partial class MindmapNodeItem : ObservableObject
{
    public required string Id { get; init; }

    [ObservableProperty]
    private double _x;

    [ObservableProperty]
    private double _y;

    [ObservableProperty]
    private double _width = 132;

    [ObservableProperty]
    private double _height = 40;

    [ObservableProperty]
    private string _text = string.Empty;

    [ObservableProperty]
    private bool _isRoot;

    [ObservableProperty]
    private bool _isSelected;

    /// <summary>Center X in canvas coordinates (edge endpoints attach here).</summary>
    public double CenterX => X + Width / 2;

    /// <summary>Center Y in canvas coordinates.</summary>
    public double CenterY => Y + Height / 2;
}
