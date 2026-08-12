using System;
using System.Collections.Generic;
using System.Text.Json;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Mindmap.Tools;

/// <summary>
/// Translates the compact wire ops of an edit batch into strongly-typed <see cref="MindmapEditOp"/>
/// records, catching malformed shapes (unknown op, missing field, bad array) before the service is
/// touched. Separated from the tool service so the wire grammar is unit-testable on its own. Content
/// and style objects reuse the storage <c>$type</c>/token encoding, parsed case-insensitively.
/// <para>
/// Public because this is the one op grammar for the whole app: the AI's <c>edit_mindmap</c> tool and
/// the SPA's ops endpoint parse through here. Two parsers for one vocabulary is how the agent surface
/// and the editor surface drift apart, and only one of them would have the tests.
/// </para>
/// </summary>
public static class MindmapToolOpParser
{
    // Same converters and discriminators as storage, but tolerant of property-name casing — a small model
    // is inconsistent about it, and there is no reason to reject "Fill" when "fill" is meant.
    private static readonly JsonSerializerOptions ContentOptions =
        new(MindmapDocumentSerializer.Options) { PropertyNameCaseInsensitive = true };

    /// <summary>
    /// Parses the ops array. On failure, <paramref name="error"/> describes the problem and
    /// <paramref name="failedOpIndex"/> is the offending op's index (or -1 for a batch-level problem).
    /// </summary>
    public static bool TryParse(JsonElement ops, out List<MindmapEditOp> parsed, out string error, out int failedOpIndex)
    {
        parsed = new List<MindmapEditOp>();
        error = string.Empty;
        failedOpIndex = -1;

        if (ops.ValueKind != JsonValueKind.Array)
        {
            error = "ops must be a JSON array.";
            return false;
        }

        var index = 0;
        foreach (var element in ops.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                error = "each op must be a JSON object.";
                failedOpIndex = index;
                return false;
            }

            if (!TryParseOp(element, out var op, out var opError))
            {
                error = opError;
                failedOpIndex = index;
                return false;
            }

            parsed.Add(op);
            index++;
        }

        if (parsed.Count == 0)
        {
            error = "ops must not be empty.";
            return false;
        }

        return true;
    }

    private static bool TryParseOp(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        if (!el.TryGetProperty("op", out var opProp) || opProp.ValueKind != JsonValueKind.String)
        {
            error = "missing string \"op\" field.";
            return false;
        }

        var kind = opProp.GetString()!.Trim().ToLowerInvariant();
        return kind switch
        {
            "add" => TryParseAdd(el, out op, out error),
            "set" => TryParseSet(el, out op, out error),
            "move" => TryParseMove(el, out op, out error),
            "del" => TryParseDelete(el, out op, out error),
            "link" => TryParseLink(el, out op, out error),
            "unlink" => TryParseUnlink(el, out op, out error),
            "set_edge" => TryParseSetEdge(el, out op, out error),
            "style_subtree" => TryParseStyleSubtree(el, out op, out error),
            "layout" => TryParseLayout(el, out op, out error),
            "add_el" => TryParseAddElement(el, out op, out error),
            "frame" => TryParseFrame(el, out op, out error),
            _ => Fail(out op, out error,
                $"unknown op \"{kind}\". Use add, set, move, del, link, unlink, set_edge, style_subtree, layout, add_el, or frame."),
        };
    }

    // ---- Ops ------------------------------------------------------------------------------------

    private static bool TryParseAdd(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        if (!el.TryGetProperty("nodes", out var nodesEl) || nodesEl.ValueKind != JsonValueKind.Array)
        {
            error = "add requires a \"nodes\" array.";
            return false;
        }

        if (!TryParseNodeSpecs(nodesEl, out var nodes, out error))
            return false;
        if (nodes.Count == 0)
        {
            error = "add \"nodes\" must not be empty.";
            return false;
        }

        op = new AddNodesOp { Under = OptString(el, "under"), After = OptString(el, "after"), Nodes = nodes };
        return true;
    }

    private static bool TryParseSet(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        var id = OptString(el, "id");
        if (string.IsNullOrEmpty(id))
        {
            error = "set requires \"id\".";
            return false;
        }

        if (!TryOptContent(el, out var content, out error))
            return false;
        if (!TryOptStyle<ElementStyle>(el, "style", out var style, out error))
            return false;
        if (!TryOptWidthHeight(el, out var width, out var height, out error))
            return false;

        op = new SetOp
        {
            Id = id!,
            Text = OptString(el, "t"),
            Content = content,
            Style = style,
            ClearStyle = OptBool(el, "clear_style") ?? false,
            Collapsed = OptBool(el, "collapsed"),
            Pinned = OptBool(el, "pinned"),
            Width = width,
            Height = height,
        };
        return true;
    }

    private static bool TryParseMove(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        var id = OptString(el, "id");
        if (string.IsNullOrEmpty(id))
        {
            error = "move requires \"id\".";
            return false;
        }

        if (el.TryGetProperty("xy", out _))
        {
            if (!TryPair(el, "xy", out var x, out var y, out error))
                return false;
            op = new MoveOp { Id = id!, X = x, Y = y, Pin = OptBool(el, "pin") };
            return true;
        }

        var under = OptString(el, "under");
        if (string.IsNullOrEmpty(under))
        {
            error = "move requires \"under\" (reparent) or \"xy\": [x, y] (reposition).";
            return false;
        }

        op = new MoveOp { Id = id!, Under = under, After = OptString(el, "after") };
        error = string.Empty;
        return true;
    }

    private static bool TryParseDelete(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        var ids = new List<string>();
        if (el.TryGetProperty("ids", out _) && !TryStringArray(el, "ids", ids, out error))
            return false;

        var single = OptString(el, "id");
        if (!string.IsNullOrEmpty(single))
            ids.Add(single);

        if (ids.Count == 0)
        {
            error = "del requires \"ids\": [] (or a single \"id\").";
            return false;
        }

        op = new DeleteOp { Ids = ids };
        error = string.Empty;
        return true;
    }

    private static bool TryParseLink(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        var a = OptString(el, "a");
        var b = OptString(el, "b");
        if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b))
        {
            error = "link requires \"a\" and \"b\".";
            return false;
        }

        if (!TryOptStyle<EdgeStyle>(el, "style", out var style, out error))
            return false;

        op = new LinkOp { Ref = OptString(el, "ref"), A = a!, B = b!, Label = OptString(el, "label"), Style = style };
        return true;
    }

    private static bool TryParseUnlink(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        error = string.Empty;
        var edge = OptString(el, "edge");
        if (!string.IsNullOrEmpty(edge))
        {
            op = new UnlinkOp { EdgeId = edge };
            return true;
        }

        var a = OptString(el, "a");
        var b = OptString(el, "b");
        if (!string.IsNullOrEmpty(a) && !string.IsNullOrEmpty(b))
        {
            op = new UnlinkOp { A = a, B = b };
            return true;
        }

        error = "unlink requires \"edge\", or both \"a\" and \"b\".";
        return false;
    }

    private static bool TryParseSetEdge(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        var edge = OptString(el, "edge");
        if (string.IsNullOrEmpty(edge))
        {
            error = "set_edge requires \"edge\".";
            return false;
        }

        if (!TryOptStyle<EdgeStyle>(el, "style", out var style, out error))
            return false;

        // An empty-string label clears it; an absent label leaves it unchanged (SetEdgeOp treats null as "keep").
        op = new SetEdgeOp { EdgeId = edge!, Label = OptString(el, "label"), Style = style, ClearStyle = OptBool(el, "clear_style") ?? false };
        return true;
    }

    private static bool TryParseStyleSubtree(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        var root = OptString(el, "root");
        List<string>? ids = null;
        if (el.TryGetProperty("ids", out _))
        {
            ids = new List<string>();
            if (!TryStringArray(el, "ids", ids, out error))
                return false;
        }

        if (string.IsNullOrEmpty(root) && (ids is null || ids.Count == 0))
        {
            error = "style_subtree requires \"root\" or a non-empty \"ids\".";
            return false;
        }

        if (!el.TryGetProperty("style", out var styleEl) || styleEl.ValueKind != JsonValueKind.Object)
        {
            error = "style_subtree requires a \"style\" object.";
            return false;
        }

        if (!TryDeserialize<ElementStyle>(styleEl, "style", out var style, out error) || style is null)
            return false;

        op = new StyleSubtreeOp { Root = root, Ids = ids, Style = style };
        return true;
    }

    private static bool TryParseLayout(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        LayoutOptions? options = null;
        if (el.TryGetProperty("options", out var optionsEl))
        {
            if (optionsEl.ValueKind != JsonValueKind.Object)
            {
                error = "layout \"options\" must be an object.";
                return false;
            }

            if (!TryDeserialize(optionsEl, "options", out options, out error))
                return false;
        }

        if (!TryOptStyle<EdgeStyle>(el, "edge_defaults", out var edgeDefaults, out error))
            return false;

        CanvasBackground? background = null;
        var backgroundName = OptString(el, "background");
        if (backgroundName is not null)
        {
            if (!Enum.TryParse(backgroundName, ignoreCase: true, out CanvasBackground parsed))
            {
                error = $"layout \"background\" must be one of dots, grid or plain, not \"{backgroundName}\".";
                return false;
            }
            background = parsed;
        }

        op = new LayoutOp
        {
            Root = OptString(el, "root"),
            Algorithm = OptString(el, "algo"),
            TemplateId = OptString(el, "template"),
            Options = options,
            EdgeDefaults = edgeDefaults,
            Background = background,
        };
        error = string.Empty;
        return true;
    }

    private static bool TryParseAddElement(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        var kindStr = OptString(el, "kind");
        if (string.IsNullOrEmpty(kindStr))
        {
            error = "add_el requires \"kind\".";
            return false;
        }

        if (!Enum.TryParse<ElementKind>(kindStr, ignoreCase: true, out var kind))
        {
            error = $"add_el has unknown kind \"{kindStr}\".";
            return false;
        }

        if (!el.TryGetProperty("xy", out _))
        {
            error = "add_el requires \"xy\": [x, y].";
            return false;
        }

        if (!TryPair(el, "xy", out var x, out var y, out error))
            return false;

        if (!el.TryGetProperty("content", out var contentEl) || contentEl.ValueKind != JsonValueKind.Object)
        {
            error = "add_el requires a \"content\" object.";
            return false;
        }

        if (!TryDeserialize<IElementContent>(contentEl, "content", out var content, out error) || content is null)
            return false;

        if (!TryOptWidthHeight(el, out var width, out var height, out error))
            return false;

        op = new AddElementOp { Ref = OptString(el, "ref"), Kind = kind, X = x, Y = y, Content = content, Width = width, Height = height };
        return true;
    }

    private static bool TryParseFrame(JsonElement el, out MindmapEditOp op, out string error)
    {
        op = null!;
        var id = OptString(el, "id");
        if (string.IsNullOrEmpty(id))
        {
            error = "frame requires \"id\".";
            return false;
        }

        List<string>? add = null;
        if (el.TryGetProperty("add", out _))
        {
            add = new List<string>();
            if (!TryStringArray(el, "add", add, out error))
                return false;
        }

        List<string>? remove = null;
        if (el.TryGetProperty("remove", out _))
        {
            remove = new List<string>();
            if (!TryStringArray(el, "remove", remove, out error))
                return false;
        }

        op = new FrameOp { Id = id!, Add = add, Remove = remove };
        error = string.Empty;
        return true;
    }

    // ---- Node specs -----------------------------------------------------------------------------

    private static bool TryParseNodeSpecs(JsonElement array, out List<MindmapNodeSpec> specs, out string error)
    {
        specs = new List<MindmapNodeSpec>();
        error = string.Empty;
        foreach (var element in array.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                error = "each node must be an object.";
                return false;
            }

            if (!TryParseNodeSpec(element, out var spec, out error))
                return false;
            specs.Add(spec);
        }

        return true;
    }

    private static bool TryParseNodeSpec(JsonElement n, out MindmapNodeSpec spec, out string error)
    {
        spec = null!;
        var text = OptString(n, "t");

        if (!TryOptContent(n, out var content, out error))
            return false;

        var children = new List<MindmapNodeSpec>();
        if (n.TryGetProperty("c", out var childrenEl))
        {
            if (childrenEl.ValueKind != JsonValueKind.Array)
            {
                error = "node \"c\" must be an array.";
                return false;
            }

            if (!TryParseNodeSpecs(childrenEl, out children, out error))
                return false;
        }

        double? x = null;
        double? y = null;
        if (n.TryGetProperty("xy", out _))
        {
            if (!TryPair(n, "xy", out var xv, out var yv, out error))
                return false;
            x = xv;
            y = yv;
        }

        if (text is null && content is null && children.Count == 0)
        {
            error = "each node needs \"t\", \"content\", or \"c\".";
            return false;
        }

        spec = new MindmapNodeSpec
        {
            Ref = OptString(n, "ref"),
            Text = text,
            Content = content,
            Children = children,
            X = x,
            Y = y,
            Pin = OptBool(n, "pin"),
        };
        return true;
    }

    // ---- Field helpers --------------------------------------------------------------------------

    private static string? OptString(JsonElement el, string name) =>
        el.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    private static bool? OptBool(JsonElement el, string name) =>
        el.TryGetProperty(name, out var p) && p.ValueKind is JsonValueKind.True or JsonValueKind.False ? p.GetBoolean() : null;

    private static bool TryOptContent(JsonElement el, out IElementContent? content, out string error)
    {
        content = null;
        error = string.Empty;
        if (!el.TryGetProperty("content", out var contentEl) || contentEl.ValueKind == JsonValueKind.Null)
            return true;
        if (contentEl.ValueKind != JsonValueKind.Object)
        {
            error = "\"content\" must be an object.";
            return false;
        }

        return TryDeserialize(contentEl, "content", out content, out error);
    }

    private static bool TryOptStyle<T>(JsonElement el, string name, out T? style, out string error) where T : class
    {
        style = null;
        error = string.Empty;
        if (!el.TryGetProperty(name, out var styleEl) || styleEl.ValueKind == JsonValueKind.Null)
            return true;
        if (styleEl.ValueKind != JsonValueKind.Object)
        {
            error = $"\"{name}\" must be an object.";
            return false;
        }

        return TryDeserialize(styleEl, name, out style, out error);
    }

    private static bool TryOptWidthHeight(JsonElement el, out double? width, out double? height, out string error)
    {
        width = null;
        height = null;
        error = string.Empty;
        if (!el.TryGetProperty("wh", out _))
            return true;
        if (!TryPair(el, "wh", out var w, out var h, out error))
            return false;
        width = w;
        height = h;
        return true;
    }

    private static bool TryPair(JsonElement el, string name, out double first, out double second, out string error)
    {
        first = 0;
        second = 0;
        error = string.Empty;
        var array = el.GetProperty(name);
        if (array.ValueKind != JsonValueKind.Array)
        {
            error = $"\"{name}\" must be a [{name[0]}, ...] number array.";
            return false;
        }

        var values = new List<double>();
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Number)
            {
                error = $"\"{name}\" must contain two numbers.";
                return false;
            }

            values.Add(item.GetDouble());
        }

        if (values.Count != 2)
        {
            error = $"\"{name}\" must contain exactly two numbers.";
            return false;
        }

        first = values[0];
        second = values[1];
        return true;
    }

    private static bool TryStringArray(JsonElement el, string name, List<string> into, out string error)
    {
        error = string.Empty;
        var array = el.GetProperty(name);
        if (array.ValueKind != JsonValueKind.Array)
        {
            error = $"\"{name}\" must be an array of ids.";
            return false;
        }

        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String)
            {
                error = $"\"{name}\" must contain only string ids.";
                return false;
            }

            into.Add(item.GetString()!);
        }

        return true;
    }

    private static bool TryDeserialize<T>(JsonElement el, string name, out T? value, out string error) where T : class
    {
        value = null;
        try
        {
            value = JsonSerializer.Deserialize<T>(el.GetRawText(), ContentOptions);
            if (value is null)
            {
                error = $"\"{name}\" deserialized to null.";
                return false;
            }

            error = string.Empty;
            return true;
        }
        catch (JsonException ex)
        {
            error = $"invalid \"{name}\": {ex.Message}";
            return false;
        }
    }

    private static bool Fail(out MindmapEditOp op, out string error, string message)
    {
        op = null!;
        error = message;
        return false;
    }
}
