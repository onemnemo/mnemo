using System;
using System.Globalization;
using System.Text.Json;
using NuGet.Versioning;

namespace Mnemo.Infrastructure.Services.Updates;

internal sealed record PortableRelease(
    SemanticVersion Version,
    string? Notes,
    DateTime? PublishedAtUtc);

internal static class PortableReleaseSelector
{
    /// <summary>
    /// Selects the newest offered release that is newer than the running build and carries an
    /// asset for its runtime. Returns null when the release list has no usable update.
    /// </summary>
    public static PortableRelease? Select(
        JsonElement releases,
        string channel,
        string runtimeIdentifier,
        SemanticVersion? current)
    {
        PortableRelease? best = null;

        foreach (var release in releases.EnumerateArray())
        {
            if (release.TryGetProperty("draft", out var draft) && draft.ValueKind == JsonValueKind.True)
                continue;

            if (!release.TryGetProperty("tag_name", out var tagElement))
                continue;

            var tag = (tagElement.GetString() ?? string.Empty).TrimStart('v', 'V');
            if (!SemanticVersion.TryParse(tag, out var version))
                continue;

            if (!UpdateChannels.Offers(channel, UpdateChannels.ForVersion(version)))
                continue;

            if (current is not null && version <= current)
                continue;

            if (!HasAssetForRuntime(release, runtimeIdentifier))
                continue;

            if (best is not null && version <= best.Version)
                continue;

            var notes = release.TryGetProperty("body", out var bodyElement) ? bodyElement.GetString() : null;
            DateTime? published = null;
            if (release.TryGetProperty("published_at", out var publishedElement)
                && publishedElement.GetString() is { Length: > 0 } publishedText
                && DateTime.TryParse(
                    publishedText,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                    out var parsedDate))
            {
                published = parsedDate;
            }

            best = new PortableRelease(version, notes, published);
        }

        return best;
    }

    private static bool HasAssetForRuntime(JsonElement release, string runtimeIdentifier)
    {
        if (string.IsNullOrWhiteSpace(runtimeIdentifier)
            || !release.TryGetProperty("assets", out var assets)
            || assets.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        // A plain substring is the whole rule on purpose. An installer counts as proof the runtime
        // was built, and installer names put the channel right after the identifier with the same
        // hyphen a longer identifier would use, so a boundary check would have to know the channel
        // names to tell "-stable" from a libc suffix. The day such an identifier exists, this rule
        // and the release names change together.
        foreach (var asset in assets.EnumerateArray())
        {
            if (asset.TryGetProperty("name", out var nameElement)
                && nameElement.GetString() is { } name
                && name.Contains(runtimeIdentifier, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
