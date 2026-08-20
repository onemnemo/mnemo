using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>
/// A single canvas element as rendered in the editor (schema v2). A lightweight view projection of a
/// <c>MindmapElement</c> (position, size, label, style and selection state), kept separate from the
/// immutable document model so the canvas can bind and update it without touching storage. Covers tree
/// nodes and the free kinds (text, shapes, frames); <see cref="Kind"/> tells the canvas how to draw it.
/// </summary>
public partial class MindmapNodeItem : ObservableObject
{
    /// <summary>Fallback node box size when an element has no explicit width/height (auto-size).</summary>
    public const double DefaultWidth = 132;
    public const double DefaultHeight = 40;

    /// <summary>Default box for a newly placed free shape and free text label.</summary>
    public const double ShapeDefaultWidth = 132;
    public const double ShapeDefaultHeight = 76;
    public const double TextDefaultWidth = 140;
    public const double TextDefaultHeight = 36;

    /// <summary>Default box for a newly placed frame: a roomy container you drop other elements into.</summary>
    public const double FrameDefaultWidth = 320;
    public const double FrameDefaultHeight = 220;

    /// <summary>Height of a frame's title strip; the label sits here and members start below it.</summary>
    public const double FrameTitleHeight = 26;

    /// <summary>Pin badge geometry (top-right corner): draw radius, inset from the corner, and click radius.</summary>
    public const double PinBadgeRadius = 4.5;
    public const double PinBadgeInset = 9;
    public const double PinBadgeHitRadius = 11;

    /// <summary>Task node checkbox geometry (left, vertically centered): box size, left inset, and text gap.</summary>
    public const double TaskCheckboxSize = 15;
    public const double TaskCheckboxInset = 11;
    public const double TaskTextGap = 8;

    /// <summary>Reference node kind-glyph geometry (left, vertically centered): draw size, left inset, and text gap.</summary>
    public const double RefGlyphSize = 14;
    public const double RefGlyphInset = 11;
    public const double RefTextGap = 8;

    /// <summary>Resize handle (bottom-right corner of a selected free element/frame): draw size and click pad.</summary>
    public const double ResizeHandleSize = 10;
    public const double ResizeHandleHitPad = 5;

    /// <summary>Inner padding around a code node's snippet text and its language chip.</summary>
    public const double CodePadding = 8;

    public required string Id { get; init; }

    /// <summary>The element kind this item projects. Free kinds (Text/Shape) draw differently and skip the tree and auto-layout.</summary>
    public ElementKind Kind { get; init; } = ElementKind.Node;

    /// <summary>Geometry for a free <see cref="ElementKind.Shape"/> element; null for nodes and text.</summary>
    public ShapeType? FreeShape { get; init; }

    /// <summary>Absolute path to a resolved <see cref="ElementKind.Image"/> asset; null for every other kind.</summary>
    public string? AssetPath { get; init; }

    /// <summary>The node content's type discriminator (text/task/code/math/...); drives kind-specific drawing.</summary>
    public string ContentType { get; init; } = ElementContentDiscriminators.Text;

    /// <summary>A code node's language label, drawn as a small chip; null/empty for every other content type.</summary>
    public string? CodeLanguage { get; init; }

    /// <summary>Whether a task node is checked off; drawn as a filled checkbox with a strikethrough label.</summary>
    [ObservableProperty]
    private bool _isTaskDone;

    /// <summary>True when a note/flashcard ref can't be resolved (deleted target); drawn as a muted "missing" label.</summary>
    [ObservableProperty]
    private bool _isRefMissing;

    /// <summary>Small trailing chip for a resolved ref (e.g. a deck's due count); null when there's nothing to show.</summary>
    [ObservableProperty]
    private string? _refBadge;

    /// <summary>Explicit member ids for a <see cref="ElementKind.Frame"/>; empty for every other kind. Used to drag the group together.</summary>
    public System.Collections.Generic.IReadOnlyList<string> MemberIds { get; init; } =
        System.Array.Empty<string>();

    /// <summary>True for free (non-node) elements: fixed position, no hierarchy, no auto-layout.</summary>
    public bool IsFree => Kind is not ElementKind.Node;

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

    /// <summary>True while this element's label is being edited inline; the canvas suppresses its own drawn label so the overlay editor isn't doubled underneath.</summary>
    [ObservableProperty]
    private bool _isEditing;

    /// <summary>Pinned nodes are excluded from auto-layout; shown with a small badge you can click to release.</summary>
    [ObservableProperty]
    private bool _isPinned;

    /// <summary>Whether this node's descendants are hidden. Reflected in the toolbar's collapse toggle.</summary>
    [ObservableProperty]
    private bool _isCollapsed;

    /// <summary>Whether the node carries its own style override. Gates the subtree/clear toolbar actions, which are inert without one.</summary>
    [ObservableProperty]
    private bool _hasStyleOverride;

    // Resolved style, filled from the cascade when the document is projected; color members are theme
    // token references the canvas maps to brushes.

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

    /// <summary>
    /// The box height for an element: its explicit stored height if set, otherwise a content-derived default.
    /// Multi-line code grows to fit its lines (capped) so a snippet isn't crushed into the one-line node box.
    /// Shared by the canvas projection and the layout snapshot so drawn size and layout spacing agree.
    /// </summary>
    public static double HeightFor(MindmapElement element)
    {
        if (element.Height is { } stored)
            return stored;

        if (element.Content is CodeContent { Source.Length: > 0 } code)
        {
            var lineCount = code.Source.Split('\n').Length;
            if (lineCount > 1)
            {
                // Fixed at the M font scale; the element's resolved scale isn't known here, an accepted tradeoff.
                const double lineHeight = 13 * 1.45;
                var lines = System.Math.Clamp(lineCount, 1, 8);
                return System.Math.Max(DefaultHeight, lines * lineHeight + 2 * CodePadding);
            }
        }

        return DefaultHeight;
    }
}
