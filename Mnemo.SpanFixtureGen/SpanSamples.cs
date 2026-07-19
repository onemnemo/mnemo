using System.Text;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.SpanFixtureGen;

/// <summary>
/// Pool of adversarial and random span-list / text / style shapes, all driven
/// off one SplitMix64 stream so a whole generation run is reproducible from
/// its seed alone.
/// </summary>
public static class SpanSamples
{
    private static readonly string[] Palette = { "#FF0000", "#00FF00", "#0000FF", "#FFD7AA" };

    private static readonly string[] Urls =
    {
        "https://example.com",
        "https://example.com/path?q=1",
        "www.example.org",
        "mailto:a@b.com",
        "https://foo.bar/baz#frag",
    };

    public enum TextFlavor { Empty, Ascii, AsciiSentence, Surrogate, Combining, Mixed, UrlPlain, UrlPunctuated }

    public static TextFlavor PickTextFlavor(ref SplitMix64 rng) => (TextFlavor)rng.NextInt(0, 8);

    public static string RandomText(ref SplitMix64 rng, TextFlavor flavor) => flavor switch
    {
        TextFlavor.Empty => "",
        TextFlavor.Ascii => RandomAsciiWord(ref rng, rng.NextInt(1, 8)),
        TextFlavor.AsciiSentence =>
            $"{RandomAsciiWord(ref rng, 3)} {RandomAsciiWord(ref rng, 4)}, {RandomAsciiWord(ref rng, 5)}!",
        TextFlavor.Surrogate => RandomAstral(ref rng, rng.NextInt(1, 4)),
        TextFlavor.Combining => RandomCombining(ref rng, rng.NextInt(1, 4)),
        TextFlavor.Mixed =>
            RandomAsciiWord(ref rng, 3) + RandomAstral(ref rng, 1) + RandomCombining(ref rng, 1) + RandomAsciiWord(ref rng, 2),
        TextFlavor.UrlPlain => rng.Pick(Urls),
        TextFlavor.UrlPunctuated => WrapUrl(ref rng, rng.Pick(Urls)),
        _ => "",
    };

    private static string WrapUrl(ref SplitMix64 rng, string url) => rng.NextInt(0, 5) switch
    {
        0 => $"see {url}.",
        1 => $"({url})",
        2 => $"\"{url}\"",
        3 => $"{url}, next",
        _ => $"check {url}!",
    };

    private static string RandomAsciiWord(ref SplitMix64 rng, int len)
    {
        const string alphabet = "abcdefghijklmnopqrstuvwxyz";
        var sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) sb.Append(alphabet[rng.NextInt(0, alphabet.Length)]);
        return sb.ToString();
    }

    // Astral codepoints (emoji + math-alphanumeric blocks) require a UTF-16
    // surrogate pair -- this is the exact case the port must not mis-slice.
    private static string RandomAstral(ref SplitMix64 rng, int count)
    {
        var sb = new StringBuilder();
        for (int i = 0; i < count; i++)
        {
            int codepoint = rng.NextBool() ? 0x1F300 + rng.NextInt(0, 0x300) : 0x1D400 + rng.NextInt(0, 0x40);
            sb.Append(char.ConvertFromUtf32(codepoint));
        }
        return sb.ToString();
    }

    // Combining acute/grave/diaeresis/cedilla/tilde -- escaped rather than
    // written as literal combining characters so the source stays readable.
    private static readonly char[] CombiningMarks = { '\u0301', '\u0300', '\u0308', '\u0327', '\u0303' };

    private static string RandomCombining(ref SplitMix64 rng, int count)
    {
        const string bases = "aeiouncAEIOUN";
        var sb = new StringBuilder();
        for (int i = 0; i < count; i++)
        {
            sb.Append(bases[rng.NextInt(0, bases.Length)]);
            int marks = rng.NextInt(1, 3);
            for (int m = 0; m < marks; m++) sb.Append(CombiningMarks[rng.NextInt(0, CombiningMarks.Length)]);
        }
        return sb.ToString();
    }

    private static readonly string[] StyleFieldNames =
    {
        "bold", "italic", "underline", "strikethrough", "code", "highlight",
        "backgroundColor", "foregroundColor", "linkUrl", "suppressAutoLink", "subscript", "superscript",
    };

    /// <summary>flavor 0 = TextStyle.Default; 1 = exactly one field flipped from default; else = fully random combination.</summary>
    public static TextStyle RandomStyle(ref SplitMix64 rng, int flavor)
    {
        if (flavor == 0) return TextStyle.Default;
        if (flavor == 1) return SetSingleField(TextStyle.Default, rng.Pick(StyleFieldNames), ref rng);

        return new TextStyle(
            Bold: rng.NextBool(0.3),
            Italic: rng.NextBool(0.3),
            Underline: rng.NextBool(0.3),
            Strikethrough: rng.NextBool(0.2),
            Code: rng.NextBool(0.2),
            Highlight: rng.NextBool(0.2),
            BackgroundColor: rng.NextBool(0.3) ? rng.Pick(Palette) : null,
            ForegroundColor: rng.NextBool(0.3) ? rng.Pick(Palette) : null,
            LinkUrl: rng.NextBool(0.2) ? rng.Pick(Urls) : null,
            SuppressAutoLink: rng.NextBool(0.15),
            Subscript: rng.NextBool(0.15),
            Superscript: rng.NextBool(0.15));
    }

    private static TextStyle SetSingleField(TextStyle style, string field, ref SplitMix64 rng) => field switch
    {
        "bold" => style with { Bold = true },
        "italic" => style with { Italic = true },
        "underline" => style with { Underline = true },
        "strikethrough" => style with { Strikethrough = true },
        "code" => style with { Code = true },
        "highlight" => style with { Highlight = true },
        "backgroundColor" => style with { BackgroundColor = rng.Pick(Palette) },
        "foregroundColor" => style with { ForegroundColor = rng.Pick(Palette) },
        "linkUrl" => style with { LinkUrl = rng.Pick(Urls) },
        "suppressAutoLink" => style with { SuppressAutoLink = true },
        "subscript" => style with { Subscript = true },
        "superscript" => style with { Superscript = true },
        _ => style,
    };

    private static readonly InlineFormatKind[] KindsWithEquation =
    {
        InlineFormatKind.Bold, InlineFormatKind.Italic, InlineFormatKind.Underline, InlineFormatKind.Strikethrough,
        InlineFormatKind.Highlight, InlineFormatKind.BackgroundColor, InlineFormatKind.ForegroundColor,
        InlineFormatKind.Code, InlineFormatKind.Subscript, InlineFormatKind.Superscript, InlineFormatKind.Link,
        InlineFormatKind.Equation,
    };

    public static (InlineFormatKind kind, string? color) RandomFormatKindAndColor(ref SplitMix64 rng)
    {
        var kind = rng.Pick(KindsWithEquation);
        string? color = kind switch
        {
            InlineFormatKind.BackgroundColor or InlineFormatKind.ForegroundColor => rng.NextBool(0.75) ? rng.Pick(Palette) : null,
            InlineFormatKind.Link => rng.NextBool(0.75) ? rng.Pick(Urls) : null,
            InlineFormatKind.Equation => rng.NextBool(0.5) ? "x^2 + " + rng.NextInt(0, 99) : null,
            // Ignored by the applier for boolean marks, but exercise it as noise anyway.
            _ => rng.NextBool(0.1) ? rng.Pick(Palette) : null,
        };
        return (kind, color);
    }

    public static string KindToWire(InlineFormatKind kind) => kind switch
    {
        InlineFormatKind.Bold => "bold",
        InlineFormatKind.Italic => "italic",
        InlineFormatKind.Underline => "underline",
        InlineFormatKind.Strikethrough => "strike",
        InlineFormatKind.Highlight => "highlight",
        InlineFormatKind.BackgroundColor => "bg",
        InlineFormatKind.ForegroundColor => "fg",
        InlineFormatKind.Code => "code",
        InlineFormatKind.Subscript => "sub",
        InlineFormatKind.Superscript => "sup",
        InlineFormatKind.Link => "link",
        InlineFormatKind.Equation => "equation",
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    private static InlineSpan RandomTextSpan(ref SplitMix64 rng, TextFlavor? forceFlavor = null, int styleFlavor = -1)
    {
        var flavor = forceFlavor ?? PickTextFlavor(ref rng);
        var sFlavor = styleFlavor >= 0 ? styleFlavor : rng.NextInt(0, 3);
        return new TextSpan(RandomText(ref rng, flavor), RandomStyle(ref rng, sFlavor));
    }

    private static InlineSpan RandomEquation(ref SplitMix64 rng) =>
        new EquationSpan(RandomText(ref rng, PickTextFlavor(ref rng)), RandomStyle(ref rng, rng.NextInt(0, 3)));

    // Denominator is always >= 1: wire.ts's parseSpan clamps a non-positive
    // denominator to 1 on parse, and the fixture's input spans must survive
    // that round trip unchanged for the C# and TS sides to agree on the input.
    private static InlineSpan RandomFraction(ref SplitMix64 rng) =>
        new FractionSpan(rng.NextInt(-50, 51), rng.NextInt(1, 13), RandomStyle(ref rng, rng.NextInt(0, 3)));

    private const int PoolSize = 21;

    /// <summary>
    /// The adversarial span-list pool. `seedIndex` rotates through every shape
    /// in turn so a full generation run visits each one many times over,
    /// rather than leaving pool coverage to chance.
    /// </summary>
    public static List<InlineSpan> BuildSpanList(ref SplitMix64 rng, int seedIndex)
    {
        int shape = ((seedIndex % PoolSize) + PoolSize) % PoolSize;
        return shape switch
        {
            0 => new List<InlineSpan>(),
            1 => new List<InlineSpan> { new TextSpan("", RandomStyle(ref rng, rng.NextInt(0, 3))) },
            2 => new List<InlineSpan> { RandomTextSpan(ref rng) },
            3 => AdjacentSameStyle(ref rng),
            4 => new List<InlineSpan> { RandomTextSpan(ref rng, styleFlavor: 2), RandomTextSpan(ref rng, styleFlavor: 2) },
            5 => AdjacentColors(ref rng, sameColor: true),
            6 => AdjacentColors(ref rng, sameColor: false),
            7 => new List<InlineSpan> { RandomEquation(ref rng), RandomTextSpan(ref rng) },
            8 => new List<InlineSpan> { RandomTextSpan(ref rng), RandomEquation(ref rng), RandomTextSpan(ref rng) },
            9 => new List<InlineSpan> { RandomTextSpan(ref rng), RandomEquation(ref rng) },
            10 => new List<InlineSpan> { RandomFraction(ref rng), RandomTextSpan(ref rng) },
            11 => new List<InlineSpan> { RandomTextSpan(ref rng), RandomFraction(ref rng), RandomTextSpan(ref rng) },
            12 => new List<InlineSpan> { RandomTextSpan(ref rng), RandomFraction(ref rng) },
            13 => new List<InlineSpan> { RandomEquation(ref rng), RandomFraction(ref rng), RandomEquation(ref rng) },
            14 => new List<InlineSpan> { RandomFraction(ref rng), RandomTextSpan(ref rng), RandomEquation(ref rng) },
            15 => new List<InlineSpan>
            {
                RandomTextSpan(ref rng, TextFlavor.Surrogate),
                RandomTextSpan(ref rng, TextFlavor.Ascii),
                RandomTextSpan(ref rng, TextFlavor.Surrogate),
            },
            16 => new List<InlineSpan> { RandomTextSpan(ref rng, TextFlavor.Combining), RandomTextSpan(ref rng, TextFlavor.Mixed) },
            17 => new List<InlineSpan> { new TextSpan(RandomText(ref rng, TextFlavor.UrlPunctuated), TextStyle.Default) },
            18 => new List<InlineSpan> { new TextSpan(RandomText(ref rng, TextFlavor.UrlPlain), TextStyle.Default with { Code = true }) },
            19 => AlreadyLinked(ref rng),
            20 => LargeRandomMix(ref rng),
            _ => new List<InlineSpan> { RandomTextSpan(ref rng) },
        };
    }

    private static List<InlineSpan> AdjacentSameStyle(ref SplitMix64 rng)
    {
        var style = RandomStyle(ref rng, rng.NextInt(0, 3));
        return new List<InlineSpan>
        {
            new TextSpan(RandomText(ref rng, PickTextFlavor(ref rng)), style),
            new TextSpan(RandomText(ref rng, PickTextFlavor(ref rng)), style),
            new TextSpan(RandomText(ref rng, PickTextFlavor(ref rng)), style),
        };
    }

    private static List<InlineSpan> AdjacentColors(ref SplitMix64 rng, bool sameColor)
    {
        bool bg = rng.NextBool();
        var c1 = rng.Pick(Palette);
        string c2 = sameColor ? c1 : NextDifferent(ref rng, c1);
        var s1 = bg ? TextStyle.Default with { BackgroundColor = c1 } : TextStyle.Default with { ForegroundColor = c1 };
        var s2 = bg ? TextStyle.Default with { BackgroundColor = c2 } : TextStyle.Default with { ForegroundColor = c2 };
        return new List<InlineSpan>
        {
            new TextSpan(RandomText(ref rng, PickTextFlavor(ref rng)), s1),
            new TextSpan(RandomText(ref rng, PickTextFlavor(ref rng)), s2),
        };
    }

    private static string NextDifferent(ref SplitMix64 rng, string exclude)
    {
        string next;
        do { next = rng.Pick(Palette); } while (next == exclude);
        return next;
    }

    private static List<InlineSpan> AlreadyLinked(ref SplitMix64 rng)
    {
        var url = rng.Pick(Urls);
        var existing = rng.NextBool() ? url : rng.Pick(Urls); // same href vs a different one, edge to edge
        return new List<InlineSpan> { new TextSpan(url, TextStyle.Default with { LinkUrl = existing }) };
    }

    private static List<InlineSpan> LargeRandomMix(ref SplitMix64 rng)
    {
        int n = rng.NextInt(6, 16);
        var list = new List<InlineSpan>(n);
        for (int i = 0; i < n; i++)
        {
            list.Add(rng.NextInt(0, 10) switch
            {
                0 => RandomEquation(ref rng),
                1 => RandomFraction(ref rng),
                _ => RandomTextSpan(ref rng),
            });
        }
        return list;
    }

    /// <summary>Generates an (oldText, newText) pair for ApplyTextEdit, weighted toward realistic single edits.</summary>
    public static (string oldText, string newText) RandomTextEditPair(ref SplitMix64 rng, IReadOnlyList<InlineSpan> spans)
    {
        string flat = InlineSpanText.FlattenEditing(spans);
        switch (rng.NextInt(0, 5))
        {
            case 0: // no-op
                return (flat, flat);
            case 1: // pure insertion at a random offset (may land inside a surrogate pair)
            {
                int pos = rng.NextInt(0, flat.Length + 1);
                string ins = RandomText(ref rng, PickTextFlavor(ref rng));
                return (flat, flat[..pos] + ins + flat[pos..]);
            }
            case 2: // pure deletion of a random range
            {
                if (flat.Length == 0) return (flat, flat);
                int a = rng.NextInt(0, flat.Length);
                int b = rng.NextInt(a, flat.Length + 1);
                return (flat, flat[..a] + flat[b..]);
            }
            case 3: // replace a random range
            {
                int a = rng.NextInt(0, flat.Length + 1);
                int b = rng.NextInt(a, flat.Length + 1);
                string ins = RandomText(ref rng, PickTextFlavor(ref rng));
                return (flat, flat[..a] + ins + flat[b..]);
            }
            default: // fully unrelated pair -- adversarial, ignores the spans' own text entirely
            {
                string a = RandomText(ref rng, PickTextFlavor(ref rng));
                string b = RandomText(ref rng, PickTextFlavor(ref rng));
                return (a, b);
            }
        }
    }
}
