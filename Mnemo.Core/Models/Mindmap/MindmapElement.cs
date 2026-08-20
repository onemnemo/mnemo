using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>The kind of a <see cref="MindmapElement"/>. Closed set. New kinds are a schema change.</summary>
public enum ElementKind
{
    /// <summary>A mindmap tree node (card with typed content); participates in the hierarchy.</summary>
    Node,

    /// <summary>A geometric primitive with optional inline text; never in the tree, never auto-laid.</summary>
    Shape,

    /// <summary>A free-floating text label.</summary>
    Text,

    /// <summary>Decorative canvas image (asset reference).</summary>
    Image,

    /// <summary>A named container grouping elements that move together.</summary>
    Frame,
}

/// <summary>
/// A single element on the canvas. One model covers every kind; the polymorphic
/// <see cref="Content"/> carries the kind-specific payload. Immutable, commands replace instances
/// rather than mutate, which keeps the invariant boundary real and command inversion trivial.
/// </summary>
public sealed record MindmapElement
{
    /// <summary>Document-local short id (4-char base-36).</summary>
    public required string Id { get; init; }

    public ElementKind Kind { get; init; }

    public required IElementContent Content { get; init; }

    /// <summary>Top-left X in canvas coordinates.</summary>
    public double X { get; init; }

    /// <summary>Top-left Y in canvas coordinates.</summary>
    public double Y { get; init; }

    /// <summary>Null = auto-size to content.</summary>
    public double? Width { get; init; }

    /// <summary>Null = auto-size to content.</summary>
    public double? Height { get; init; }

    /// <summary>Excluded from auto-layout. Meaningful for <see cref="ElementKind.Node"/>; free kinds are implicitly pinned.</summary>
    public bool Pinned { get; init; }

    /// <summary>Node: hide descendants. Frame: minimize.</summary>
    public bool Collapsed { get; init; }

    /// <summary>Per-element style overrides only; null = fully inherited from the style cascade.</summary>
    public ElementStyle? Style { get; init; }

    /// <summary>
    /// Round-trip escape hatch for foreign/plugin data. Keys are namespaced (<c>plugin.key</c>), values
    /// are small strings; core code never reads this. Any field the core needs graduates to a real
    /// schema property.
    /// </summary>
    public IReadOnlyDictionary<string, string>? Meta { get; init; }
}
