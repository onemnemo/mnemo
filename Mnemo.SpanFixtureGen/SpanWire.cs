using System.Text.Json.Nodes;
using Mnemo.Core.Models;

namespace Mnemo.SpanFixtureGen;

/// <summary>
/// Writes InlineSpan lists in the exact JSON shape mnemo-web's wire.ts parses
/// (mirrors BlockJsonConverter's field-presence rules), so the TS differential
/// test can feed fixture spans straight through its own `parseSpans` instead
/// of a second, hand-rolled parser.
/// </summary>
public static class SpanWire
{
    public static JsonArray WriteSpans(IReadOnlyList<InlineSpan> spans)
    {
        var array = new JsonArray();
        foreach (var span in spans) array.Add(WriteSpan(span));
        return array;
    }

    public static JsonObject WriteSpan(InlineSpan span) => span switch
    {
        TextSpan t => new JsonObject { ["kind"] = "text", ["text"] = t.Text, ["style"] = WriteStyle(t.Style) },
        EquationSpan e => new JsonObject { ["kind"] = "equation", ["latex"] = e.Latex, ["style"] = WriteStyle(e.Style) },
        FractionSpan f => new JsonObject
        {
            ["kind"] = "fraction",
            ["numerator"] = f.Numerator,
            ["denominator"] = f.Denominator,
            ["style"] = WriteStyle(f.Style),
        },
        _ => throw new NotSupportedException(span.GetType().Name),
    };

    public static JsonObject WriteStyle(TextStyle style)
    {
        var o = new JsonObject
        {
            ["bold"] = style.Bold,
            ["italic"] = style.Italic,
            ["underline"] = style.Underline,
            ["strikethrough"] = style.Strikethrough,
            ["code"] = style.Code,
            ["highlight"] = style.Highlight,
        };
        if (style.BackgroundColor != null) o["backgroundColor"] = style.BackgroundColor;
        if (style.ForegroundColor != null) o["foregroundColor"] = style.ForegroundColor;
        if (style.LinkUrl != null) o["linkUrl"] = style.LinkUrl;
        o["suppressAutoLink"] = style.SuppressAutoLink;
        if (style.Subscript) o["subscript"] = true;
        if (style.Superscript) o["superscript"] = true;
        return o;
    }
}
