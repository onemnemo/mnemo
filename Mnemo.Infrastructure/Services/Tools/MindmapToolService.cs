using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Models.Tools.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes;

namespace Mnemo.Infrastructure.Services.Tools;

/// <summary>
/// Agent-facing tools for the Mindmap module, registered via <see cref="MindmapToolRegistrar"/>.
/// </summary>
/// <remarks>
/// Follows the same editor-agent loop as Notes: search → outline → read → edit. Nested
/// <c>outline</c> trees replace the fragile flat <c>parent_index</c> batch format, and structural
/// edits auto-run layout so the model never has to remember a separate layout step.
/// </remarks>
public sealed class MindmapToolService
{
    private readonly IMindmapService _mindmaps;
    private readonly IMindmapLayoutService _layout;
    private readonly INavigationService _nav;
    private readonly IMainThreadDispatcher _ui;
    private readonly INoteService? _notes;

    public MindmapToolService(
        IMindmapService mindmaps,
        IMindmapLayoutService layout,
        INavigationService nav,
        IMainThreadDispatcher ui,
        INoteService? notes = null)
    {
        _mindmaps = mindmaps;
        _layout = layout;
        _nav = nav;
        _ui = ui;
        _notes = notes;
    }

    public async Task<ToolInvocationResult> SearchMindmapsAsync(SearchMindmapsParameters p)
    {
        var res = await _mindmaps.GetAllMindmapsAsync().ConfigureAwait(false);
        if (!res.IsSuccess || res.Value == null)
            return ToolInvocationResult.Failure(ToolResultCodes.InternalError, res.ErrorMessage ?? "Failed to list mindmaps.");

        var limit = p.Limit is > 0 and <= 100 ? p.Limit!.Value : 20;
        var fuzzy = p.Fuzzy ?? true;
        var list = res.Value.AsEnumerable();

        if (!string.IsNullOrWhiteSpace(p.Query))
        {
            var q = p.Query.Trim();
            var tokens = TextSearchMatch.ResolveSearchTokens(q);
            list = list.Where(m =>
            {
                var title = m.Title ?? string.Empty;
                if (title.Contains(q, StringComparison.OrdinalIgnoreCase))
                    return true;
                return tokens.Count > 0 && TextSearchMatch.MatchTokens(title, tokens, matchAll: false, fuzzy);
            });
        }

        var slice = list
            .OrderByDescending(m => m.Title, StringComparer.OrdinalIgnoreCase)
            .Take(limit)
            .Select(m => new { mindmap_id = m.Id, title = m.Title, node_count = m.Nodes.Count })
            .ToList();

        return ToolInvocationResult.Success($"{slice.Count} mindmap(s).", new { mindmaps = slice });
    }

    public async Task<ToolInvocationResult> OutlineMindmapAsync(OutlineMindmapParameters p)
    {
        var (map, error) = await LoadAsync(p.MindmapId).ConfigureAwait(false);
        if (error != null) return error;

        if (string.IsNullOrWhiteSpace(map!.RootNodeId))
            return ToolInvocationResult.Failure(ToolResultCodes.InternalError, "Mindmap has no root node.");

        var tree = MindmapGraphTree.BuildTree(map, map.RootNodeId, maxDepth: 64);

        return ToolInvocationResult.Success("Outline.", new
        {
            mindmap_id = map.Id,
            title = map.Title,
            version = MindmapGraphTree.Version(map),
            layout_algorithm = NormalizeAlgorithm(map.Layout.Algorithm),
            node_count = map.Nodes.Count,
            edge_count = map.Edges.Count,
            root = tree
        });
    }

    public async Task<ToolInvocationResult> ReadMindmapAsync(ReadMindmapParameters p)
    {
        var (map, error) = await LoadAsync(p.MindmapId).ConfigureAwait(false);
        if (error != null) return error;

        var includeLinks = p.IncludeLinks ?? true;
        var selected = new HashSet<string>(StringComparer.Ordinal);
        var unresolved = new List<string>();

        if (!string.IsNullOrWhiteSpace(p.SubtreeOf))
        {
            if (!MindmapGraphTree.TryLocate(map!, p.SubtreeOf!, out var anchor, out var ambiguous, out var candidates))
                return ResolveFailure(p.SubtreeOf!, ambiguous, candidates);
            foreach (var id in MindmapGraphTree.CollectDescendants(map!, anchor.Id, includeAnchor: true))
                selected.Add(id);
        }
        else if (p.NodeIds is { Count: > 0 })
        {
            foreach (var raw in p.NodeIds)
            {
                if (MindmapGraphTree.TryLocate(map!, raw, out var node, out _, out _))
                    selected.Add(node.Id);
                else
                    unresolved.Add(raw);
            }
        }
        else
        {
            foreach (var n in map!.Nodes)
                selected.Add(n.Id);
        }

        var nodes = map!.Nodes
            .Where(n => selected.Contains(n.Id))
            .Select(n => MindmapGraphTree.NodeToRead(map, n, includeLinks))
            .ToList();

        return ToolInvocationResult.Success($"{nodes.Count} node(s).", new
        {
            mindmap_id = map.Id,
            title = map.Title,
            version = MindmapGraphTree.Version(map),
            nodes,
            unresolved = unresolved.Count > 0 ? unresolved : null
        });
    }

    public async Task<ToolInvocationResult> EditMindmapAsync(EditMindmapParameters p)
    {
        var (map, error) = await LoadAsync(p.MindmapId).ConfigureAwait(false);
        if (error != null) return error;
        if (p.Ops == null || p.Ops.Count == 0)
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "ops is required.");

        if (!string.IsNullOrWhiteSpace(p.ExpectedVersion) &&
            !string.Equals(p.ExpectedVersion.Trim(), MindmapGraphTree.Version(map!), StringComparison.Ordinal))
        {
            return ToolInvocationResult.Failure(ToolResultCodes.Conflict,
                "The mindmap changed since it was read. Re-read and retry with the new version.",
                new { mindmap_id = map!.Id, version = MindmapGraphTree.Version(map) });
        }

        var working = MindmapCloner.Clone(map!);
        var structural = false;

        for (var i = 0; i < p.Ops.Count; i++)
        {
            var opError = ApplyOp(working, p.Ops[i], ref structural);
            if (opError != null)
                return ToolInvocationResult.Failure(opError.Value.code,
                    $"op[{i}] ({p.Ops[i].Op}): {opError.Value.message}",
                    new { mindmap_id = working.Id });
        }

        if (structural)
            ApplyLayout(working, working.Layout.Algorithm);

        var save = await _mindmaps.SaveMindmapAsync(working).ConfigureAwait(false);
        if (!save.IsSuccess)
            return ToolInvocationResult.Failure(ToolResultCodes.InternalError, save.ErrorMessage ?? "Save failed.");

        return ToolInvocationResult.Success($"Applied {p.Ops.Count} op(s).", new
        {
            mindmap_id = working.Id,
            version = MindmapGraphTree.Version(working),
            applied = p.Ops.Count,
            node_count = working.Nodes.Count
        });
    }

    public async Task<ToolInvocationResult> CreateMindmapAsync(CreateMindmapParameters p)
    {
        if (string.IsNullOrWhiteSpace(p.Title))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "title is required.");

        List<MindmapOutlineNode>? outline = p.Outline;

        if (!string.IsNullOrWhiteSpace(p.FromNoteId))
        {
            if (_notes == null)
                return ToolInvocationResult.Failure(ToolResultCodes.FeatureUnavailable, "Note service is not available.");

            var note = await _notes.GetNoteAsync(p.FromNoteId.Trim()).ConfigureAwait(false);
            if (note == null)
                return ToolInvocationResult.Failure(ToolResultCodes.NotFound, $"No note with id \"{p.FromNoteId}\".");

            outline = MindmapFromNoteConverter.FromNote(note);
            if (outline.Count == 0)
                return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "Note has no convertible structure (headings or bullets).");
        }

        var res = await _mindmaps.CreateMindmapAsync(p.Title.Trim()).ConfigureAwait(false);
        if (!res.IsSuccess || res.Value == null)
            return ToolInvocationResult.Failure(ToolResultCodes.InternalError, res.ErrorMessage ?? "Create failed.");

        var map = res.Value;
        var rootLabel = string.IsNullOrWhiteSpace(p.RootLabel) ? p.Title.Trim() : p.RootLabel!.Trim();

        if (map.RootNodeId != null)
        {
            var root = map.Nodes.FirstOrDefault(n => n.Id == map.RootNodeId);
            if (root?.Content is TextNodeContent tc)
                tc.Text = rootLabel;
        }

        if (outline is { Count: > 0 } && map.RootNodeId != null)
        {
            foreach (var child in outline)
                MindmapGraphTree.AddSubtree(map, map.RootNodeId, child);
        }

        var algo = NormalizeAlgorithm(p.LayoutAlgorithm ?? map.Layout.Algorithm);
        ApplyLayout(map, algo);

        var save = await _mindmaps.SaveMindmapAsync(map).ConfigureAwait(false);
        if (!save.IsSuccess)
            return ToolInvocationResult.Failure(ToolResultCodes.InternalError, save.ErrorMessage ?? "Save failed.");

        return ToolInvocationResult.Success($"Mindmap created (id: {map.Id}).", new
        {
            mindmap_id = map.Id,
            title = map.Title,
            version = MindmapGraphTree.Version(map),
            node_count = map.Nodes.Count,
            from_note_id = p.FromNoteId
        });
    }

    public async Task<ToolInvocationResult> ManageMindmapAsync(ManageMindmapParameters p)
    {
        var (map, error) = await LoadAsync(p.MindmapId).ConfigureAwait(false);
        if (error != null) return error;

        if (p.Delete == true)
        {
            var del = await _mindmaps.DeleteMindmapAsync(map!.Id).ConfigureAwait(false);
            return del.IsSuccess
                ? ToolInvocationResult.Success($"Mindmap deleted (id: {map.Id}).", new { mindmap_id = map.Id, deleted = true })
                : ToolInvocationResult.Failure(ToolResultCodes.InternalError, del.ErrorMessage ?? "Delete failed.");
        }

        var changed = false;

        if (!string.IsNullOrWhiteSpace(p.Rename))
        {
            map!.Title = p.Rename.Trim();
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(p.LayoutAlgorithm))
        {
            var algo = NormalizeAlgorithm(p.LayoutAlgorithm);
            ApplyLayout(map!, algo);
            changed = true;
        }

        if (!changed)
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError,
                "Nothing to do. Provide rename, layout_algorithm, or delete.");

        var save = await _mindmaps.SaveMindmapAsync(map!).ConfigureAwait(false);
        return save.IsSuccess
            ? ToolInvocationResult.Success($"Mindmap updated (id: {map!.Id}).",
                new { mindmap_id = map.Id, title = map.Title, layout_algorithm = map.Layout.Algorithm })
            : ToolInvocationResult.Failure(ToolResultCodes.InternalError, save.ErrorMessage ?? "Save failed.");
    }

    public async Task<ToolInvocationResult> OpenMindmapAsync(OpenMindmapParameters p)
    {
        var (map, error) = await LoadAsync(p.MindmapId).ConfigureAwait(false);
        if (error != null) return error;

        await _ui.InvokeAsync(() =>
        {
            _nav.NavigateTo("mindmap-detail", map!.Id);
            return Task.CompletedTask;
        }).ConfigureAwait(false);

        return ToolInvocationResult.Success($"Opened mindmap \"{map!.Title}\" (id: {map.Id}).", new { mindmap_id = map.Id });
    }

    // ---------------------------------------------------------------- edit ops

    private static (string code, string message)? ApplyOp(Mindmap map, MindmapEditOp op, ref bool structural)
    {
        var kind = (op.Op ?? string.Empty).Trim().ToLowerInvariant();
        switch (kind)
        {
            case "set_label":
                return ApplySetLabel(map, op);
            case "add":
                structural = true;
                return ApplyAdd(map, op);
            case "delete":
                structural = true;
                return ApplyDelete(map, op);
            case "move":
                structural = true;
                return ApplyMove(map, op);
            case "link":
                structural = true;
                return ApplyLink(map, op);
            case "unlink":
                structural = true;
                return ApplyUnlink(map, op);
            case "style":
                return ApplyStyle(map, op);
            default:
                return ("validation_error",
                    $"unknown op \"{op.Op}\". Use set_label, add, delete, move, link, unlink, or style.");
        }
    }

    private static (string, string)? ApplySetLabel(Mindmap map, MindmapEditOp op)
    {
        if (!Locate(map, op.Id, out var node, out var fail)) return fail;
        if (string.IsNullOrWhiteSpace(op.Label))
            return ("validation_error", "label is required.");

        if (node.Content is TextNodeContent tc)
            tc.Text = op.Label.Trim();
        else
            node.Content = new TextNodeContent { Text = op.Label.Trim() };

        return null;
    }

    private static (string, string)? ApplyAdd(Mindmap map, MindmapEditOp op)
    {
        string parentId;
        if (!string.IsNullOrWhiteSpace(op.Anchor))
        {
            if (!Locate(map, op.Anchor, out var anchor, out var fail)) return fail;
            parentId = anchor.Id;
        }
        else if (!string.IsNullOrWhiteSpace(map.RootNodeId))
            parentId = map.RootNodeId;
        else
            return ("validation_error", "anchor is required when the mindmap has no root.");

        var specs = op.Nodes is { Count: > 0 }
            ? op.Nodes
            : new List<MindmapOutlineNode> { new() { Label = op.Label ?? string.Empty, Color = op.Color, Shape = op.Shape } };

        foreach (var spec in specs)
        {
            if (string.IsNullOrWhiteSpace(spec.Label))
                return ("validation_error", "each added node needs a label.");
            MindmapGraphTree.AddSubtree(map, parentId, spec);
        }

        return null;
    }

    private static (string, string)? ApplyDelete(Mindmap map, MindmapEditOp op)
    {
        var ids = new List<string>();
        if (op.Ids is { Count: > 0 }) ids.AddRange(op.Ids);
        if (!string.IsNullOrWhiteSpace(op.Id)) ids.Add(op.Id!);
        if (ids.Count == 0)
            return ("validation_error", "delete requires id or ids.");

        foreach (var raw in ids)
        {
            if (!Locate(map, raw, out var node, out var fail)) return fail;
            if (string.Equals(node.Id, map.RootNodeId, StringComparison.Ordinal))
                return ("validation_error", "cannot delete the root node.");
            MindmapGraphTree.RemoveNodeCascade(map, node.Id);
        }

        return null;
    }

    private static (string, string)? ApplyMove(Mindmap map, MindmapEditOp op)
    {
        if (!Locate(map, op.Id, out var node, out var fail)) return fail;
        if (string.IsNullOrWhiteSpace(op.Parent))
            return ("validation_error", "parent is required.");

        if (!Locate(map, op.Parent, out var newParent, out var parentFail)) return parentFail;
        if (string.Equals(node.Id, newParent.Id, StringComparison.Ordinal))
            return ("validation_error", "cannot move a node under itself.");

        if (_mindmapsWouldCycle(map, newParent.Id, node.Id))
            return ("validation_error", "move would create a cycle.");

        map.Edges.RemoveAll(e =>
            e.Kind == MindmapEdgeKind.Hierarchy && string.Equals(e.ToId, node.Id, StringComparison.Ordinal));

        MindmapGraphTree.AddHierarchyEdge(map, newParent.Id, node.Id);
        return null;
    }

    private static bool _mindmapsWouldCycle(Mindmap map, string fromId, string toId)
    {
        // Inline cycle check (same logic as IMindmapService.WouldCreateCycle).
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var queue = new Queue<string>();
        queue.Enqueue(toId);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!visited.Add(current))
                continue;
            if (string.Equals(current, fromId, StringComparison.Ordinal))
                return true;
            foreach (var child in MindmapGraphTree.HierarchyChildren(map, current))
                queue.Enqueue(child);
        }

        return false;
    }

    private static (string, string)? ApplyLink(Mindmap map, MindmapEditOp op)
    {
        if (!Locate(map, op.Source, out var source, out var sFail)) return sFail;
        if (!Locate(map, op.Target, out var target, out var tFail)) return tFail;

        map.Edges.Add(new MindmapEdge
        {
            Id = Guid.NewGuid().ToString(),
            FromId = source.Id,
            ToId = target.Id,
            Kind = MindmapEdgeKind.Link,
            Label = op.LinkLabel,
            Type = EdgeTypes.Solid
        });

        return null;
    }

    private static (string, string)? ApplyUnlink(Mindmap map, MindmapEditOp op)
    {
        if (!string.IsNullOrWhiteSpace(op.EdgeId))
        {
            var key = op.EdgeId!.Trim();
            var edge = map.Edges.FirstOrDefault(e =>
                string.Equals(e.Id, key, StringComparison.OrdinalIgnoreCase) ||
                e.Id.StartsWith(key, StringComparison.OrdinalIgnoreCase));

            if (edge == null)
                return ("not_found", $"no edge matching \"{key}\".");

            map.Edges.Remove(edge);
            return null;
        }

        if (!Locate(map, op.Source, out var source, out var sFail)) return sFail;
        if (!Locate(map, op.Target, out var target, out var tFail)) return tFail;

        map.Edges.RemoveAll(e =>
            e.Kind == MindmapEdgeKind.Link &&
            string.Equals(e.FromId, source.Id, StringComparison.Ordinal) &&
            string.Equals(e.ToId, target.Id, StringComparison.Ordinal));

        return null;
    }

    private static (string, string)? ApplyStyle(Mindmap map, MindmapEditOp op)
    {
        if (op.Color == null && op.Shape == null && !op.Collapsed.HasValue)
            return ("validation_error", "style requires color, shape, and/or collapsed.");

        if (op.Shape != null)
        {
            var s = op.Shape.Trim().ToLowerInvariant();
            if (s is not ("rectangle" or "pill" or "circle"))
                return ("validation_error", "shape must be rectangle, pill, or circle.");
        }

        HashSet<string> targets;
        if (!string.IsNullOrWhiteSpace(op.SubtreeOf))
        {
            if (!Locate(map, op.SubtreeOf, out var anchor, out var fail)) return fail;
            targets = MindmapGraphTree.CollectDescendants(map, anchor.Id, op.IncludeAnchor == true);
        }
        else
        {
            targets = new HashSet<string>(StringComparer.Ordinal);
            var ids = new List<string>();
            if (op.Ids is { Count: > 0 }) ids.AddRange(op.Ids);
            if (!string.IsNullOrWhiteSpace(op.Id)) ids.Add(op.Id!);
            if (ids.Count == 0)
                return ("validation_error", "style requires id, ids, or subtree_of.");

            foreach (var raw in ids)
            {
                if (!Locate(map, raw, out var node, out var fail)) return fail;
                targets.Add(node.Id);
            }
        }

        foreach (var id in targets)
        {
            var node = map.Nodes.First(n => string.Equals(n.Id, id, StringComparison.Ordinal));
            MindmapGraphTree.ApplyStyle(node, op.Color, op.Shape, op.Collapsed);
        }

        return null;
    }

    // ---------------------------------------------------------------- helpers

    private static bool Locate(Mindmap map, string? idOrPrefix, out MindmapNode node, out (string, string)? failure)
    {
        node = null!;
        failure = null;
        if (string.IsNullOrWhiteSpace(idOrPrefix))
        {
            failure = ("validation_error", "node id is required.");
            return false;
        }

        if (MindmapGraphTree.TryLocate(map, idOrPrefix, out node, out var ambiguous, out var candidates))
            return true;

        failure = ambiguous
            ? ("validation_error", $"id \"{idOrPrefix}\" is ambiguous; candidates: {string.Join(", ", candidates)}.")
            : ("not_found", $"no node matching \"{idOrPrefix}\".");
        return false;
    }

    private static ToolInvocationResult ResolveFailure(string id, bool ambiguous, IReadOnlyList<string> candidates) =>
        ambiguous
            ? ToolInvocationResult.Failure(ToolResultCodes.ValidationError,
                $"id \"{id}\" is ambiguous; candidates: {string.Join(", ", candidates)}.")
            : ToolInvocationResult.Failure(ToolResultCodes.NotFound, $"no node matching \"{id}\".");

    private async Task<(Mindmap? map, ToolInvocationResult? error)> LoadAsync(string rawId)
    {
        var id = rawId?.Trim() ?? string.Empty;
        if (id.Length == 0)
            return (null, ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "mindmap_id is required."));

        var res = await _mindmaps.GetMindmapAsync(id).ConfigureAwait(false);
        if (!res.IsSuccess || res.Value == null)
            return (null, ToolInvocationResult.Failure(ToolResultCodes.NotFound, "Mindmap not found."));

        return (res.Value, null);
    }

    private void ApplyLayout(Mindmap map, string? algorithm)
    {
        var algo = NormalizeAlgorithm(algorithm);
        _layout.Apply(map, algo);
        map.Layout.Algorithm = algo;
    }

    private static string NormalizeAlgorithm(string? algorithm)
    {
        var algo = algorithm?.Trim();
        if (string.IsNullOrEmpty(algo) || string.Equals(algo, "Freeform", StringComparison.Ordinal))
            return LayoutAlgorithms.TreeVertical;
        if (algo is LayoutAlgorithms.TreeVertical or LayoutAlgorithms.TreeHorizontal or LayoutAlgorithms.Radial)
            return algo;
        return LayoutAlgorithms.TreeVertical;
    }
}
