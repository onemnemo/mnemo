namespace Mnemo.Core.Models.MindmapV2;

/// <summary>
/// Spacing overrides for a layout algorithm. Small, template-overridable set; null members use
/// the algorithm's built-in defaults.
/// </summary>
public sealed record LayoutOptions
{
    public double? NodeSpacing { get; init; }

    public double? RankSpacing { get; init; }

    public double? EdgeLength { get; init; }
}

/// <summary>
/// Per-tree preferences, keyed by cluster root id. A cluster (one tree) is derived from hierarchy
/// edges; this record only stores preferences, not structure. Settings for roots that no longer exist
/// are pruned on save.
/// </summary>
public sealed record ClusterSettings
{
    /// <summary>Element id of the cluster's root node.</summary>
    public required string RootId { get; init; }

    /// <summary>Layout algorithm id (open registry; see <see cref="MindmapLayoutAlgorithms"/>).</summary>
    public string LayoutAlgorithm { get; init; } = MindmapLayoutAlgorithms.Balanced;

    public LayoutOptions? Options { get; init; }

    /// <summary>Style template id; null = document default.</summary>
    public string? TemplateId { get; init; }
}
