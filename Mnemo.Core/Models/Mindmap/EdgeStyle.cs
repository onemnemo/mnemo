namespace Mnemo.Core.Models.Mindmap;

/// <summary>Line rendering style for an edge. Orthogonal to arrow caps.</summary>
public enum LineStyle
{
    Solid,
    Dashed,
    Dotted,
    Double,
}

/// <summary>How an edge is routed between its endpoints.</summary>
public enum EdgeRouting
{
    Curve,
    Straight,
    Orthogonal,
}

/// <summary>An arrow cap at one end of an edge.</summary>
public enum ArrowCap
{
    None,
    Arrow,
    Dot,
}

/// <summary>
/// Per-edge visual overrides. Line style, routing and the two arrow caps are independent properties,
/// so combinations impossible in v1 (e.g. "dashed + bidirectional") are expressible. All null-valued
/// members inherit from the style cascade. <see cref="Color"/> is a theme token or a literal hex.
/// </summary>
public sealed record EdgeStyle
{
    public LineStyle? Line { get; init; }

    public EdgeRouting? Routing { get; init; }

    public ArrowCap? StartCap { get; init; }

    public ArrowCap? EndCap { get; init; }

    /// <summary>A theme token (e.g. <c>stroke</c>, <c>palette.3</c>) or a literal <c>#RRGGBB</c> hex.</summary>
    public string? Color { get; init; }

    public double? Thickness { get; init; }
}
