using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Avalonia.Platform;
using Mnemo.Core.Services;

namespace Mnemo.UI.Services;

/// <summary>
/// PDF pages are always light; inline <c>swatch1</c>…<c>swatch10</c> tokens use the Dawn palette
/// so Dusk/Noon editor themes do not paint dark swatches on white paper.
/// </summary>
/// <remarks>
/// Reads the live Dawn values from <c>Colors.axaml</c> and falls back to the shared
/// <see cref="NotePdfDawnSwatches"/> table when that read fails. The web host has no Avalonia
/// resources and uses that shared table directly.
/// </remarks>
internal static class PdfExportDawnSwatchResolver
{
    private static IReadOnlyDictionary<string, string>? _backgroundCache;
    private static IReadOnlyDictionary<string, string>? _foregroundCache;

    public static IReadOnlyDictionary<string, string> GetBackgroundSwatchHexByName()
        => _backgroundCache ??= LoadSwatches("ColorSwatch", NotePdfDawnSwatches.Background);

    public static IReadOnlyDictionary<string, string> GetForegroundSwatchHexByName()
        => _foregroundCache ??= LoadSwatches("TextColorSwatch", NotePdfDawnSwatches.Foreground);

    private static IReadOnlyDictionary<string, string> LoadSwatches(
        string resourcePrefix,
        IReadOnlyDictionary<string, string> fallback)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var uri = new Uri("avares://Mnemo.UI/Themes/Core/Dawn/Colors.axaml");
            using var stream = AssetLoader.Open(uri);
            using var reader = new StreamReader(stream);
            var xml = reader.ReadToEnd();
            var pattern = "<Color x:Key=\"" + resourcePrefix + "(\\d{1,2})\">#([0-9A-Fa-f]{6})</Color>";
            foreach (Match m in Regex.Matches(xml, pattern, RegexOptions.IgnoreCase))
            {
                map["swatch" + m.Groups[1].Value] = "#" + m.Groups[2].Value.ToUpperInvariant();
            }
        }
        catch
        {
            // ignored
        }

        return map.Count >= 10 ? map : new Dictionary<string, string>(fallback, StringComparer.OrdinalIgnoreCase);
    }
}
