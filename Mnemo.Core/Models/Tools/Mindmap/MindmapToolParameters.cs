using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Mnemo.Core.Models.Tools.Mindmap;

/// <summary>A node in a nested mindmap outline (create / add).</summary>
public sealed class MindmapOutlineNode
{
    [JsonPropertyName("label")] public string Label { get; set; } = string.Empty;
    [JsonPropertyName("color")] public string? Color { get; set; }
    [JsonPropertyName("shape")] public string? Shape { get; set; }
    [JsonPropertyName("children")] public List<MindmapOutlineNode>? Children { get; set; }
}

public sealed class SearchMindmapsParameters
{
    [JsonPropertyName("query")] public string? Query { get; set; }
    [JsonPropertyName("limit")] public int? Limit { get; set; }
    [JsonPropertyName("fuzzy")] public bool? Fuzzy { get; set; }
}

public sealed class MindmapIdParameters
{
    [JsonPropertyName("mindmap_id")] public string MindmapId { get; set; } = string.Empty;
}

public sealed class OutlineMindmapParameters
{
    [JsonPropertyName("mindmap_id")] public string MindmapId { get; set; } = string.Empty;
}

public sealed class ReadMindmapParameters
{
    [JsonPropertyName("mindmap_id")] public string MindmapId { get; set; } = string.Empty;

    /// <summary>Read only this node and its hierarchy descendants.</summary>
    [JsonPropertyName("subtree_of")] public string? SubtreeOf { get; set; }

    /// <summary>Read only these nodes (ids or short-id prefixes).</summary>
    [JsonPropertyName("node_ids")] public List<string>? NodeIds { get; set; }

    /// <summary>Include cross-link edges touching the selected nodes.</summary>
    [JsonPropertyName("include_links")] public bool? IncludeLinks { get; set; }
}

/// <summary>One operation in an <c>edit_mindmap</c> batch.</summary>
public sealed class MindmapEditOp
{
    [JsonPropertyName("op")] public string Op { get; set; } = string.Empty;

    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("ids")] public List<string>? Ids { get; set; }
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("anchor")] public string? Anchor { get; set; }
    [JsonPropertyName("parent")] public string? Parent { get; set; }
    [JsonPropertyName("source")] public string? Source { get; set; }
    [JsonPropertyName("target")] public string? Target { get; set; }
    [JsonPropertyName("edge_id")] public string? EdgeId { get; set; }
    [JsonPropertyName("link_label")] public string? LinkLabel { get; set; }
    [JsonPropertyName("color")] public string? Color { get; set; }
    [JsonPropertyName("shape")] public string? Shape { get; set; }
    [JsonPropertyName("collapsed")] public bool? Collapsed { get; set; }
    [JsonPropertyName("subtree_of")] public string? SubtreeOf { get; set; }
    [JsonPropertyName("include_anchor")] public bool? IncludeAnchor { get; set; }

    /// <summary>For add: nested nodes to insert under anchor (defaults to anchor's child).</summary>
    [JsonPropertyName("nodes")] public List<MindmapOutlineNode>? Nodes { get; set; }
}

public sealed class EditMindmapParameters
{
    [JsonPropertyName("mindmap_id")] public string MindmapId { get; set; } = string.Empty;
    [JsonPropertyName("expected_version")] public string? ExpectedVersion { get; set; }
    [JsonPropertyName("ops")] public List<MindmapEditOp> Ops { get; set; } = [];
}

public sealed class CreateMindmapParameters
{
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;

    /// <summary>Root node label (defaults to title).</summary>
    [JsonPropertyName("root_label")] public string? RootLabel { get; set; }

    /// <summary>Nested tree to build under the root in one call. Auto-layout runs after creation.</summary>
    [JsonPropertyName("outline")] public List<MindmapOutlineNode>? Outline { get; set; }

    /// <summary>Build a mindmap from a note's heading/bullet structure.</summary>
    [JsonPropertyName("from_note_id")] public string? FromNoteId { get; set; }

    [JsonPropertyName("layout_algorithm")] public string? LayoutAlgorithm { get; set; }
}

public sealed class ManageMindmapParameters
{
    [JsonPropertyName("mindmap_id")] public string MindmapId { get; set; } = string.Empty;
    [JsonPropertyName("rename")] public string? Rename { get; set; }
    [JsonPropertyName("layout_algorithm")] public string? LayoutAlgorithm { get; set; }
    [JsonPropertyName("delete")] public bool? Delete { get; set; }
}

public sealed class OpenMindmapParameters
{
    [JsonPropertyName("mindmap_id")] public string MindmapId { get; set; } = string.Empty;
}
