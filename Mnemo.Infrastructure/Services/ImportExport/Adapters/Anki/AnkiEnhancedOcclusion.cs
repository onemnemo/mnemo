using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

/// <summary>
/// Reads notes of the Image Occlusion Enhanced add-on, which keeps one note per card and draws
/// its masks as SVG files rather than as cloze shapes.
/// </summary>
/// <summary>The add-on's fields in one note type, as positions in the note's fields.</summary>
internal sealed record EnhancedLayout(int Id, int Image, int QuestionMask, int OriginalMask, int? Header, IReadOnlyList<int> Back);

internal static partial class AnkiEnhancedOcclusion
{
    public const string IdFieldName = "ID (hidden)";
    public const string ImageFieldName = "Image";
    public const string HeaderFieldName = "Header";
    public const string QuestionMaskFieldName = "Question Mask";
    public const string OriginalMaskFieldName = "Original Mask";

    /// <summary>The fields shown under the picture on the answer, in the add-on's order.</summary>
    public static readonly string[] BackFieldNames = ["Footer", "Remarks", "Sources", "Extra 1", "Extra 2"];

    /// <summary>The add-on paints the shape being asked in this colour, which is the only mark a re-saved SVG keeps.</summary>
    private const string QuestionFill = "#ff7e7e";
    private const string QuestionClass = "qshape";
    private const int EllipseSegments = 32;
    private const double Epsilon = 1e-6;

    [GeneratedRegex(@"^\s*(?<set>[0-9A-Za-z]+-(?<mode>ao|oa))-(?<ord>\d+)\s*$")]
    private static partial Regex IdRegex();

    [GeneratedRegex(@"-(?:ao|oa)-(?<ord>\d+)$")]
    private static partial Regex ShapeIdRegex();

    [GeneratedRegex(@"(?<name>[a-zA-Z]+)\s*\((?<args>[^)]*)\)")]
    private static partial Regex TransformRegex();

    [GeneratedRegex(@"[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")]
    private static partial Regex PathTokenRegex();

    [GeneratedRegex(@"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")]
    private static partial Regex NumberRegex();

    [GeneratedRegex(@"-(?:ao|oa)-\d+-Q\.svg", RegexOptions.IgnoreCase)]
    private static partial Regex QuestionMaskFileRegex();

    [GeneratedRegex(@"-(?:ao|oa)-O\.svg", RegexOptions.IgnoreCase)]
    private static partial Regex OriginalMaskFileRegex();

    [GeneratedRegex(@"-(?:ao|oa)-\d+-A\.svg", RegexOptions.IgnoreCase)]
    private static partial Regex AnswerMaskFileRegex();

    /// <summary>
    /// Where the add-on's fields sit in a note type: by the add-on's names, or by what they hold where
    /// renamed. Null for any other note type.
    /// </summary>
    /// <param name="notes">The fields of the type's notes, which give a renamed field away.</param>
    public static EnhancedLayout? Layout(AnkiNoteType type, IReadOnlyList<string[]> notes)
    {
        if (type.IsImageOcclusion || notes.Count == 0)
            return null;

        int? ByContent(Func<string, bool> holds)
        {
            for (var i = 0; i < type.FieldNames.Count; i++)
            {
                if (notes.Any(fields => i < fields.Length && holds(fields[i])))
                    return i;
            }

            return null;
        }

        var question = FieldIndex(type, QuestionMaskFieldName) ?? ByContent(QuestionMaskFileRegex().IsMatch);
        var original = FieldIndex(type, OriginalMaskFieldName) ?? ByContent(OriginalMaskFileRegex().IsMatch);
        var id = FieldIndex(type, IdFieldName) ?? ByContent(value => ReadId(value) is not null);
        if (question is not { } q || original is not { } o || id is not { } i)
            return null;

        // The add-on puts the picture just ahead of the question mask.
        var image = FieldIndex(type, ImageFieldName);
        for (var f = q - 1; image is null && f >= 0; f--)
        {
            if (f != i && notes.Any(fields => f < fields.Length && fields[f].Contains("<img", StringComparison.OrdinalIgnoreCase)))
                image = f;
        }

        if (image is not { } picture || new[] { i, picture, q, o }.Distinct().Count() != 4)
            return null;

        // Renamed text fields keep the add-on's order: the header just ahead of the picture, and the
        // back fields between the question mask and the next mask.
        var header = FieldIndex(type, HeaderFieldName) ?? (picture - 1 >= 0 && picture - 1 != i ? picture - 1 : null);
        var back = BackFieldNames.Select(name => FieldIndex(type, name)).OfType<int>().ToArray();
        if (back.Length == 0)
        {
            var answer = ByContent(AnswerMaskFileRegex().IsMatch);
            var end = new[] { o, answer ?? o }.Where(f => f > q).DefaultIfEmpty(type.FieldNames.Count).Min();
            back = [.. Enumerable.Range(q + 1, Math.Max(0, end - q - 1)).Where(f => f != i && f != picture && f != header)];
        }

        return new EnhancedLayout(i, picture, q, o, header, back);
    }

    public static int? FieldIndex(AnkiNoteType type, string name)
    {
        for (var i = 0; i < type.FieldNames.Count; i++)
        {
            if (string.Equals(type.FieldNames[i].Trim(), name, StringComparison.OrdinalIgnoreCase))
                return i;
        }

        return null;
    }

    /// <summary>The set a note belongs to and its card's number in it, as the ID field writes them: <c>uuid-ao-3</c>.</summary>
    /// <returns>HideOne is true for the add-on's "hide one, guess one" mode, written <c>oa</c>.</returns>
    public static (string SetId, bool HideOne, int Ordinal)? ReadId(string? field)
    {
        var match = IdRegex().Match(field ?? string.Empty);
        if (!match.Success
            || !int.TryParse(match.Groups["ord"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var ordinal)
            || ordinal <= 0)
            return null;

        return (match.Groups["set"].Value.ToLowerInvariant(), match.Groups["mode"].Value == "oa", ordinal);
    }

    /// <summary>
    /// Each card's shapes as fractions of the picture. A card's question mask marks its own
    /// shapes; the original mask, whose shapes carry the card's id, stands in when it does not.
    /// </summary>
    public static IReadOnlyList<AnkiOcclusionShape> Shapes(
        IReadOnlyDictionary<int, string?> questionSvgByOrdinal, string? originalSvg, bool hideOne)
    {
        var shapes = new List<AnkiOcclusionShape>();
        var original = Load(originalSvg);
        foreach (var (ordinal, svg) in questionSvgByOrdinal.OrderBy(pair => pair.Key))
        {
            var question = Load(svg);
            var found = question is null
                ? []
                : question.Leaves.Where(l => l.IsQuestion && l.Element.Name.LocalName != "text").Select(l => (question, l)).ToList();
            if (found.Count == 0 && original is not null)
                found = [.. original.Leaves.Where(l => l.Ordinal == ordinal && l.Element.Name.LocalName != "text").Select(l => (original, l))];

            foreach (var (doc, leaf) in found)
            {
                if (ToShape(shapes.Count, ordinal, doc, leaf, hideOne) is { } shape)
                    shapes.Add(shape);
            }
        }

        if (original is not null)
        {
            foreach (var leaf in original.Leaves.Where(l => l.Element.Name.LocalName == "text"))
            {
                var text = leaf.Element.Value.Trim();
                var (x, y) = leaf.Transform.Apply(Number(leaf.Element, "x") ?? 0, Number(leaf.Element, "y") ?? 0);
                if (text.Length > 0)
                    shapes.Add(new AnkiOcclusionShape(
                        shapes.Count, [0], AnkiShapeKind.Text, x / original.Width, y / original.Height, 0, 0, [], 0, text, !hideOne));
            }
        }

        return shapes;
    }

    private sealed record SvgDoc(double Width, double Height, IReadOnlyList<Leaf> Leaves);

    private sealed record Leaf(XElement Element, Affine Transform, bool IsQuestion, int? Ordinal);

    private static SvgDoc? Load(string? svg)
    {
        if (string.IsNullOrWhiteSpace(svg))
            return null;

        XElement root;
        try
        {
            using var reader = XmlReader.Create(
                new StringReader(svg), new XmlReaderSettings { DtdProcessing = DtdProcessing.Ignore, XmlResolver = null });
            root = XElement.Load(reader);
        }
        catch (XmlException)
        {
            return null;
        }

        if (root.Name.LocalName != "svg")
            return null;

        var viewBox = (root.Attribute("viewBox")?.Value ?? string.Empty)
            .Split([' ', ','], StringSplitOptions.RemoveEmptyEntries)
            .Select(ReadDouble)
            .ToArray();
        var width = Number(root, "width") ?? (viewBox.Length == 4 ? viewBox[2] : null);
        var height = Number(root, "height") ?? (viewBox.Length == 4 ? viewBox[3] : null);
        if (width is not > 0 || height is not > 0)
            return null;

        var leaves = new List<Leaf>();
        Walk(root, Affine.Identity, fill: null, marked: false, ordinal: null, leaves);
        return new SvgDoc(width.Value, height.Value, leaves);
    }

    /// <param name="marked">Whether an ancestor carries the question class, which holds whatever fill a child sets.</param>
    private static void Walk(XElement element, Affine parent, string? fill, bool marked, int? ordinal, List<Leaf> leaves)
    {
        foreach (var child in element.Elements())
        {
            var name = child.Name.LocalName;
            if (name is "defs" or "title" or "desc" or "metadata" or "clipPath" or "mask" or "style")
                continue;

            var transform = parent.Then(ParseTransform(child.Attribute("transform")?.Value));
            var childFill = Fill(child) ?? fill;
            var childMarked = marked || (child.Attribute("class")?.Value ?? string.Empty).Split(' ').Contains(QuestionClass);
            var idMatch = ShapeIdRegex().Match(child.Attribute("id")?.Value ?? string.Empty);
            var childOrdinal = idMatch.Success
                && int.TryParse(idMatch.Groups["ord"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var n)
                ? n
                : ordinal;

            if (name is "g" or "a" or "svg")
            {
                Walk(child, transform, childFill, childMarked, childOrdinal, leaves);
            }
            else if (name is "rect" or "ellipse" or "circle" or "polygon" or "polyline" or "path" or "text")
            {
                var question = childMarked || string.Equals(childFill, QuestionFill, StringComparison.OrdinalIgnoreCase);
                leaves.Add(new Leaf(child, transform, question, childOrdinal));
            }
        }
    }

    private static string? Fill(XElement element)
    {
        var style = element.Attribute("style")?.Value;
        if (style is not null)
        {
            foreach (var part in style.Split(';'))
            {
                var colon = part.IndexOf(':');
                if (colon > 0 && part[..colon].Trim() == "fill")
                    return part[(colon + 1)..].Trim();
            }
        }

        return element.Attribute("fill")?.Value.Trim();
    }

    private static AnkiOcclusionShape? ToShape(int index, int ordinal, SvgDoc doc, Leaf leaf, bool hideOne)
    {
        var e = leaf.Element;
        var m = leaf.Transform;
        List<(double X, double Y)> points;
        switch (e.Name.LocalName)
        {
            case "rect":
            {
                if (Number(e, "width") is not { } w || Number(e, "height") is not { } h || w <= 0 || h <= 0)
                    return null;
                var x = Number(e, "x") ?? 0;
                var y = Number(e, "y") ?? 0;
                points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)];
                break;
            }
            case "ellipse" or "circle":
            {
                var rx = e.Name.LocalName == "circle" ? Number(e, "r") : Number(e, "rx");
                var ry = e.Name.LocalName == "circle" ? Number(e, "r") : Number(e, "ry");
                if (rx is not > 0 || ry is not > 0)
                    return null;
                var cx = Number(e, "cx") ?? 0;
                var cy = Number(e, "cy") ?? 0;
                if (m.IsAxisAligned)
                {
                    var (l, t) = m.Apply(cx - rx.Value, cy - ry.Value);
                    var (r, b) = m.Apply(cx + rx.Value, cy + ry.Value);
                    return Box(index, ordinal, AnkiShapeKind.Ellipse, doc, l, t, r, b, hideOne);
                }

                points = [.. Enumerable.Range(0, EllipseSegments).Select(i =>
                {
                    var a = 2 * Math.PI * i / EllipseSegments;
                    return (cx + rx.Value * Math.Cos(a), cy + ry.Value * Math.Sin(a));
                })];
                break;
            }
            case "polygon" or "polyline":
            {
                var numbers = NumberRegex().Matches(e.Attribute("points")?.Value ?? string.Empty)
                    .Select(n => ReadDouble(n.Value) ?? double.NaN).ToArray();
                points = [.. Enumerable.Range(0, numbers.Length / 2).Select(i => (numbers[2 * i], numbers[2 * i + 1]))];
                break;
            }
            default:
                points = PathPoints(e.Attribute("d")?.Value ?? string.Empty);
                break;
        }

        var placed = Distinct(points.Select(p => m.Apply(p.X, p.Y)));
        if (placed.Count < 3 || placed.Any(p => !double.IsFinite(p.X) || !double.IsFinite(p.Y)))
            return null;

        var xs = placed.Select(p => p.X).ToArray();
        var ys = placed.Select(p => p.Y).ToArray();
        var isBox = placed.Count == 4
            && placed.All(p => Near(p.X, xs.Min()) || Near(p.X, xs.Max()))
            && placed.All(p => Near(p.Y, ys.Min()) || Near(p.Y, ys.Max()));
        if (isBox)
            return Box(index, ordinal, AnkiShapeKind.Rect, doc, xs.Min(), ys.Min(), xs.Max(), ys.Max(), hideOne);

        var fractions = placed.Select(p => new[] { p.X / doc.Width, p.Y / doc.Height }).ToArray();
        return new AnkiOcclusionShape(
            index, [ordinal], AnkiShapeKind.Polygon, fractions.Min(p => p[0]), fractions.Min(p => p[1]), 0, 0, fractions, 0, string.Empty, !hideOne);
    }

    private static AnkiOcclusionShape? Box(
        int index, int ordinal, AnkiShapeKind kind, SvgDoc doc, double x1, double y1, double x2, double y2, bool hideOne)
    {
        var (left, right) = (Math.Min(x1, x2), Math.Max(x1, x2));
        var (top, bottom) = (Math.Min(y1, y2), Math.Max(y1, y2));
        if (right - left <= Epsilon || bottom - top <= Epsilon)
            return null;

        return new AnkiOcclusionShape(
            index, [ordinal], kind, left / doc.Width, top / doc.Height, (right - left) / doc.Width, (bottom - top) / doc.Height,
            [], 0, string.Empty, !hideOne);
    }

    /// <summary>The vertices a path passes through. Curves keep only their end points, which is close enough for a mask.</summary>
    private static List<(double X, double Y)> PathPoints(string d)
    {
        var points = new List<(double X, double Y)>();
        var tokens = PathTokenRegex().Matches(d).Select(t => t.Value).ToArray();
        var (x, y) = (0d, 0d);
        var (startX, startY) = (0d, 0d);
        var command = 'M';
        var i = 0;

        double Next()
        {
            if (i >= tokens.Length || ReadDouble(tokens[i]) is not { } value)
                return double.NaN;
            i++;
            return value;
        }

        while (i < tokens.Length)
        {
            if (char.IsLetter(tokens[i][0]))
                command = tokens[i++][0];
            else if (command is 'M' or 'm')
                command = command == 'M' ? 'L' : 'l';

            var relative = char.IsLower(command);
            switch (char.ToUpperInvariant(command))
            {
                case 'Z':
                    (x, y) = (startX, startY);
                    continue;
                case 'M':
                case 'L':
                case 'T':
                    (x, y) = Move(relative, x, y, Next(), Next());
                    if (char.ToUpperInvariant(command) == 'M')
                        (startX, startY) = (x, y);
                    break;
                case 'H':
                    x = relative ? x + Next() : Next();
                    break;
                case 'V':
                    y = relative ? y + Next() : Next();
                    break;
                case 'C':
                    Skip(4);
                    (x, y) = Move(relative, x, y, Next(), Next());
                    break;
                case 'S':
                case 'Q':
                    Skip(2);
                    (x, y) = Move(relative, x, y, Next(), Next());
                    break;
                case 'A':
                    Skip(5);
                    (x, y) = Move(relative, x, y, Next(), Next());
                    break;
                default:
                    return points;
            }

            if (!double.IsFinite(x) || !double.IsFinite(y))
                return [];
            points.Add((x, y));
        }

        return points;

        void Skip(int count) => i = Math.Min(tokens.Length, i + count);
    }

    private static (double X, double Y) Move(bool relative, double x, double y, double dx, double dy) =>
        relative ? (x + dx, y + dy) : (dx, dy);

    private static List<(double X, double Y)> Distinct(IEnumerable<(double X, double Y)> points)
    {
        var kept = new List<(double X, double Y)>();
        foreach (var p in points)
        {
            if (kept.Count > 0 && Near(kept[^1].X, p.X) && Near(kept[^1].Y, p.Y))
                continue;
            kept.Add(p);
        }

        if (kept.Count > 1 && Near(kept[0].X, kept[^1].X) && Near(kept[0].Y, kept[^1].Y))
            kept.RemoveAt(kept.Count - 1);
        return kept;
    }

    private static bool Near(double a, double b) => Math.Abs(a - b) <= Epsilon * Math.Max(1, Math.Abs(a));

    private static Affine ParseTransform(string? value)
    {
        var result = Affine.Identity;
        if (string.IsNullOrWhiteSpace(value))
            return result;

        foreach (Match match in TransformRegex().Matches(value))
        {
            var a = NumberRegex().Matches(match.Groups["args"].Value).Select(n => ReadDouble(n.Value) ?? 0).ToArray();
            double At(int k, double fallback = 0) => k < a.Length ? a[k] : fallback;
            var step = match.Groups["name"].Value switch
            {
                "matrix" when a.Length == 6 => new Affine(a[0], a[1], a[2], a[3], a[4], a[5]),
                "translate" => new Affine(1, 0, 0, 1, At(0), At(1)),
                "scale" => new Affine(At(0, 1), 0, 0, At(1, At(0, 1)), 0, 0),
                "rotate" => Affine.Rotate(At(0), At(1), At(2)),
                "skewX" => new Affine(1, 0, Math.Tan(At(0) * Math.PI / 180), 1, 0, 0),
                "skewY" => new Affine(1, Math.Tan(At(0) * Math.PI / 180), 0, 1, 0, 0),
                _ => Affine.Identity,
            };
            result = result.Then(step);
        }

        return result;
    }

    private static double? Number(XElement element, string attribute)
    {
        var raw = element.Attribute(attribute)?.Value.Trim();
        if (raw is null)
            return null;
        if (raw.EndsWith("px", StringComparison.OrdinalIgnoreCase))
            raw = raw[..^2];
        return ReadDouble(raw);
    }

    private static double? ReadDouble(string raw) =>
        double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && double.IsFinite(value)
            ? value
            : null;

    /// <summary>An SVG transform matrix: x' = A x + C y + E, y' = B x + D y + F.</summary>
    private readonly record struct Affine(double A, double B, double C, double D, double E, double F)
    {
        public static readonly Affine Identity = new(1, 0, 0, 1, 0, 0);

        public bool IsAxisAligned => Math.Abs(B) < Epsilon && Math.Abs(C) < Epsilon;

        public static Affine Rotate(double degrees, double cx, double cy)
        {
            var r = degrees * Math.PI / 180;
            var (cos, sin) = (Math.Cos(r), Math.Sin(r));
            return new Affine(1, 0, 0, 1, cx, cy)
                .Then(new Affine(cos, sin, -sin, cos, 0, 0))
                .Then(new Affine(1, 0, 0, 1, -cx, -cy));
        }

        /// <summary>This transform applied after <paramref name="inner"/>, as nested SVG transforms compose.</summary>
        public Affine Then(Affine inner) => new(
            A * inner.A + C * inner.B,
            B * inner.A + D * inner.B,
            A * inner.C + C * inner.D,
            B * inner.C + D * inner.D,
            A * inner.E + C * inner.F + E,
            B * inner.E + D * inner.F + F);

        public (double X, double Y) Apply(double x, double y) => (A * x + C * y + E, B * x + D * y + F);
    }
}
