using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

internal enum AnkiShapeKind
{
    Rect,
    Ellipse,
    Polygon,
    Text,
}

/// <summary>One shape from an Anki image occlusion note. Coordinates are 0 to 1 fractions of the image.</summary>
/// <param name="Index">Position among all the shape clozes in the field, including unreadable ones.</param>
/// <param name="Ordinals">Every card ordinal the shape belongs to; <c>c1,2</c> names two.</param>
/// <param name="Width">The box width; twice the radius for an ellipse. Zero for polygon and text.</param>
/// <param name="Points">Polygon vertices as written, before the move offset is applied.</param>
/// <param name="Angle">Rotation as a fraction of a turn, as stored; zero for none.</param>
internal sealed record AnkiOcclusionShape(
    int Index,
    IReadOnlyList<int> Ordinals,
    AnkiShapeKind Kind,
    double Left,
    double Top,
    double Width,
    double Height,
    IReadOnlyList<double[]> Points,
    double Angle,
    string Text,
    bool OccludeInactive);

/// <summary>
/// Reads the shapes of Anki's Occlusion field, one cloze each: <c>{{c1::image-occlusion:rect:left=.1:top=.1:width=.3:height=.3}}</c>.
/// </summary>
internal static partial class AnkiOcclusionParser
{
    private const string ShapeMarker = "image-occlusion:";

    [GeneratedRegex(@"\{\{c(?<ords>\d+(?:,\d+)*)::" + ShapeMarker)]
    private static partial Regex ShapeStartRegex();

    /// <summary>Every readable shape in field order. A skipped cloze still takes an index, so ids stay stable.</summary>
    public static IReadOnlyList<AnkiOcclusionShape> Parse(string? field)
    {
        var shapes = new List<AnkiOcclusionShape>();
        if (string.IsNullOrEmpty(field))
            return shapes;

        var index = 0;
        foreach (Match start in ShapeStartRegex().Matches(field))
        {
            var bodyStart = start.Index + start.Length;
            // Anki itself ends a cloze at the first closing braces whatever the shape holds.
            var end = field.IndexOf("}}", bodyStart, StringComparison.Ordinal);
            if (end < 0)
                break;

            var shape = ParseBody(index++, ReadOrdinals(start.Groups["ords"].Value), field[bodyStart..end]);
            if (shape is not null)
                shapes.Add(shape);
        }

        return shapes;
    }

    private static List<int> ReadOrdinals(string text) =>
        [.. text.Split(',')
            .Select(part => int.TryParse(part, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : -1)
            .Where(n => n >= 0)
            .Distinct()];

    private static AnkiOcclusionShape? ParseBody(int index, List<int> ordinals, string body)
    {
        var tokens = SplitUnescaped(body);
        if (tokens.Count == 0 || ordinals.Count == 0)
            return null;

        var props = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var token in tokens.Skip(1))
        {
            var equals = token.IndexOf('=');
            if (equals > 0)
                props[token[..equals]] = Unescape(token[(equals + 1)..]);
        }

        var occlude = props.TryGetValue("oi", out var oi) && oi == "1";
        var angle = Number(props, "angle") is { } stored ? stored / 10_000d : 0d;

        switch (tokens[0])
        {
            case "rect":
                return Box(index, ordinals, AnkiShapeKind.Rect, props, Number(props, "width"), Number(props, "height"), angle, occlude);
            case "ellipse":
                return Box(index, ordinals, AnkiShapeKind.Ellipse, props, Number(props, "rx") * 2, Number(props, "ry") * 2, angle, occlude);
            case "polygon":
                return Polygon(index, ordinals, props, occlude);
            case "text":
                if (Number(props, "left") is not { } left || Number(props, "top") is not { } top)
                    return null;
                return new AnkiOcclusionShape(
                    index, ordinals, AnkiShapeKind.Text, left, top, 0, 0, [], 0, WebUtility.HtmlDecode(props.GetValueOrDefault("text", string.Empty)), occlude);
            default:
                return null;
        }
    }

    private static AnkiOcclusionShape? Box(
        int index,
        List<int> ordinals,
        AnkiShapeKind kind,
        Dictionary<string, string> props,
        double? width,
        double? height,
        double angle,
        bool occlude)
    {
        if (Number(props, "left") is not { } left || Number(props, "top") is not { } top
            || width is not > 0 || height is not > 0)
            return null;

        return new AnkiOcclusionShape(index, ordinals, kind, left, top, width.Value, height.Value, [], angle, string.Empty, occlude);
    }

    private static AnkiOcclusionShape? Polygon(int index, List<int> ordinals, Dictionary<string, string> props, bool occlude)
    {
        var points = new List<double[]>();
        foreach (var pair in props.GetValueOrDefault("points", string.Empty).Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split(',');
            if (parts.Length != 2 || ReadDouble(parts[0]) is not { } x || ReadDouble(parts[1]) is not { } y)
                return null;
            points.Add([x, y]);
        }

        if (points.Count < 3)
            return null;

        // Without a stored position the polygon was never moved, so it sits where its points say.
        var left = Number(props, "left") ?? points.Min(p => p[0]);
        var top = Number(props, "top") ?? points.Min(p => p[1]);
        return new AnkiOcclusionShape(index, ordinals, AnkiShapeKind.Polygon, left, top, 0, 0, points, 0, string.Empty, occlude);
    }

    private static double? Number(Dictionary<string, string> props, string key) =>
        props.TryGetValue(key, out var raw) ? ReadDouble(raw) : null;

    /// <summary>Anki trims zeros from both ends of a coordinate, so a shape at the edge is written as a lone ".".</summary>
    private static double? ReadDouble(string raw)
    {
        if (raw is "." or "-.")
            return 0;

        return double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && double.IsFinite(value)
            ? value
            : null;
    }

    /// <summary>Splits on colons that are not escaped, keeping the escapes for <see cref="Unescape"/>.</summary>
    private static List<string> SplitUnescaped(string body)
    {
        var tokens = new List<string>();
        var current = new StringBuilder();
        for (var i = 0; i < body.Length; i++)
        {
            if (body[i] == '\\' && i + 1 < body.Length)
            {
                current.Append(body[i]).Append(body[++i]);
            }
            else if (body[i] == ':')
            {
                tokens.Add(current.ToString());
                current.Clear();
            }
            else
            {
                current.Append(body[i]);
            }
        }

        tokens.Add(current.ToString());
        return tokens;
    }

    private static string Unescape(string value)
    {
        if (!value.Contains('\\'))
            return value;

        var sb = new StringBuilder(value.Length);
        for (var i = 0; i < value.Length; i++)
        {
            if (value[i] == '\\' && i + 1 < value.Length && value[i + 1] is '\\' or ':')
                i++;
            sb.Append(value[i]);
        }

        return sb.ToString();
    }
}
