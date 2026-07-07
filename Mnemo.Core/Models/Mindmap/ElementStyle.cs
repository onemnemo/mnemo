namespace Mnemo.Core.Models.Mindmap;

/// <summary>Font size step. Maps to typography tokens, no free-point sizes.</summary>
public enum FontScale
{
    S,
    M,
    L,
    XL,
}

/// <summary>The visual shape of a node card.</summary>
public enum NodeShape
{
    Card,
    Pill,
    Plain,
    Outline,
}

/// <summary>
/// Per-element style overrides. Every member is nullable: a null means "inherit" and resolution walks
/// the cascade element → template rule → cluster template → document default → theme. Color
/// members are token references, never raw hex.
/// </summary>
public sealed record ElementStyle
{
    /// <summary>Fill color token reference.</summary>
    public string? Fill { get; init; }

    /// <summary>Stroke color token reference.</summary>
    public string? Stroke { get; init; }

    /// <summary>Text color token reference.</summary>
    public string? TextColor { get; init; }

    public FontScale? FontScale { get; init; }

    public NodeShape? NodeShape { get; init; }

    /// <summary>AppIcon name shown before the label.</summary>
    public string? Icon { get; init; }
}
