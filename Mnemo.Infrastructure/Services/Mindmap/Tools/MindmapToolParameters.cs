using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Mnemo.Infrastructure.Services.Mindmap.Tools;

/// <summary>Parameters for <c>search_mindmaps</c>: find maps by title, or list them.</summary>
public sealed class SearchMindmapsParameters
{
    /// <summary>Title keywords (substring or in-order fuzzy). Omit to list maps newest-first.</summary>
    [JsonPropertyName("query")] public string? Query { get; set; }

    /// <summary>Max results (default 20, max 100).</summary>
    [JsonPropertyName("limit")] public int? Limit { get; set; }
}

/// <summary>One node in a <c>create_mindmap</c> outline: text plus nested children.</summary>
public sealed class MindmapOutlineNode
{
    /// <summary>Node text.</summary>
    [JsonPropertyName("t")] public string? Text { get; set; }

    /// <summary>Child nodes.</summary>
    [JsonPropertyName("c")] public List<MindmapOutlineNode>? Children { get; set; }
}

/// <summary>Parameters for <c>create_mindmap</c>: build a whole map from a nested outline in one call.</summary>
public sealed class CreateMindmapParameters
{
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;

    /// <summary>Nested <c>{t, c[]}</c> tree seeded under the map (each top-level node becomes a cluster root).</summary>
    [JsonPropertyName("outline")] public List<MindmapOutlineNode>? Outline { get; set; }

    /// <summary>Layout algorithm id applied to every seeded cluster (balanced, treeRight, treeDown, radial, timeline, free).</summary>
    [JsonPropertyName("layout")] public string? Layout { get; set; }

    /// <summary>Default style template id for the document.</summary>
    [JsonPropertyName("template")] public string? Template { get; set; }
}

/// <summary>Parameters for <c>outline_mindmap</c>: a compact tree of a map (or one subtree).</summary>
public sealed class OutlineMindmapParameters
{
    [JsonPropertyName("map_id")] public string MapId { get; set; } = string.Empty;

    /// <summary>Scope the outline to this node's subtree instead of the whole map.</summary>
    [JsonPropertyName("subtree_of")] public string? SubtreeOf { get; set; }

    /// <summary>How many levels to expand; deeper (or collapsed) subtrees report a hidden count as <c>+n</c>.</summary>
    [JsonPropertyName("depth")] public int? Depth { get; set; }
}

/// <summary>Parameters for <c>find_in_map</c>: full-text search within one map.</summary>
public sealed class FindInMapParameters
{
    [JsonPropertyName("map_id")] public string MapId { get; set; } = string.Empty;

    [JsonPropertyName("query")] public string Query { get; set; } = string.Empty;

    /// <summary>Max hits (default 20, max 100).</summary>
    [JsonPropertyName("limit")] public int? Limit { get; set; }
}

/// <summary>Parameters for <c>read_elements</c>: full detail for selected elements.</summary>
public sealed class ReadElementsParameters
{
    [JsonPropertyName("map_id")] public string MapId { get; set; } = string.Empty;

    /// <summary>Read exactly these element ids (max 100).</summary>
    [JsonPropertyName("ids")] public List<string>? Ids { get; set; }

    /// <summary>Read a node and its whole subtree.</summary>
    [JsonPropertyName("subtree_of")] public string? SubtreeOf { get; set; }

    /// <summary>Read only elements of these kinds (node, shape, text, image, frame).</summary>
    [JsonPropertyName("kinds")] public List<string>? Kinds { get; set; }
}

/// <summary>Parameters for <c>edit_mindmap</c>: an atomic op batch. <see cref="Ops"/> is parsed by the op parser.</summary>
public sealed class EditMindmapParameters
{
    [JsonPropertyName("map_id")] public string MapId { get; set; } = string.Empty;

    /// <summary>The revision the ops were composed against (from outline/find/read).</summary>
    [JsonPropertyName("rev")] public long Rev { get; set; }

    /// <summary>The raw ops array; each op is <c>{op: "...", ...}</c>. Parsed and validated before the service is touched.</summary>
    [JsonPropertyName("ops")] public JsonElement Ops { get; set; }
}
