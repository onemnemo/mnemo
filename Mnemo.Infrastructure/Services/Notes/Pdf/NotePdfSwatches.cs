using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// The inline <c>swatch1</c>…<c>swatch10</c> colours for an exported PDF, read from the web app's
/// own token file. PDF pages are always light, so a note written in the dark theme still resolves
/// its swatches against the light palette rather than painting dark colours on white paper.
/// </summary>
/// <remarks>
/// <c>mnemo-web/src/styles/tokens.css</c> is compiled into this assembly, so the export follows the
/// editor with nothing to keep in step by hand. The tokens are oklch; Typst and the sketch renderer
/// take hex, so each is converted to sRGB once, on first use.
/// </remarks>
public static class NotePdfSwatches
{
    private const string ResourceName = "Mnemo.Infrastructure.Notes.Pdf.tokens.css";
    private const int SwatchCount = 10;

    private static readonly Lazy<(IReadOnlyDictionary<string, string> Background, IReadOnlyDictionary<string, string> Foreground)> Palette =
        new(() => Parse(ReadTokens()));

    /// <summary>Background swatch keys to <c>#RRGGBB</c>, from <c>--color-swatch-N</c> in the light theme.</summary>
    public static IReadOnlyDictionary<string, string> Background => Palette.Value.Background;

    /// <summary>Text swatch keys to <c>#RRGGBB</c>, from <c>--text-color-swatch-N</c> in the light theme.</summary>
    public static IReadOnlyDictionary<string, string> Foreground => Palette.Value.Foreground;

    private static string ReadTokens()
    {
        using var stream = typeof(NotePdfSwatches).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The embedded token file {ResourceName} is missing.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    internal static (IReadOnlyDictionary<string, string> Background, IReadOnlyDictionary<string, string> Foreground) Parse(string css)
    {
        var withoutComments = Regex.Replace(css, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);

        var hue = Regex.Match(withoutComments, @"--neutral-hue\s*:\s*(?<value>[0-9.]+)\s*;");
        if (!hue.Success)
            throw new InvalidOperationException("tokens.css declares no --neutral-hue.");

        // Custom property values in this file never contain braces, so the innermost brace pairs
        // are exactly the rule bodies.
        var light = Regex.Matches(withoutComments, @"(?<selector>[^{}]+)\{(?<body>[^{}]*)\}")
            .FirstOrDefault(block => block.Groups["selector"].Value.Contains("[data-theme=\"light\"]", StringComparison.Ordinal))
            ?.Groups["body"].Value
            ?? throw new InvalidOperationException("tokens.css has no [data-theme=\"light\"] block.");

        var neutralHue = hue.Groups["value"].Value;
        return (Swatches(light, "color-swatch", neutralHue), Swatches(light, "text-color-swatch", neutralHue));
    }

    private static Dictionary<string, string> Swatches(string block, string stem, string neutralHue)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var pattern = new Regex($@"(?<![\w-])--{Regex.Escape(stem)}-(?<index>\d+)\s*:\s*(?<value>[^;]+);");
        foreach (Match match in pattern.Matches(block))
        {
            var value = match.Groups["value"].Value.Trim().Replace("var(--neutral-hue)", neutralHue, StringComparison.Ordinal);
            result[$"swatch{match.Groups["index"].Value}"] = OklchToHex(value);
        }

        if (result.Count != SwatchCount)
            throw new InvalidOperationException($"Expected {SwatchCount} --{stem}-* entries in the light theme, found {result.Count}.");
        return result;
    }

    /// <summary>Converts <c>oklch(L C H)</c> to <c>#RRGGBB</c>, clipping any channel outside sRGB.</summary>
    internal static string OklchToHex(string value)
    {
        var match = Regex.Match(value, @"^oklch\(\s*(?<l>[0-9.]+)\s+(?<c>[0-9.]+)\s+(?<h>[0-9.]+)\s*\)$");
        if (!match.Success)
            throw new InvalidOperationException($"Expected a plain oklch(L C H) swatch value, found \"{value}\".");

        var l = double.Parse(match.Groups["l"].Value, CultureInfo.InvariantCulture);
        var c = double.Parse(match.Groups["c"].Value, CultureInfo.InvariantCulture);
        var h = double.Parse(match.Groups["h"].Value, CultureInfo.InvariantCulture) * Math.PI / 180;
        var a = c * Math.Cos(h);
        var b = c * Math.Sin(h);

        var lp = Math.Pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
        var mp = Math.Pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
        var sp = Math.Pow(l - 0.0894841775 * a - 1.2914855480 * b, 3);

        double[] linear =
        [
            4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
            -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
            -0.0041960863 * lp - 0.7034186147 * mp + 1.7076147010 * sp,
        ];
        return "#" + string.Concat(linear.Select(channel =>
        {
            channel = Math.Clamp(channel, 0, 1);
            var encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.Pow(channel, 1 / 2.4) - 0.055;
            return ((int)Math.Round(encoded * 255, MidpointRounding.AwayFromZero)).ToString("X2", CultureInfo.InvariantCulture);
        }));
    }
}
