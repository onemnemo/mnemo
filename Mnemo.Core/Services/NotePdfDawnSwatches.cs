using System;
using System.Collections.Generic;

namespace Mnemo.Core.Services;

/// <summary>
/// The Dawn (light) palette for inline <c>swatch1</c>…<c>swatch10</c> tokens. PDF pages are always
/// light, so a note styled in the Dusk or Noon editor theme must still resolve its swatches against
/// Dawn rather than paint dark colors on white paper.
/// </summary>
/// <remarks>
/// These live in Core so every host can reach them. The desktop reads the live values from
/// <c>Colors.axaml</c> and falls back to this table when that read fails; the web host, which has no
/// Avalonia resources, uses this table directly. Keep it in sync with the Dawn swatches in
/// <c>Mnemo.UI/Themes/Core/Dawn/Colors.axaml</c>.
/// </remarks>
public static class NotePdfDawnSwatches
{
    /// <summary>Background swatch keys (<c>ColorSwatch1</c>…<c>ColorSwatch10</c> in Dawn).</summary>
    public static readonly IReadOnlyDictionary<string, string> Background = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["swatch1"] = "#F5F5F5",
        ["swatch2"] = "#E6E6FA",
        ["swatch3"] = "#D8DCEC",
        ["swatch4"] = "#C4B5FD",
        ["swatch5"] = "#FADBD8",
        ["swatch6"] = "#E8F5E9",
        ["swatch7"] = "#FFF3CD",
        ["swatch8"] = "#FFE0B2",
        ["swatch9"] = "#DBEAFE",
        ["swatch10"] = "#D1EDDA"
    };

    /// <summary>Foreground/text swatch keys (<c>TextColorSwatch1</c>…<c>TextColorSwatch10</c> in Dawn).</summary>
    public static readonly IReadOnlyDictionary<string, string> Foreground = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["swatch1"] = "#57534E",
        ["swatch2"] = "#7C3AED",
        ["swatch3"] = "#2563EB",
        ["swatch4"] = "#9333EA",
        ["swatch5"] = "#DC2626",
        ["swatch6"] = "#16A34A",
        ["swatch7"] = "#CA8A04",
        ["swatch8"] = "#EA580C",
        ["swatch9"] = "#0284C7",
        ["swatch10"] = "#0D9488"
    };
}
