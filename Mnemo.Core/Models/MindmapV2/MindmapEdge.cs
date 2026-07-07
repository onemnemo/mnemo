namespace Mnemo.Core.Models.MindmapV2;

/// <summary>Edge role. Closed set.</summary>
public enum EdgeKind
{
    /// <summary>Tree edge. Forms a forest (each node has at most one hierarchy parent); connects nodes only.</summary>
    Hierarchy,

    /// <summary>Free connector between any two elements (whiteboard connectors are link edges with arrow caps).</summary>
    Link,
}

/// <summary>
/// A directed edge between two elements. Hierarchy edges form the tree; link edges are free-form and
/// may join any element to any element. Immutable; commands replace instances.
/// </summary>
public sealed record MindmapEdge
{
    /// <summary>Document-local short id.</summary>
    public required string Id { get; init; }

    /// <summary>Source element id (the parent, for hierarchy edges).</summary>
    public required string FromId { get; init; }

    /// <summary>Target element id.</summary>
    public required string ToId { get; init; }

    public EdgeKind Kind { get; init; }

    public string? Label { get; init; }

    /// <summary>Per-edge style overrides only; null = inherited.</summary>
    public EdgeStyle? Style { get; init; }
}
