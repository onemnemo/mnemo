using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

// Content payloads for non-node elements (shapes, free text, canvas images, frames). Same polymorphic
// family as the node contents; grouped for the same reason.

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
}

/// <summary>A geometric shape with optional inline text (<see cref="ElementKind.Shape"/>).</summary>
public sealed record ShapeContent : IElementContent
{
    public ShapeType Shape { get; init; } = ShapeType.Rectangle;

    public string? Text { get; init; }

    public string TypeDiscriminator => ElementContentDiscriminators.Shape;
}

/// <summary>A free-floating text label (<see cref="ElementKind.Text"/>).</summary>
public sealed record FreeTextContent : IElementContent
{
    public string Text { get; init; } = string.Empty;

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
