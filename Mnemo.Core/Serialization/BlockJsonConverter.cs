using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.Core.Serialization;

/// <summary>Reads legacy <c>inlineRuns</c> / <c>content</c> and writes canonical <c>spans</c> + <c>payload</c>.</summary>
public sealed class BlockJsonConverter : JsonConverter<Block>
{
    private static bool TryGetPropertyCaseInsensitive(JsonElement element, string propertyName, out JsonElement value)
    {
        if (element.TryGetProperty(propertyName, out value))
            return true;

        foreach (var candidate in element.EnumerateObject())
        {
            if (string.Equals(candidate.Name, propertyName, StringComparison.OrdinalIgnoreCase))
            {
                value = candidate.Value;
                return true;
            }
        }

        value = default;
        return false;
    }

    private static bool TryReadBlockType(JsonElement typeEl, out BlockType blockType)
    {
        if (typeEl.ValueKind == JsonValueKind.String
            && Enum.TryParse(typeEl.GetString(), ignoreCase: true, out blockType))
            return true;

        if (typeEl.ValueKind == JsonValueKind.Number
            && typeEl.TryGetInt32(out var numeric)
            && Enum.IsDefined(typeof(BlockType), numeric))
        {
            blockType = (BlockType)numeric;
            return true;
        }

        blockType = default;
        return false;
    }

    public override Block? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var doc = JsonDocument.ParseValue(ref reader);
        var root = doc.RootElement;
        var block = new Block();

        if (TryGetPropertyCaseInsensitive(root, "id", out var idEl))
            block.Id = idEl.GetString() ?? block.Id;
        if (TryGetPropertyCaseInsensitive(root, "sid", out var sidEl) && sidEl.ValueKind == JsonValueKind.String)
            block.Sid = sidEl.GetString() ?? string.Empty;
        if (TryGetPropertyCaseInsensitive(root, "type", out var typeEl) && TryReadBlockType(typeEl, out BlockType bt))
            block.Type = bt;
        if (TryGetPropertyCaseInsensitive(root, "order", out var orderEl))
            block.Order = orderEl.GetInt32();

        if (TryGetPropertyCaseInsensitive(root, "meta", out var metaEl) && metaEl.ValueKind == JsonValueKind.Object)
            block.Meta = JsonSerializer.Deserialize<Dictionary<string, object>>(metaEl.GetRawText(), options) ?? new();

        if (TryGetPropertyCaseInsensitive(root, "children", out var chEl) && chEl.ValueKind == JsonValueKind.Array)
            block.Children = JsonSerializer.Deserialize<List<Block>>(chEl.GetRawText(), options);

        string? legacyContent = TryGetPropertyCaseInsensitive(root, "content", out var contentProp) && contentProp.ValueKind == JsonValueKind.String
            ? contentProp.GetString()
            : null;

        if (TryGetPropertyCaseInsensitive(root, "payload", out var payloadEl))
            block.Payload = ReadPayload(payloadEl);
        else
            block.Payload = PayloadFromLegacyMeta(block.Type, block.Meta, legacyContent);

        if (TryGetPropertyCaseInsensitive(root, "spans", out var spansEl) && spansEl.ValueKind == JsonValueKind.Array)
            block.Spans = ReadSpans(spansEl);
        else if (TryGetPropertyCaseInsensitive(root, "inlineRuns", out var runsEl) && runsEl.ValueKind == JsonValueKind.Array)
            block.Spans = LegacyRunsToSpans(runsEl);
        else if (legacyContent != null)
            block.Spans = new List<InlineSpan> { InlineSpan.Plain(legacyContent) };
        else
            block.Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };

        if (block.Type == BlockType.Code && block.Payload is CodePayload cp
            && string.IsNullOrEmpty(InlineSpanText.FlattenDisplay(block.Spans).Trim()) && !string.IsNullOrEmpty(cp.Source))
            block.Spans = new List<InlineSpan> { InlineSpan.Plain(cp.Source) };

        if (block.Type == BlockType.Equation)
            block.Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };

        if (block.Type == BlockType.Page)
            block.Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };

        block.Spans = InlineSpanFormatApplier.Normalize(block.Spans);
        return block;
    }

    private static string ReadPageReferenceNoteId(JsonElement el)
    {
        if (TryGetPropertyCaseInsensitive(el, "referenceNoteId", out var rn) && rn.ValueKind == JsonValueKind.String)
            return rn.GetString() ?? string.Empty;
        if (TryGetPropertyCaseInsensitive(el, "reference_note_id", out var rn2) && rn2.ValueKind == JsonValueKind.String)
            return rn2.GetString() ?? string.Empty;
        return string.Empty;
    }

    private static BlockPayload ReadPayload(JsonElement el)
    {
        if (el.ValueKind != JsonValueKind.Object)
            return new EmptyPayload();
        var kind = TryGetPropertyCaseInsensitive(el, "kind", out var k) ? k.GetString() : null;
        kind = kind?.ToLowerInvariant();
        return kind switch
        {
            "equation" => new EquationPayload(TryGetPropertyCaseInsensitive(el, "latex", out var lx) ? lx.GetString() ?? string.Empty : string.Empty),
            "image" => new ImagePayload(
                TryGetPropertyCaseInsensitive(el, "path", out var p) ? p.GetString() ?? string.Empty : string.Empty,
                TryGetPropertyCaseInsensitive(el, "alt", out var a) ? a.GetString() ?? string.Empty : string.Empty,
                TryGetPropertyCaseInsensitive(el, "width", out var w) && w.TryGetDouble(out var wd) ? wd : 0,
                TryGetPropertyCaseInsensitive(el, "align", out var al) ? al.GetString() ?? "left" : "left"),
            "code" => new CodePayload(
                TryGetPropertyCaseInsensitive(el, "language", out var lang) ? lang.GetString() ?? "csharp" : "csharp",
                TryGetPropertyCaseInsensitive(el, "source", out var src) ? src.GetString() ?? string.Empty : string.Empty),
            "checklist" => new ChecklistPayload(
                TryGetPropertyCaseInsensitive(el, "checked", out var ch) && ch.ValueKind == JsonValueKind.True),
            "twocolumn" => new TwoColumnPayload(
                TryGetPropertyCaseInsensitive(el, "splitRatio", out var sr) && sr.TryGetDouble(out var s) ? s : 0.5),
            "page" => new PagePayload(ReadPageReferenceNoteId(el)),
            "sketch" => new SketchPayload(
                TryGetPropertyCaseInsensitive(el, "width", out var sw) && sw.TryGetDouble(out var swd) ? swd : 0,
                TryGetPropertyCaseInsensitive(el, "align", out var sal) ? sal.GetString() ?? "left" : "left"),
            "empty" => new EmptyPayload(),
            null or "" => new EmptyPayload(),
            _ => throw new JsonException($"Unknown block payload kind '{kind}'.")
        };
    }

    private static List<InlineSpan> ReadSpans(JsonElement arr)
    {
        var list = new List<InlineSpan>();
        foreach (var el in arr.EnumerateArray())
        {
            if (el.ValueKind != JsonValueKind.Object)
                continue;
            var kind = TryGetPropertyCaseInsensitive(el, "kind", out var kEl) ? kEl.GetString() : null;
            kind = kind?.ToLowerInvariant();
            if (kind == "fraction")
            {
                var num = TryGetPropertyCaseInsensitive(el, "numerator", out var n) && n.TryGetInt32(out var nv) ? nv : 0;
                var den = TryGetPropertyCaseInsensitive(el, "denominator", out var d) && d.TryGetInt32(out var dv) ? dv : 1;
                list.Add(new FractionSpan(num, den <= 0 ? 1 : den, ReadTextStyle(el)));
                continue;
            }
            var isEquation = kind == "equation"
                || (kind != "text" && TryGetPropertyCaseInsensitive(el, "latex", out _) && !TryGetPropertyCaseInsensitive(el, "text", out _));
            if (isEquation)
            {
                var latex = TryGetPropertyCaseInsensitive(el, "latex", out var lx) ? lx.GetString() ?? string.Empty : string.Empty;
                list.Add(new EquationSpan(latex, ReadTextStyle(el)));
            }
            else
            {
                var text = TryGetPropertyCaseInsensitive(el, "text", out var t) ? t.GetString() ?? string.Empty : string.Empty;
                list.Add(new TextSpan(text, ReadTextStyle(el)));
            }
        }

        return list.Count == 0 ? new List<InlineSpan> { InlineSpan.Plain(string.Empty) } : list;
    }

    private static TextStyle ReadTextStyle(JsonElement spanEl)
    {
        if (!TryGetPropertyCaseInsensitive(spanEl, "style", out var st) || st.ValueKind != JsonValueKind.Object)
            return TextStyle.Default;
        return LegacyStyleFromJson(st, out _);
    }

    private static void WriteSpans(Utf8JsonWriter writer, IReadOnlyList<InlineSpan> spans)
    {
        writer.WriteStartArray();
        foreach (var s in spans)
        {
            writer.WriteStartObject();
            switch (s)
            {
                case TextSpan t:
                    writer.WriteString("kind", "text");
                    writer.WriteString("text", t.Text);
                    writer.WritePropertyName("style");
                    WriteTextStyle(writer, t.Style);
                    break;
                case EquationSpan e:
                    writer.WriteString("kind", "equation");
                    writer.WriteString("latex", e.Latex);
                    writer.WritePropertyName("style");
                    WriteTextStyle(writer, e.Style);
                    break;
                case FractionSpan f:
                    writer.WriteString("kind", "fraction");
                    writer.WriteNumber("numerator", f.Numerator);
                    writer.WriteNumber("denominator", f.Denominator);
                    writer.WritePropertyName("style");
                    WriteTextStyle(writer, f.Style);
                    break;
                default:
                    throw new UnreachableException($"Unknown inline span type: {s.GetType().Name}");
            }

            writer.WriteEndObject();
        }

        writer.WriteEndArray();
    }

    private static void WriteTextStyle(Utf8JsonWriter writer, TextStyle st)
    {
        writer.WriteStartObject();
        writer.WriteBoolean("bold", st.Bold);
        writer.WriteBoolean("italic", st.Italic);
        writer.WriteBoolean("underline", st.Underline);
        writer.WriteBoolean("strikethrough", st.Strikethrough);
        writer.WriteBoolean("code", st.Code);
        writer.WriteBoolean("highlight", st.Highlight);
        if (st.BackgroundColor != null)
            writer.WriteString("backgroundColor", st.BackgroundColor);
        if (st.ForegroundColor != null)
            writer.WriteString("foregroundColor", st.ForegroundColor);
        if (st.LinkUrl != null)
            writer.WriteString("linkUrl", st.LinkUrl);
        writer.WriteBoolean("suppressAutoLink", st.SuppressAutoLink);
        if (st.Subscript)
            writer.WriteBoolean("subscript", true);
        if (st.Superscript)
            writer.WriteBoolean("superscript", true);
        writer.WriteEndObject();
    }

    private static void WritePayload(Utf8JsonWriter writer, BlockPayload payload)
    {
        writer.WriteStartObject();
        switch (payload)
        {
            case EmptyPayload:
                writer.WriteString("kind", "empty");
                break;
            case EquationPayload eq:
                writer.WriteString("kind", "equation");
                writer.WriteString("latex", eq.Latex);
                break;
            case ImagePayload img:
                writer.WriteString("kind", "image");
                writer.WriteString("path", img.Path);
                writer.WriteString("alt", img.Alt);
                writer.WriteNumber("width", img.Width);
                writer.WriteString("align", img.Align);
                break;
            case CodePayload code:
                writer.WriteString("kind", "code");
                writer.WriteString("language", code.Language);
                writer.WriteString("source", code.Source);
                break;
            case ChecklistPayload cl:
                writer.WriteString("kind", "checklist");
                writer.WriteBoolean("checked", cl.Checked);
                break;
            case TwoColumnPayload tc:
                writer.WriteString("kind", "twoColumn");
                writer.WriteNumber("splitRatio", tc.SplitRatio);
                break;
            case PagePayload pg:
                writer.WriteString("kind", "page");
                writer.WriteString("referenceNoteId", pg.ReferenceNoteId ?? string.Empty);
                break;
            case SketchPayload sk:
                writer.WriteString("kind", "sketch");
                writer.WriteNumber("width", sk.Width);
                writer.WriteString("align", sk.Align);
                break;
            default:
                throw new UnreachableException($"Unknown block payload type: {payload.GetType().Name}");
        }

        writer.WriteEndObject();
    }

    private static BlockPayload PayloadFromLegacyMeta(BlockType type, Dictionary<string, object> meta, string? legacyContent)
    {
        switch (type)
        {
            case BlockType.Equation:
                return new EquationPayload(ReadMetaString(meta, "equationLatex"));
            case BlockType.Code:
                return new CodePayload(
                    ReadMetaString(meta, "language"),
                    legacyContent ?? string.Empty);
            case BlockType.Image:
                return new ImagePayload(
                    ReadMetaString(meta, "imagePath"),
                    ReadMetaString(meta, "imageAlt"),
                    ReadMetaDouble(meta, "imageWidth"),
                    ReadMetaString(meta, "imageAlign"));
            case BlockType.Checklist:
                return new ChecklistPayload(ReadMetaBool(meta, "checked"));
            case BlockType.TwoColumn:
                return new TwoColumnPayload(NormalizeSplitRatio(ReadMetaDouble(meta, "columnSplitRatio")));
            case BlockType.Page:
                return new PagePayload(ReadMetaString(meta, "reference_note_id"));
            default:
                return new EmptyPayload();
        }
    }

    private static string ReadMetaString(Dictionary<string, object> meta, string key)
    {
        if (!meta.TryGetValue(key, out var v) || v == null) return string.Empty;
        if (v is string s) return s;
        if (v is JsonElement je && je.ValueKind == JsonValueKind.String) return je.GetString() ?? string.Empty;
        return v.ToString() ?? string.Empty;
    }

    private static double ReadMetaDouble(Dictionary<string, object> meta, string key)
    {
        if (!meta.TryGetValue(key, out var v) || v == null) return 0;
        if (v is double d) return d;
        if (v is int i) return i;
        if (v is JsonElement je && je.TryGetDouble(out var x)) return x;
        return 0;
    }

    private static bool ReadMetaBool(Dictionary<string, object> meta, string key)
    {
        if (!meta.TryGetValue(key, out var v) || v == null) return false;
        if (v is bool b) return b;
        if (v is JsonElement je)
            return je.ValueKind == JsonValueKind.True;
        return false;
    }

    private static double NormalizeSplitRatio(double raw)
    {
        if (raw <= 0 || raw >= 1 || double.IsNaN(raw))
            return 0.5;
        return Math.Clamp(raw, 0.1, 0.9);
    }

    private static List<InlineSpan> LegacyRunsToSpans(JsonElement runsEl)
    {
        var list = new List<InlineSpan>();
        foreach (var el in runsEl.EnumerateArray())
        {
            if (el.ValueKind != JsonValueKind.Object)
                continue;
            var text = TryGetPropertyCaseInsensitive(el, "text", out var t) ? t.GetString() ?? string.Empty : string.Empty;
            TextStyle style = default;
            string? eq = null;
            if (TryGetPropertyCaseInsensitive(el, "style", out var st) && st.ValueKind == JsonValueKind.Object)
            {
                style = LegacyStyleFromJson(st, out eq);
            }

            if (!string.IsNullOrEmpty(eq))
                list.Add(new EquationSpan(EquationLatexNormalizer.Normalize(eq), style));
            else
                list.Add(new TextSpan(text, style));
        }

        return list.Count == 0 ? new List<InlineSpan> { InlineSpan.Plain(string.Empty) } : list;
    }

    private static TextStyle LegacyStyleFromJson(JsonElement st, out string? equationLatex)
    {
        equationLatex = null;
        if (TryGetPropertyCaseInsensitive(st, "equationLatex", out var eqEl))
        {
            if (eqEl.ValueKind == JsonValueKind.String)
                equationLatex = eqEl.GetString();
        }

        bool B(string n)
        {
            if (!TryGetPropertyCaseInsensitive(st, n, out var x)) return false;
            return x.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => false
            };
        }
        string? S(string n) =>
            TryGetPropertyCaseInsensitive(st, n, out var x) && x.ValueKind == JsonValueKind.String ? x.GetString() : null;

        var highlight = B("highlight");
        var backgroundColor = S("backgroundColor");
        // Backward compatibility: earlier builds persisted highlight by only storing a themed backgroundColor.
        if (!highlight && backgroundColor is not null
            && (string.Equals(backgroundColor, "#FFD7AA", StringComparison.OrdinalIgnoreCase)
                || string.Equals(backgroundColor, "#5B3717", StringComparison.OrdinalIgnoreCase)
                || string.Equals(backgroundColor, "#FFFF00", StringComparison.OrdinalIgnoreCase)))
        {
            highlight = true;
            backgroundColor = null;
        }

        return new TextStyle(
            Bold: B("bold"),
            Italic: B("italic"),
            Underline: B("underline"),
            Strikethrough: B("strikethrough"),
            Code: B("code"),
            Highlight: highlight,
            BackgroundColor: backgroundColor,
            ForegroundColor: S("foregroundColor"),
            LinkUrl: S("linkUrl"),
            SuppressAutoLink: B("suppressAutoLink"),
            Subscript: B("subscript"),
            Superscript: B("superscript"));
    }

    public override void Write(Utf8JsonWriter writer, Block value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WriteString("id", value.Id);

        // Written only once assigned, so a note that has not been through the sid migration still
        // round-trips to the exact bytes it was stored as.
        if (!string.IsNullOrEmpty(value.Sid))
            writer.WriteString("sid", value.Sid);

        writer.WriteString("type", value.Type.ToString());
        writer.WriteNumber("order", value.Order);

        writer.WritePropertyName("spans");
        WriteSpans(writer, value.Spans);

        writer.WritePropertyName("payload");
        var payloadToWrite = value.Payload;
        if (value.Type == BlockType.TwoColumn && payloadToWrite is EmptyPayload)
            payloadToWrite = new TwoColumnPayload(NormalizeSplitRatio(ReadMetaDouble(value.Meta ?? new Dictionary<string, object>(), "columnSplitRatio")));
        if (value.Type == BlockType.Page && payloadToWrite is EmptyPayload)
            payloadToWrite = new PagePayload(ReadMetaString(value.Meta ?? new Dictionary<string, object>(), "reference_note_id"));
        WritePayload(writer, payloadToWrite);

        writer.WritePropertyName("meta");
        if (value.Type == BlockType.TwoColumn)
        {
            var m = new Dictionary<string, object>(value.Meta ?? new Dictionary<string, object>());
            m.Remove("columnSplitRatio");
            JsonSerializer.Serialize(writer, m, options);
        }
        else if (value.Type == BlockType.Page)
        {
            var m = new Dictionary<string, object>(value.Meta ?? new Dictionary<string, object>());
            m.Remove("reference_note_id");
            JsonSerializer.Serialize(writer, m, options);
        }
        else if (value.Type == BlockType.Image)
        {
            var m = new Dictionary<string, object>(value.Meta ?? new Dictionary<string, object>());
            foreach (var k in new[] { "imagePath", "imageAlt", "imageWidth", "imageAlign" })
                m.Remove(k);
            JsonSerializer.Serialize(writer, m, options);
        }
        else
            JsonSerializer.Serialize(writer, value.Meta, options);

        if (value.Children is { Count: > 0 })
        {
            writer.WritePropertyName("children");
            JsonSerializer.Serialize(writer, value.Children, options);
        }

        writer.WriteEndObject();
    }
}
