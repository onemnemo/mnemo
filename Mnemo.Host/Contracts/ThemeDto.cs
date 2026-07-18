using System.Collections.Generic;
using Mnemo.Core.Models;

namespace Mnemo.Host.Contracts;

/// <summary>
/// One installed theme, for the appearance gallery. <see cref="Id"/> is the lowercase
/// form the SPA renders with and sends back (the DB keeps the canonical capitalized
/// name); <see cref="PreviewColors"/> is the swatch strip shown on the card.
/// </summary>
public sealed record ThemeDto(
    string Id,
    string Name,
    string DisplayName,
    string Description,
    IReadOnlyList<string> PreviewColors)
{
    public static ThemeDto FromManifest(ThemeManifest manifest) => new(
        manifest.Name.ToLowerInvariant(),
        manifest.Name,
        string.IsNullOrWhiteSpace(manifest.DisplayName) ? manifest.Name : manifest.DisplayName,
        manifest.Description,
        manifest.PreviewColors);
}
