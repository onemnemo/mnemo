using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>How a template colors depth-1 branches.</summary>
public enum BranchColorMode
{
    /// <summary>No automatic branch coloring; nodes use template/theme colors.</summary>
    None,

    /// <summary>Each depth-1 branch takes a palette color (<c>palette.N</c>), inherited by its descendants.</summary>
    ByBranch,
}

/// <summary>
/// A depth-band styling rule inside a <see cref="StyleTemplate"/>. Applies to hierarchy nodes whose depth
/// falls in [<see cref="MinDepth"/>, <see cref="MaxDepth"/>] (root is depth 0). Rules are evaluated in
/// list order; the first match wins.
/// </summary>
public sealed record DepthRule
{
    /// <summary>Inclusive lower bound (root = 0).</summary>
    public int MinDepth { get; init; }

    /// <summary>Inclusive upper bound; null = open-ended (this depth and deeper).</summary>
    public int? MaxDepth { get; init; }

    /// <summary>Style applied to nodes in this band; null members inherit further down the cascade.</summary>
    public required ElementStyle Style { get; init; }
}

/// <summary>
/// A named set of styling rules — the primary way a map gets its look. A template contributes
/// defaults to the style cascade; per-element overrides always sit above it and survive template switches.
/// Stored globally and referenced by id; a <c>.mnemo</c> export embeds a snapshot of referenced templates
/// so maps stay portable.
/// </summary>
public sealed record StyleTemplate
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    /// <summary>Style for the cluster root (depth 0).</summary>
    public ElementStyle? RootStyle { get; init; }

    /// <summary>Depth-band rules for non-root nodes, evaluated in order (first match wins).</summary>
    public IReadOnlyList<DepthRule> DepthRules { get; init; } = Array.Empty<DepthRule>();

    public BranchColorMode BranchColors { get; init; } = BranchColorMode.None;

    /// <summary>Default edge visuals for the map.</summary>
    public EdgeStyle? EdgeDefaults { get; init; }

    /// <summary>Default layout spacing the template prefers.</summary>
    public LayoutOptions? LayoutDefaults { get; init; }
}
