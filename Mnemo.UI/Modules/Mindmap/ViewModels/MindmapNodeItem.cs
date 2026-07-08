using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>
/// A single node as rendered on the editor canvas (schema v2). A lightweight view projection of a
/// <c>MindmapElement</c> of kind Node — position, size, label and selection state — kept separate from
/// the immutable document model so the canvas can bind and update it without touching storage.
/// </summary>
public partial class MindmapNodeItem : ObservableObject
{
    /// <summary>Fallback node box size when an element has no explicit width/height (auto-size).</summary>
    public const double DefaultWidth = 132;
    public const double DefaultHeight = 40;

    /// <summary>Pin badge geometry (top-right corner): draw radius, inset from the corner, and click radius.</summary>
    public const double PinBadgeRadius = 4.5;
    public const double PinBadgeInset = 9;
    public const double PinBadgeHitRadius = 11;

    public required string Id { get; init; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CenterX))]
    private double _x;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CenterY))]
    private double _y;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CenterX))]
    private double _width = DefaultWidth;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CenterY))]
    private double _height = DefaultHeight;

    [ObservableProperty]
    private string _text = string.Empty;

    [ObservableProperty]
    private bool _isRoot;

    [ObservableProperty]
    private bool _isSelected;

    /// <summary>Pinned nodes are excluded from auto-layout; shown with a small badge you can click to release.</summary>
    [ObservableProperty]
    private bool _isPinned;

    // --- Resolved style: filled from the style cascade when the document is projected. Color members
    // are theme token references the canvas maps to brushes. ---

    [ObservableProperty]
    private string _fillToken = MindmapStyleTokens.Surface;

    [ObservableProperty]
    private string _strokeToken = MindmapStyleTokens.Stroke;

    [ObservableProperty]
    private string _textToken = MindmapStyleTokens.TextPrimary;

    [ObservableProperty]
    private NodeShape _shape = NodeShape.Card;

    [ObservableProperty]
    private FontScale _fontScale = FontScale.M;

    /// <summary>Center X in canvas coordinates (edge endpoints attach here).</summary>
    public double CenterX => X + Width / 2;

    /// <summary>Center Y in canvas coordinates.</summary>
    public double CenterY => Y + Height / 2;
}
