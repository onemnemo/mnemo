using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Guards against the light swatch palette drifting out of sync with the web editor again. The web
/// editor resolves <c>swatch1</c>…<c>swatch10</c> through CSS custom properties in mnemo-web's
/// <c>tokens.css</c>; <see cref="NotePdfLightSwatches"/> is a hand kept C# copy of the same
/// light theme values for the PDF export path. Nothing in the build enforces that the two agree, and
/// that exact gap, one piece of data held in two languages with nothing asserting they match, has
/// already produced this defect three times. This test reads the actual CSS file at run time and
/// compares it against the C# table directly, rather than trusting either side to have stayed correct.
/// </summary>
public sealed class NotePdfLightSwatchesCssParityTests
{
    private const int SwatchCount = 10;

    /// <summary>
    /// How far one 8-bit channel may differ. The CSS is oklch and the table is hex, so the table was
    /// produced by a conversion whose last rounding step can land either side of a .5.
    /// </summary>
    private const int ChannelTolerance = 1;

    [Fact]
    public void LightPalette_MatchesTokensCss()
    {
        var cssPath = Path.Combine(RepositoryRoot(), "mnemo-web", "src", "styles", "tokens.css");
        Assert.True(File.Exists(cssPath), $"Expected the token file at {cssPath}.");

        var css = File.ReadAllText(cssPath);
        var lightBlock = ExtractLightThemeBlock(css);
        var neutralHue = ExtractNeutralHue(css);

        var expectedBackground = ExtractSwatchVariables(lightBlock, "color-swatch");
        var expectedForeground = ExtractSwatchVariables(lightBlock, "text-color-swatch");

        // A scan that found nothing found a broken parser, not an empty token file.
        Assert.True(expectedBackground.Count == SwatchCount,
            $"Expected {SwatchCount} --color-swatch-* entries in the light theme block, found {expectedBackground.Count}.");
        Assert.True(expectedForeground.Count == SwatchCount,
            $"Expected {SwatchCount} --text-color-swatch-* entries in the light theme block, found {expectedForeground.Count}.");

        AssertPaletteMatches("Background", "--color-swatch", expectedBackground, NotePdfLightSwatches.Background, neutralHue);
        AssertPaletteMatches("Foreground", "--text-color-swatch", expectedForeground, NotePdfLightSwatches.Foreground, neutralHue);
    }

    /// <summary>Compares every swatch1..swatch10 entry and names the exact swatch and both values on mismatch.</summary>
    private static void AssertPaletteMatches(
        string paletteName,
        string cssVariableStem,
        IReadOnlyDictionary<string, string> expectedByKey,
        IReadOnlyDictionary<string, string> actualByKey,
        string neutralHue)
    {
        for (var i = 1; i <= SwatchCount; i++)
        {
            var key = $"swatch{i}";
            Assert.True(expectedByKey.TryGetValue(key, out var expected),
                $"tokens.css has no light value for {cssVariableStem}-{i}.");
            Assert.True(actualByKey.TryGetValue(key, out var actual),
                $"NotePdfLightSwatches.{paletteName} has no entry for \"{key}\".");

            var cssRgb = OklchToRgb(expected.Replace("var(--neutral-hue)", neutralHue, StringComparison.Ordinal));
            var tableRgb = HexToRgb(actual);
            var drift = cssRgb.Zip(tableRgb, (a, b) => Math.Abs(a - b)).Max();
            Assert.True(
                drift <= ChannelTolerance,
                $"{paletteName} {key} has drifted: tokens.css light theme ({cssVariableStem}-{i}) is " +
                $"\"{expected}\" (#{cssRgb[0]:X2}{cssRgb[1]:X2}{cssRgb[2]:X2}) but " +
                $"NotePdfLightSwatches.{paletteName}[\"{key}\"] is \"{actual}\".");
        }
    }

    /// <summary>
    /// Isolates the <c>[data-theme="light"] { ... }</c> rule from the <c>[data-theme="dark"]</c>
    /// block that follows it in the same file. Comments are stripped first, and custom property values
    /// in this file never themselves contain braces, so matching innermost <c>{</c>/<c>}</c> pairs is
    /// enough; no full CSS parser is needed.
    /// </summary>
    private static string ExtractLightThemeBlock(string css)
    {
        foreach (Match block in Regex.Matches(StripComments(css), @"(?<selector>[^{}]+)\{(?<body>[^{}]*)\}"))
        {
            if (block.Groups["selector"].Value.Contains("[data-theme=\"light\"]", StringComparison.Ordinal))
                return block.Groups["body"].Value;
        }

        throw new InvalidOperationException("tokens.css has no [data-theme=\"light\"] block to parse.");
    }

    /// <summary>The grey swatch takes the app's neutral hue, declared once at the top of the file.</summary>
    private static string ExtractNeutralHue(string css)
    {
        var match = Regex.Match(StripComments(css), @"--neutral-hue\s*:\s*(?<value>[0-9.]+)\s*;");
        Assert.True(match.Success, "tokens.css declares no --neutral-hue.");
        return match.Groups["value"].Value;
    }

    private static string StripComments(string css) =>
        Regex.Replace(css, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);

    /// <summary>Reads every <c>--{stem}-N: value;</c> declaration in a CSS block into swatchN keys.</summary>
    private static Dictionary<string, string> ExtractSwatchVariables(string cssBlock, string variableStem)
    {
        var pattern = new Regex($@"--{Regex.Escape(variableStem)}-(?<index>\d+)\s*:\s*(?<value>[^;]+);");
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in pattern.Matches(cssBlock))
            result[$"swatch{match.Groups["index"].Value}"] = match.Groups["value"].Value.Trim();
        return result;
    }

    /// <summary>Converts <c>oklch(L C H)</c> to 8-bit sRGB, clipping any channel outside the gamut.</summary>
    private static int[] OklchToRgb(string value)
    {
        var match = Regex.Match(value, @"^oklch\(\s*(?<l>[0-9.]+)\s+(?<c>[0-9.]+)\s+(?<h>[0-9.]+)\s*\)$");
        Assert.True(match.Success, $"Expected a plain oklch(L C H) swatch value, found \"{value}\".");

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
        return linear.Select(v =>
        {
            v = Math.Clamp(v, 0, 1);
            var encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.Pow(v, 1 / 2.4) - 0.055;
            return (int)Math.Round(encoded * 255, MidpointRounding.AwayFromZero);
        }).ToArray();
    }

    private static int[] HexToRgb(string hex) =>
    [
        Convert.ToInt32(hex.Substring(1, 2), 16),
        Convert.ToInt32(hex.Substring(3, 2), 16),
        Convert.ToInt32(hex.Substring(5, 2), 16),
    ];

    /// <summary>
    /// The repository root, found relative to this file's own path rather than the working directory
    /// or the test's output folder, so a scratch OutDir used for a test run does not change where the
    /// scan looks.
    /// </summary>
    private static string RepositoryRoot([CallerFilePath] string here = "")
    {
        // <root>/Mnemo.Infrastructure.Tests/NotePdfLightSwatchesCssParityTests.cs
        var project = new DirectoryInfo(Path.GetDirectoryName(here)!);
        return project.Parent!.FullName;
    }
}
