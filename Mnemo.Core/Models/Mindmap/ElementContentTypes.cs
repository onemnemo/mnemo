using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>A geometric primitive.</summary>
public enum ShapeType
{
    Rectangle,
    Ellipse,
    Diamond,
    Hexagon,
    Parallelogram,
    Line,
    Arrow,
    Blob,
}

/// <summary>A geometric shape with optional inline text (<see cref="ElementKind.Shape"/>).</summary>
public sealed record ShapeContent : IElementContent
{
    public ShapeType Shape { get; init; } = ShapeType.Rectangle;

    public string? Text { get; init; }

    /// <summary>Formatted label; see <see cref="TextContent.Runs"/>.</summary>
    public IReadOnlyList<InlineSpan>? Runs { get; init; }

    /// <summary>Degrees clockwise about the box centre. Read for the closed shapes only.</summary>
    public double Rotation { get; init; }

    /// <summary>Where a line or arrow runs. Null on an older row reads as the box's diagonal.</summary>
    public LineGeometry? Line { get; init; }

    /// <summary>Null means what the shape implies: nothing on a line, nothing at an arrow's start.</summary>
    public ArrowCap? StartCap { get; init; }

    /// <summary>Null means what the shape implies: nothing on a line, a head on an arrow.</summary>
    public ArrowCap? EndCap { get; init; }

    /// <summary>Stroke weight of a line or arrow. Null is the outline weight every shape draws at.</summary>
    public double? Thickness { get; init; }

    public string TypeDiscriminator => ElementContentDiscriminators.Shape;
}

/// <summary>A point relative to the element's origin.</summary>
/// <remarks>
/// This must remain a reference type because the sparse serializer drops default-valued structs.
/// </remarks>
public sealed record CanvasPoint(double X, double Y);

public enum AnchorSide
{
    Top,
    Right,
    Bottom,
    Left,
}

public sealed record LineAttachment
{
    /// <summary>Target element id. Invalid stored ids are detached during normalization.</summary>
    public string ElementId { get; init; } = string.Empty;

    public AnchorSide Side { get; init; }
}

/// <summary>Line or arrow points relative to the element's origin.</summary>
public sealed record LineGeometry
{
    public CanvasPoint? Start { get; init; }

    public CanvasPoint? End { get; init; }

    /// <summary>The control point of a quadratic curve. Null is a straight line.</summary>
    public CanvasPoint? Bend { get; init; }

    public LineAttachment? StartAt { get; init; }

    public LineAttachment? EndAt { get; init; }
}

/// <summary>A free-floating text label (<see cref="ElementKind.Text"/>).</summary>
public sealed record FreeTextContent : IElementContent
{
    public string Text { get; init; } = string.Empty;

    /// <summary>Formatted label; see <see cref="TextContent.Runs"/>.</summary>
    public IReadOnlyList<InlineSpan>? Runs { get; init; }

    public string TypeDiscriminator => ElementContentDiscriminators.FreeText;
}

/// <summary>A decorative canvas image (<see cref="ElementKind.Image"/>). Stored via the asset service.</summary>
public sealed record CanvasImageContent : IElementContent
{
    public required string AssetId { get; init; }

    public string TypeDiscriminator => ElementContentDiscriminators.CanvasImage;
}

/// <summary>
/// A named container (<see cref="ElementKind.Frame"/>). Membership is explicit via <see cref="ChildIds"/>,
/// not geometry-derived. Frames may not contain frames in v2.
/// </summary>
public sealed record FrameContent : IElementContent
{
    public string Title { get; init; } = string.Empty;

    public IReadOnlyList<string> ChildIds { get; init; } = Array.Empty<string>();

    public string TypeDiscriminator => ElementContentDiscriminators.Frame;
}
