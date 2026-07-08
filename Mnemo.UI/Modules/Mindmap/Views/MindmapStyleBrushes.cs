using System;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>
/// Maps mindmap style tokens to theme brush resource keys. The canvas resolves the key against the
/// active theme, so a document's token colors follow theme switches without touching the document. The
/// <c>palette.N</c> ramp keys are reserved for the branch-color work that ships with the template picker.
/// </summary>
internal static class MindmapStyleBrushes
{
    private const string PalettePrefix = "palette.";

    /// <summary>The theme resource key for a token, or null if the token has no mapping.</summary>
    public static string? ResourceKey(string? token) => token switch
    {
        MindmapStyleTokens.Accent => "AccentBrush",
        MindmapStyleTokens.OnAccent => "AccentButtonForegroundBrush",
        MindmapStyleTokens.Surface => "CardBackgroundSecondaryBrush",
        MindmapStyleTokens.SurfaceAlt => "CardBackgroundSecondaryBrush",
        MindmapStyleTokens.TextPrimary => "TextPrimaryBrush",
        MindmapStyleTokens.TextMuted => "TextSecondaryBrush",
        MindmapStyleTokens.Stroke => "BorderBrush",
        _ when token is not null && token.StartsWith(PalettePrefix, StringComparison.Ordinal)
            => "MindmapPalette" + token[PalettePrefix.Length..] + "Brush",
        _ => null,
    };
}
