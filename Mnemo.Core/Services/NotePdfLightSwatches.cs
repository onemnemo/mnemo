using System;
using System.Collections.Generic;

namespace Mnemo.Core.Services;

/// <summary>
/// The light palette for inline <c>swatch1</c>…<c>swatch10</c> tokens. PDF pages are always light,
/// so a note written in the dark editor theme must still resolve its swatches against the light
/// palette rather than paint dark colors on white paper.
/// </summary>
/// <remarks>
/// Lives in Core so any host can reach it without a UI framework dependency. It is the palette used
/// when painting inline swatch highlights into exported PDFs, and the only place those colors are
/// defined for the export path.
/// <para>
/// The web editor is authoritative for these values: they are the light theme block of mnemo-web's
/// <c>tokens.css</c> (<c>--color-swatch-*</c> and <c>--text-color-swatch-*</c>), converted from oklch
/// to sRGB hex.
/// Update both together; Mnemo.Infrastructure.Tests asserts this table still matches that file.
/// </para>
/// </remarks>
public static class NotePdfLightSwatches
{
    /// <summary>Background swatch keys, matching <c>--color-swatch-1</c>…<c>-10</c> in the light theme.</summary>
    public static readonly IReadOnlyDictionary<string, string> Background = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["swatch1"] = "#EAEDF1",
        ["swatch2"] = "#F0E9FF",
        ["swatch3"] = "#E2EEFF",
        ["swatch4"] = "#FFE4F2",
        ["swatch5"] = "#FEE6E5",
        ["swatch6"] = "#DCF5DE",
        ["swatch7"] = "#FFF0C2",
        ["swatch8"] = "#FEE8D8",
        ["swatch9"] = "#D9F1FF",
        ["swatch10"] = "#D1F6EF"
    };

    /// <summary>Foreground/text swatch keys, matching <c>--text-color-swatch-1</c>…<c>-10</c> in the light theme.</summary>
    public static readonly IReadOnlyDictionary<string, string> Foreground = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["swatch1"] = "#5F636A",
        ["swatch2"] = "#7A53B4",
        ["swatch3"] = "#2D6AC1",
        ["swatch4"] = "#A5417F",
        ["swatch5"] = "#B23F43",
        ["swatch6"] = "#0A8234",
        ["swatch7"] = "#8F6B06",
        ["swatch8"] = "#BD4D00",
        ["swatch9"] = "#00769F",
        ["swatch10"] = "#057D70"
    };
}
