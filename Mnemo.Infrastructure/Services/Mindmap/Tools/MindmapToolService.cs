using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Mindmap.Tools;

/// <summary>
/// Agent-facing tools for the schema-v2 Mindmap module, registered via <see cref="Mnemo.Infrastructure.Services.Tools.MindmapToolRegistrar"/>.
/// </summary>
/// <remarks>
/// The loop is search → outline/find → read → edit: <c>outline_mindmap</c> or <c>find_in_map</c> to locate
/// a branch cheaply (both return the <c>rev</c>), <c>read_elements</c> to pull only the elements that matter,
/// then <c>edit_mindmap</c> to apply an atomic op batch carrying that rev. Every projection is the compact
/// wire form: short ids, one-letter keys, empty/default fields dropped, never the storage shape.
/// Depends only on <see cref="IMindmapService"/>; it holds no store or UI reference (none of these navigate).
/// </remarks>
public sealed class MindmapToolService
{
    private const int ReadCap = 100;
    private const int WarningCap = 5;

    private readonly IMindmapService _mindmaps;
    private readonly IMindmapIntegrityService? _integrity;

    /// <param name="integrity">
    /// Optional integrity sweep; when supplied, <c>outline_mindmap</c> appends dangling-reference warnings.
    /// A null sweep (or a failing one) simply omits warnings — the outline never fails on it.
    /// </param>
    public MindmapToolService(IMindmapService mindmaps, IMindmapIntegrityService? integrity = null)
    {
        _mindmaps = mindmaps;
        _integrity = integrity;
    }

    // ---------------------------------------------------------------- discovery

    public async Task<ToolInvocationResult> SearchMindmapsAsync(SearchMindmapsParameters p)
    {
        var listed = await _mindmaps.ListAsync().ConfigureAwait(false);
        if (!listed.IsSuccess || listed.Value is null)
            return ToolInvocationResult.Failure(ToolResultCodes.InternalError, listed.ErrorMessage ?? "Failed to list mindmaps.");

        var limit = p.Limit is > 0 and <= 100 ? p.Limit!.Value : 20;
        IEnumerable<MindmapDocumentSummary> maps = listed.Value;

        if (!string.IsNullOrWhiteSpace(p.Query))
        {
            var query = p.Query.Trim();
            maps = maps.Where(m => TitleMatches(m.Title, query));
        }

        var results = maps
            .OrderByDescending(m => m.ModifiedAt)
            .Take(limit)
            .Select(m => new { id = m.Id, title = m.Title, rev = m.Revision, modified = m.ModifiedAt })
            .ToList();

        return ToolInvocationResult.Success($"{results.Count} mindmap(s).", new { maps = results });
    }

    // ---------------------------------------------------------------- create

    public async Task<ToolInvocationResult> CreateMindmapAsync(CreateMindmapParameters p)
    {
        if (string.IsNullOrWhiteSpace(p.Title))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "title is required.");

        IReadOnlyList<MindmapNodeSpec>? outline = null;
        if (p.Outline is { Count: > 0 })
            outline = p.Outline.Select(ToNodeSpec).ToList();

        var layout = Trimmed(p.Layout);
        var template = Trimmed(p.Template);

        var created = await _mindmaps.CreateAsync(p.Title.Trim(), outline, layout, template).ConfigureAwait(false);
        if (!created.IsSuccess || created.Value is null)
            return ToolInvocationResult.Failure(ToolResultCodes.InternalError, created.ErrorMessage ?? "Failed to create mindmap.");

        var doc = created.Value;
        return ToolInvocationResult.Success($"Mindmap created (id: {doc.Id}).", new
        {
            id = doc.Id,
            rev = doc.Revision,
            node_count = doc.Elements.Count(e => e.Kind == ElementKind.Node),
        });
    }

    // ---------------------------------------------------------------- outline

    public async Task<ToolInvocationResult> OutlineMindmapAsync(OutlineMindmapParameters p)
    {
        var (doc, error) = await LoadAsync(p.MapId).ConfigureAwait(false);
        if (error != null) return error;

        var byId = doc!.Elements.ToDictionary(e => e.Id);
        var childrenOf = new Dictionary<string, List<string>>();
        var hasParent = new HashSet<string>();
        foreach (var edge in doc.Edges.Where(e => e.Kind == EdgeKind.Hierarchy))
        {
            if (!childrenOf.TryGetValue(edge.FromId, out var list))
                childrenOf[edge.FromId] = list = new List<string>();
            list.Add(edge.ToId);
            hasParent.Add(edge.ToId);
        }

        List<string> roots;
        if (!string.IsNullOrWhiteSpace(p.SubtreeOf))
        {
            var anchor = p.SubtreeOf.Trim();
            if (!byId.TryGetValue(anchor, out var anchorEl) || anchorEl.Kind != ElementKind.Node)
                return NotFoundElement(doc, anchor);
            roots = new List<string> { anchor };
        }
        else
        {
            roots = doc.Elements
                .Where(e => e.Kind == ElementKind.Node && !hasParent.Contains(e.Id))
                .Select(e => e.Id)
                .ToList();
        }

        var depthLimit = p.Depth is > 0 ? p.Depth!.Value : int.MaxValue;
        var trees = roots.Select(r => BuildOutlineNode(r, byId, childrenOf, depthLimit, 1)).ToList();

        var free = doc.Elements
            .Where(e => e.Kind != ElementKind.Node)
            .Select(FreeElementSummary)
            .ToList();

        var result = new Dictionary<string, object?>
        {
            ["map_id"] = doc.Id,
            ["rev"] = doc.Revision,
            ["layout"] = DocumentLayout(doc, roots),
            ["nodes"] = doc.Elements.Count(e => e.Kind == ElementKind.Node),
            ["edges"] = doc.Edges.Count,
            ["roots"] = trees,
        };
        if (free.Count > 0)
            result["free"] = free;

        var warnings = await BuildIntegrityWarningsAsync(doc.Id).ConfigureAwait(false);
        if (warnings is { Count: > 0 })
            result["warnings"] = warnings;

        return ToolInvocationResult.Success("Outline.", result);
    }

    /// <summary>
    /// Runs an integrity sweep and projects its issues to compact, agent-facing warning strings, capped at
    /// <see cref="WarningCap"/> with a "+n more" tail. Returns null when there is no sweep, the sweep fails,
    /// or the map is clean, so the outline stays fast and never fails on integrity.
    /// </summary>
    private async Task<IReadOnlyList<string>?> BuildIntegrityWarningsAsync(string mapId)
    {
        if (_integrity is null)
            return null;

        var sweep = await _integrity.SweepAsync(mapId).ConfigureAwait(false);
        if (!sweep.IsSuccess || sweep.Value is null || sweep.Value.Issues.Count == 0)
            return null;

        var issues = sweep.Value.Issues;
        var warnings = new List<string>(Math.Min(issues.Count, WarningCap) + 1);
        for (var i = 0; i < issues.Count && i < WarningCap; i++)
            warnings.Add(FormatIssue(issues[i]));
        if (issues.Count > WarningCap)
            warnings.Add($"+{issues.Count - WarningCap} more");

        return warnings;
    }

    private static string FormatIssue(MindmapIntegrityIssue issue)
    {
        var label = issue.Kind switch
        {
            MindmapIntegrityIssueKind.MissingNote => "dangling note ref",
            MindmapIntegrityIssueKind.MissingDeck => "dangling deck ref",
            MindmapIntegrityIssueKind.MissingImageAsset => "missing image asset",
            _ => "dangling ref",
        };
        return $"{label} on {issue.ElementId} ({issue.TargetId})";
    }

    // ---------------------------------------------------------------- find

    public async Task<ToolInvocationResult> FindInMapAsync(FindInMapParameters p)
    {
        if (string.IsNullOrWhiteSpace(p.MapId))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "map_id is required.");

        var limit = p.Limit is > 0 and <= 100 ? p.Limit!.Value : 20;
        var found = await _mindmaps.FindInMapAsync(p.MapId.Trim(), p.Query ?? string.Empty, limit).ConfigureAwait(false);
        if (!found.IsSuccess || found.Value is null)
            return ToolInvocationResult.Failure(ToolResultCodes.NotFound, found.ErrorMessage ?? "Mindmap not found.");

        var value = found.Value;
        var hits = value.Hits.Select(h =>
        {
            var hit = new Dictionary<string, object?> { ["i"] = h.ElementId, ["t"] = h.Text };
            if (!string.IsNullOrEmpty(h.Path))
                hit["path"] = h.Path;
            return hit;
        }).ToList();

        return ToolInvocationResult.Success($"{hits.Count} hit(s).", new { rev = value.Revision, hits });
    }

    // ---------------------------------------------------------------- read

    public async Task<ToolInvocationResult> ReadElementsAsync(ReadElementsParameters p)
    {
        var (doc, error) = await LoadAsync(p.MapId).ConfigureAwait(false);
        if (error != null) return error;

        var byId = doc!.Elements.ToDictionary(e => e.Id);
        var selected = new List<MindmapElement>();
        var unresolved = new List<string>();

        if (p.Ids is { Count: > 0 })
        {
            if (p.Ids.Count > ReadCap)
                return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, $"Too many ids ({p.Ids.Count}); read at most {ReadCap} at once.");
            foreach (var raw in p.Ids)
            {
                if (byId.TryGetValue(raw, out var element))
                    selected.Add(element);
                else
                    unresolved.Add(raw);
            }
        }
        else if (!string.IsNullOrWhiteSpace(p.SubtreeOf))
        {
            var anchor = p.SubtreeOf.Trim();
            if (!byId.TryGetValue(anchor, out var anchorEl) || anchorEl.Kind != ElementKind.Node)
                return NotFoundElement(doc, anchor);
            var subtree = MindmapGraph.CollectSubtree(doc.Edges, anchor);
            selected.AddRange(doc.Elements.Where(e => subtree.Contains(e.Id)));
        }
        else if (p.Kinds is { Count: > 0 })
        {
            var kinds = new HashSet<ElementKind>();
            foreach (var raw in p.Kinds)
            {
                if (!Enum.TryParse<ElementKind>(raw, ignoreCase: true, out var kind))
                    return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, $"unknown kind \"{raw}\".");
                kinds.Add(kind);
            }

            selected.AddRange(doc.Elements.Where(e => kinds.Contains(e.Kind)));
        }
        else
        {
            selected.AddRange(doc.Elements);
        }

        if (selected.Count > ReadCap)
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError,
                $"Selection has {selected.Count} elements (cap {ReadCap}); narrow with ids, subtree_of, or outline+depth first.");

        var selectedIds = selected.Select(e => e.Id).ToHashSet();
        var edges = doc.Edges
            .Where(e => selectedIds.Contains(e.FromId) || selectedIds.Contains(e.ToId))
            .Select(EdgeToWire)
            .ToList();

        return ToolInvocationResult.Success($"{selected.Count} element(s).", new
        {
            map_id = doc.Id,
            rev = doc.Revision,
            elements = selected.Select(ElementToWire).ToList(),
            edges = edges.Count > 0 ? edges : null,
            unresolved = unresolved.Count > 0 ? unresolved : null,
        });
    }

    // ---------------------------------------------------------------- edit

    public async Task<ToolInvocationResult> EditMindmapAsync(EditMindmapParameters p)
    {
        if (string.IsNullOrWhiteSpace(p.MapId))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "map_id is required.");

        if (!MindmapToolOpParser.TryParse(p.Ops, out var ops, out var parseError, out var failedIndex))
        {
            var message = failedIndex >= 0 ? $"op[{failedIndex}]: {parseError}" : parseError;
            object? data = failedIndex >= 0 ? new { failed_op_index = failedIndex } : null;
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, message, data);
        }

        var applied = await _mindmaps.ApplyAsync(p.MapId.Trim(), p.Rev, ops).ConfigureAwait(false);
        if (!applied.IsSuccess || applied.Value is null)
            return ToolInvocationResult.Failure(ToolResultCodes.InternalError, applied.ErrorMessage ?? "Failed to apply edit.");

        var edit = applied.Value;
        if (!edit.Success)
            return MapEditError(edit);

        return ToolInvocationResult.Success($"Applied {ops.Count} op(s).", new
        {
            rev = edit.Revision,
            created = edit.CreatedIds,
            deleted = edit.DeletedCount,
        });
    }

    // ---------------------------------------------------------------- projections

    private static object BuildOutlineNode(
        string id,
        IReadOnlyDictionary<string, MindmapElement> byId,
        IReadOnlyDictionary<string, List<string>> childrenOf,
        int depthLimit,
        int depth)
    {
        var node = new Dictionary<string, object?> { ["i"] = id };
        if (byId.TryGetValue(id, out var element))
        {
            var text = MindmapSearchText.Extract(element);
            if (!string.IsNullOrEmpty(text))
                node["t"] = text;
        }

        if (!childrenOf.TryGetValue(id, out var children) || children.Count == 0)
            return node;

        // A depth cut or a collapsed node hides its descendants the same way: a count, not the subtree.
        var collapsed = element?.Collapsed ?? false;
        if (collapsed || depth >= depthLimit)
        {
            var hidden = CountDescendants(id, childrenOf);
            if (hidden > 0)
                node["+n"] = hidden;
            return node;
        }

        node["c"] = children.Select(c => BuildOutlineNode(c, byId, childrenOf, depthLimit, depth + 1)).ToList();
        return node;
    }

    private static int CountDescendants(string id, IReadOnlyDictionary<string, List<string>> childrenOf)
    {
        if (!childrenOf.TryGetValue(id, out var children))
            return 0;

        var count = 0;
        foreach (var child in children)
            count += 1 + CountDescendants(child, childrenOf);
        return count;
    }

    private static object FreeElementSummary(MindmapElement element)
    {
        var summary = new Dictionary<string, object?> { ["i"] = element.Id, ["kind"] = WireKind(element.Kind) };
        var text = MindmapSearchText.Extract(element);
        if (!string.IsNullOrEmpty(text))
            summary["t"] = text;
        return summary;
    }

    private static object ElementToWire(MindmapElement element)
    {
        var wire = new Dictionary<string, object?>
        {
            ["i"] = element.Id,
            ["kind"] = WireKind(element.Kind),
            ["content"] = JsonSerializer.SerializeToElement(element.Content, MindmapDocumentSerializer.Options),
        };
        if (element.Style is not null)
            wire["style"] = JsonSerializer.SerializeToElement(element.Style, MindmapDocumentSerializer.Options);
        if (element.X != 0) wire["x"] = element.X;
        if (element.Y != 0) wire["y"] = element.Y;
        if (element.Collapsed) wire["collapsed"] = true;
        if (element.Pinned) wire["pinned"] = true;
        if (element.Width.HasValue) wire["w"] = element.Width.Value;
        if (element.Height.HasValue) wire["h"] = element.Height.Value;
        return wire;
    }

    private static object EdgeToWire(MindmapEdge edge)
    {
        var wire = new Dictionary<string, object?>
        {
            ["e"] = edge.Id,
            ["a"] = edge.FromId,
            ["b"] = edge.ToId,
            ["kind"] = WireKind(edge.Kind),
        };
        if (!string.IsNullOrEmpty(edge.Label))
            wire["label"] = edge.Label;
        return wire;
    }

    private static string DocumentLayout(MindmapDocument doc, IReadOnlyList<string> roots)
    {
        // The model has no single document layout field (layout is per cluster); report the first root's
        // cluster algorithm, falling back to the built-in default.
        foreach (var root in roots)
        {
            var cluster = doc.Clusters.FirstOrDefault(c => c.RootId == root);
            if (cluster is not null)
                return cluster.LayoutAlgorithm;
        }

        return MindmapLayoutAlgorithms.Balanced;
    }

    private static string WireKind(ElementKind kind) => kind.ToString().ToLowerInvariant();

    private static string WireKind(EdgeKind kind) => kind.ToString().ToLowerInvariant();

    // ---------------------------------------------------------------- error mapping

    private static ToolInvocationResult MapEditError(MindmapEditResult edit)
    {
        var err = edit.Error!;
        var data = new Dictionary<string, object?>();
        if (err.FailedOpIndex.HasValue)
            data["failed_op_index"] = err.FailedOpIndex.Value;

        string code;
        switch (err.Code)
        {
            case MindmapEditErrorCode.RevConflict:
                code = "rev_conflict";
                if (err.ContendedIds is { Count: > 0 })
                    data["contended_ids"] = err.ContendedIds;
                data["rev"] = edit.Revision;
                break;
            case MindmapEditErrorCode.NotFound:
                code = ToolResultCodes.NotFound;
                if (err.Suggestions is { Count: > 0 })
                    data["suggestions"] = err.Suggestions;
                break;
            case MindmapEditErrorCode.WouldCycle:
                code = "would_cycle";
                break;
            case MindmapEditErrorCode.BadContentType:
                code = "bad_content_type";
                break;
            case MindmapEditErrorCode.InvalidOperation:
                code = ToolResultCodes.ValidationError;
                break;
            default:
                code = ToolResultCodes.InternalError;
                break;
        }

        return ToolInvocationResult.Failure(code, err.Message, data.Count > 0 ? data : null);
    }

    private static ToolInvocationResult NotFoundElement(MindmapDocument doc, string id)
    {
        var suggestions = MindmapSuggestions.NearestElementIds(doc.Elements, id);
        object? data = suggestions is { Count: > 0 } ? new { suggestions } : null;
        return ToolInvocationResult.Failure(ToolResultCodes.NotFound, $"No node with id \"{id}\".", data);
    }

    // ---------------------------------------------------------------- helpers

    private async Task<(MindmapDocument? doc, ToolInvocationResult? error)> LoadAsync(string rawId)
    {
        var id = rawId?.Trim() ?? string.Empty;
        if (id.Length == 0)
            return (null, ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "map_id is required."));

        var loaded = await _mindmaps.GetAsync(id).ConfigureAwait(false);
        if (!loaded.IsSuccess || loaded.Value is null)
            return (null, ToolInvocationResult.Failure(ToolResultCodes.NotFound, $"No mindmap with id \"{id}\"."));

        return (loaded.Value, null);
    }

    private static MindmapNodeSpec ToNodeSpec(MindmapOutlineNode node) => new()
    {
        Text = node.Text,
        Children = node.Children is { Count: > 0 }
            ? node.Children.Select(ToNodeSpec).ToList()
            : Array.Empty<MindmapNodeSpec>(),
    };

    private static string? Trimmed(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static bool TitleMatches(string? title, string query)
    {
        title ??= string.Empty;
        if (title.Contains(query, StringComparison.OrdinalIgnoreCase))
            return true;

        // Fuzzy: every query character appears in order in the title (kept deliberately simple).
        var qi = 0;
        var q = query.ToLowerInvariant();
        foreach (var ch in title.ToLowerInvariant())
        {
            if (qi < q.Length && q[qi] == ch)
                qi++;
        }

        return qi == q.Length;
    }
}
