using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;

namespace Mnemo.SpanFixtureGen;

/// <summary>
/// Serializes a JsonNode tree without going through JsonNode.ToJsonString().
/// System.Text.Json's writer transcodes strings to UTF-8 bytes for output,
/// and an unpaired UTF-16 surrogate -- which SliceRuns/ApplyTextEdit can
/// legitimately produce when a range or edit boundary lands inside a
/// surrogate pair, exactly the case SpanSamples' surrogate-pair shapes are
/// designed to hit -- has no valid UTF-8 encoding, so the built-in writer
/// silently replaces it with U+FFFD. That would corrupt the fixture's
/// "expected" values for every such case without ever touching the span
/// algorithm under test. JSON's \uXXXX escape works at the UTF-16 code-unit
/// level and has no such restriction, so escaping every surrogate code unit
/// (paired or not) sidesteps the transcoding step and keeps the fixture
/// byte-exact. TryGetValue reads the CLR value straight back with no
/// intermediate JsonElement round trip, so it never re-triggers the loss.
/// </summary>
public static class FixtureJsonWriter
{
    public static string Serialize(JsonNode node)
    {
        var sb = new StringBuilder();
        Write(node, sb);
        return sb.ToString();
    }

    private static void Write(JsonNode? node, StringBuilder sb)
    {
        switch (node)
        {
            case null:
                sb.Append("null");
                break;
            case JsonObject obj:
                sb.Append('{');
                bool firstProp = true;
                foreach (var (key, value) in obj)
                {
                    if (!firstProp) sb.Append(',');
                    firstProp = false;
                    WriteString(key, sb);
                    sb.Append(':');
                    Write(value, sb);
                }
                sb.Append('}');
                break;
            case JsonArray arr:
                sb.Append('[');
                for (int i = 0; i < arr.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    Write(arr[i], sb);
                }
                sb.Append(']');
                break;
            case JsonValue val:
                WriteValue(val, sb);
                break;
            default:
                throw new NotSupportedException(node.GetType().Name);
        }
    }

    private static void WriteValue(JsonValue val, StringBuilder sb)
    {
        if (val.TryGetValue<string>(out var s)) { WriteString(s, sb); return; }
        if (val.TryGetValue<bool>(out var b)) { sb.Append(b ? "true" : "false"); return; }
        if (val.TryGetValue<int>(out var i)) { sb.Append(i.ToString(CultureInfo.InvariantCulture)); return; }
        if (val.TryGetValue<long>(out var l)) { sb.Append(l.ToString(CultureInfo.InvariantCulture)); return; }
        if (val.TryGetValue<ulong>(out var u)) { sb.Append(u.ToString(CultureInfo.InvariantCulture)); return; }
        if (val.TryGetValue<double>(out var d)) { sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); return; }
        throw new NotSupportedException($"Unsupported JsonValue for fixture output: {val}");
    }

    private static void WriteString(string s, StringBuilder sb)
    {
        sb.Append('"');
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20 || (c >= 0xD800 && c <= 0xDFFF))
                        sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else
                        sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
    }
}
