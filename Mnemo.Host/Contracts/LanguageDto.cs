using Mnemo.Core.Models;

namespace Mnemo.Host.Contracts;

/// <summary>
/// An available UI language. Hand-mirrored in <c>mnemo-web/src/i18n</c>; the C#
/// side is authoritative.
/// </summary>
public sealed record LanguageDto(string Code, string Name, string NativeName)
{
    public static LanguageDto FromManifest(LanguageManifest manifest)
        => new(manifest.Code, manifest.Name, manifest.NativeName);
}
