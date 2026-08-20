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
/// The web editor is authoritative for these values: they are copied from the light theme block of
/// mnemo-web's <c>legacy-tokens.css</c> (<c>--color-swatch-*</c> and <c>--text-color-swatch-*</c>).
/// Update both together; Mnemo.Infrastructure.Tests asserts this table still matches that file.
/// </para>
/// </remarks>
public static class NotePdfLightSwatches
{
    /// <summary>Background swatch keys, matching <c>--color-swatch-1</c>…<c>-10</c> in the light theme.</summary>
    public static readonly IReadOnlyDictionary<string, string> Background = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["swatch1"] = "#EFEEEC",
        ["swatch2"] = "#EDE9FE",
        ["swatch3"] = "#DBEAFE",
        ["swatch4"] = "#FAE8FF",
        ["swatch5"] = "#FFE4E6",
        ["swatch6"] = "#DCFCE7",
        ["swatch7"] = "#FEF9C3",
        ["swatch8"] = "#FFEDD5",
        ["swatch9"] = "#E0F2FE",
        ["swatch10"] = "#CCFBF1"
    };

    /// <summary>Foreground/text swatch keys, matching <c>--text-color-swatch-1</c>…<c>-10</c> in the light theme.</summary>
    public static readonly IReadOnlyDictionary<string, string> Foreground = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["swatch1"] = "#1D1C1A",
        ["swatch2"] = "#7C3AED",
        ["swatch3"] = "#2563EB",
        ["swatch4"] = "#A21CAF",
        ["swatch5"] = "#E11D48",
        ["swatch6"] = "#16A34A",
        ["swatch7"] = "#CA8A04",
        ["swatch8"] = "#EA580C",
        ["swatch9"] = "#0284C7",
        ["swatch10"] = "#0D9488"
    };
}
