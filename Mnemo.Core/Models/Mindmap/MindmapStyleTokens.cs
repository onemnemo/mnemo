namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Canonical style token references. Documents store these strings, never raw hex; the UI maps
/// each to a theme brush, so a map authored in Dawn looks native in Dusk without touching the document.
/// </summary>
public static class MindmapStyleTokens
{
    public const string Accent = "accent";

    /// <summary>Legible text/icon color on an accent fill.</summary>
    public const string OnAccent = "onAccent";

    public const string Surface = "surface";

    public const string SurfaceAlt = "surfaceAlt";

    public const string TextPrimary = "textPrimary";

    public const string TextMuted = "textMuted";

    public const string Stroke = "stroke";

    /// <summary>Number of entries in each theme's curated branch-color ramp.</summary>
    public const int PaletteSize = 8;

    /// <summary>Palette ramp reference <c>palette.1</c>…<c>palette.8</c>, used for branch coloring.</summary>
    public static string Palette(int index) => $"palette.{index}";
}
