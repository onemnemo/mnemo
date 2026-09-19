using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Mnemo.Core.Models;

namespace Mnemo.Core.Serialization;

/// <summary>
/// The JSON shape of one <see cref="InlineSpan"/>: <c>{ kind, text | latex | numerator+denominator, style }</c>.
/// Shared by the block converter and by every other model that carries a run of inline spans, so a span
/// reads and writes the same bytes whichever document it sits in.
/// </summary>
public static class InlineSpanJson
{
    public static bool TryGetPropertyCaseInsensitive(JsonElement element, string propertyName, out JsonElement value)
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

    /// <summary>One span from its object, or null for a value that is not an object.</summary>
    public static InlineSpan? ReadSpan(JsonElement el)
    {
        if (el.ValueKind != JsonValueKind.Object)
            return null;
        var kind = TryGetPropertyCaseInsensitive(el, "kind", out var kEl) ? kEl.GetString() : null;
        kind = kind?.ToLowerInvariant();
        if (kind == "fraction")
        {
            var num = ReadInt32(el, "numerator", 0);
            var den = ReadInt32(el, "denominator", 1);
            return new FractionSpan(num, den <= 0 ? 1 : den, ReadStyle(el));
        }
        var isEquation = kind == "equation"
            || (kind != "text" && TryGetPropertyCaseInsensitive(el, "latex", out _) && !TryGetPropertyCaseInsensitive(el, "text", out _));
        if (isEquation)
        {
            var latex = TryGetPropertyCaseInsensitive(el, "latex", out var lx) ? lx.GetString() ?? string.Empty : string.Empty;
            return new EquationSpan(latex, ReadStyle(el));
        }

        var text = TryGetPropertyCaseInsensitive(el, "text", out var t) ? t.GetString() ?? string.Empty : string.Empty;
        return new TextSpan(text, ReadStyle(el));
    }

    /// <summary>Every readable span in the array; anything that is not an object is skipped.</summary>
    public static List<InlineSpan> ReadSpans(JsonElement arr)
    {
        var list = new List<InlineSpan>();
        foreach (var el in arr.EnumerateArray())
        {
            var span = ReadSpan(el);
            if (span is not null)
                list.Add(span);
        }

        return list;
    }

    public static void WriteSpan(Utf8JsonWriter writer, InlineSpan s)
    {
        writer.WriteStartObject();
        switch (s)
        {
            case TextSpan t:
                writer.WriteString("kind", "text");
                writer.WriteString("text", t.Text);
                writer.WritePropertyName("style");
                WriteStyle(writer, t.Style);
                break;
            case EquationSpan e:
                writer.WriteString("kind", "equation");
                writer.WriteString("latex", e.Latex);
                writer.WritePropertyName("style");
                WriteStyle(writer, e.Style);
                break;
            case FractionSpan f:
                writer.WriteString("kind", "fraction");
                writer.WriteNumber("numerator", f.Numerator);
                writer.WriteNumber("denominator", f.Denominator);
                writer.WritePropertyName("style");
                WriteStyle(writer, f.Style);
                break;
            default:
                throw new UnreachableException($"Unknown inline span type: {s.GetType().Name}");
        }

        writer.WriteEndObject();
    }

    public static void WriteSpans(Utf8JsonWriter writer, IReadOnlyList<InlineSpan> spans)
    {
        writer.WriteStartArray();
        foreach (var s in spans)
            WriteSpan(writer, s);
        writer.WriteEndArray();
    }

    /// <summary>The span's <c>style</c> member, or the default when it is absent or not an object.</summary>
    public static TextStyle ReadStyle(JsonElement spanEl)
    {
        if (!TryGetPropertyCaseInsensitive(spanEl, "style", out var st) || st.ValueKind != JsonValueKind.Object)
            return TextStyle.Default;
        return ReadStyleObject(st, out _);
    }

    /// <summary>
    /// A style object. The out parameter carries the pre-atom <c>equationLatex</c> flag some legacy note
    /// runs stored on their style, which the block converter turns into an equation span.
    /// </summary>
    public static TextStyle ReadStyleObject(JsonElement st, out string? equationLatex)
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

    public static void WriteStyle(Utf8JsonWriter writer, TextStyle st)
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

    private static int ReadInt32(JsonElement el, string propertyName, int fallback)
    {
        return TryGetPropertyCaseInsensitive(el, propertyName, out var value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt32(out var number)
            ? number
            : fallback;
    }
}

/// <summary>
/// System.Text.Json converter for a single <see cref="InlineSpan"/>, so a model that declares a list of
/// spans serializes without a converter of its own. Registered on the type, so it applies under any
/// options; the block converter writes its spans through the same helpers and never sees this one.
/// </summary>
public sealed class InlineSpanJsonConverter : JsonConverter<InlineSpan>
{
    public override bool HandleNull => true;

    // A value that is not a span object reads as an empty run, the way the block reader skips one,
    // so a single damaged entry never keeps the whole document from loading.
    public override InlineSpan Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var doc = JsonDocument.ParseValue(ref reader);
        return InlineSpanJson.ReadSpan(doc.RootElement) ?? InlineSpan.Plain(string.Empty);
    }

    public override void Write(Utf8JsonWriter writer, InlineSpan value, JsonSerializerOptions options) =>
        InlineSpanJson.WriteSpan(writer, value);
}
