using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Guards against the light swatch palette drifting out of sync with the web editor again. The web
/// editor resolves <c>swatch1</c>…<c>swatch10</c> through CSS custom properties in mnemo-web's
/// <c>legacy-tokens.css</c>; <see cref="NotePdfLightSwatches"/> is a hand kept C# copy of the same
/// light theme values for the PDF export path. Nothing in the build enforces that the two agree, and
/// that exact gap, one piece of data held in two languages with nothing asserting they match, has
/// already produced this defect three times. This test reads the actual CSS file at run time and
/// compares it against the C# table directly, rather than trusting either side to have stayed correct.
/// </summary>
public sealed class NotePdfLightSwatchesCssParityTests
{
    private const int SwatchCount = 10;

    [Fact]
    public void LightPalette_MatchesLegacyTokensCss()
    {
        var cssPath = Path.Combine(RepositoryRoot(), "mnemo-web", "src", "styles", "legacy-tokens.css");
        Assert.True(File.Exists(cssPath), $"Expected the token file at {cssPath}.");

        var lightBlock = ExtractLightThemeBlock(File.ReadAllText(cssPath));

        var expectedBackground = ExtractSwatchVariables(lightBlock, "color-swatch");
        var expectedForeground = ExtractSwatchVariables(lightBlock, "text-color-swatch");

        // A scan that found nothing found a broken parser, not an empty token file.
        Assert.True(expectedBackground.Count == SwatchCount,
            $"Expected {SwatchCount} --color-swatch-* entries in the light theme block, found {expectedBackground.Count}.");
        Assert.True(expectedForeground.Count == SwatchCount,
            $"Expected {SwatchCount} --text-color-swatch-* entries in the light theme block, found {expectedForeground.Count}.");

        AssertPaletteMatches("Background", "--color-swatch", expectedBackground, NotePdfLightSwatches.Background);
        AssertPaletteMatches("Foreground", "--text-color-swatch", expectedForeground, NotePdfLightSwatches.Foreground);
    }

    /// <summary>Compares every swatch1..swatch10 entry and names the exact swatch and both values on mismatch.</summary>
    private static void AssertPaletteMatches(
        string paletteName,
        string cssVariableStem,
        IReadOnlyDictionary<string, string> expectedByKey,
        IReadOnlyDictionary<string, string> actualByKey)
    {
        for (var i = 1; i <= SwatchCount; i++)
        {
            var key = $"swatch{i}";
            Assert.True(expectedByKey.TryGetValue(key, out var expected),
                $"legacy-tokens.css has no light value for {cssVariableStem}-{i}.");
            Assert.True(actualByKey.TryGetValue(key, out var actual),
                $"NotePdfLightSwatches.{paletteName} has no entry for \"{key}\".");
            Assert.True(
                string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase),
                $"{paletteName} {key} has drifted: legacy-tokens.css light theme ({cssVariableStem}-{i}) is " +
                $"\"{expected}\" but NotePdfLightSwatches.{paletteName}[\"{key}\"] is \"{actual}\".");
        }
    }

    /// <summary>
    /// Isolates the <c>:root, [data-theme="light"] { ... }</c> rule from the <c>[data-theme="dark"]</c>
    /// override block that follows it in the same file. Comments are stripped first (one of them, around
    /// the toast tokens, contains a literal <c>{kind}</c> that would otherwise confuse a brace count),
    /// and custom property values in this file never themselves contain braces, so splitting on the
    /// outermost <c>{</c>/<c>}</c> pair is enough; no full CSS parser is needed.
    /// </summary>
    private static string ExtractLightThemeBlock(string css)
    {
        var withoutComments = Regex.Replace(css, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);

        foreach (Match block in Regex.Matches(withoutComments, @"(?<selector>[^{}]+)\{(?<body>[^{}]*)\}"))
        {
            if (block.Groups["selector"].Value.Contains("[data-theme=\"light\"]", StringComparison.Ordinal))
                return block.Groups["body"].Value;
        }

        throw new InvalidOperationException("legacy-tokens.css has no [data-theme=\"light\"] block to parse.");
    }

    /// <summary>Reads every <c>--{stem}-N: value;</c> declaration in a CSS block into swatchN keys.</summary>
    private static Dictionary<string, string> ExtractSwatchVariables(string cssBlock, string variableStem)
    {
        var pattern = new Regex($@"--{Regex.Escape(variableStem)}-(?<index>\d+)\s*:\s*(?<value>[^;]+);");
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in pattern.Matches(cssBlock))
            result[$"swatch{match.Groups["index"].Value}"] = match.Groups["value"].Value.Trim();
        return result;
    }

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
