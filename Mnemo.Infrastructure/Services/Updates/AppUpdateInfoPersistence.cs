using System.Text.Json;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Updates;

/// <summary>An offer read back from settings, with the channel the check that found it ran on.</summary>
/// <param name="Channel">Null for an offer written by a build that did not record the channel.</param>
public sealed record PersistedUpdateOffer(AppUpdateInfo Offer, string? Channel);

/// <summary>JSON persistence for <see cref="AppUpdateInfo"/> in app settings.</summary>
public static class AppUpdateInfoPersistence
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string Serialize(AppUpdateInfo info, string channel) =>
        JsonSerializer.Serialize(
            new Persisted(info.Version, info.ReleaseNotesMarkdown, info.PublishedAtUtc, info.IsMandatory, channel),
            Options);

    /// <summary>Reads a stored offer. Returns null for a corrupt value or one without a version.</summary>
    public static PersistedUpdateOffer? Read(string json)
    {
        try
        {
            var p = JsonSerializer.Deserialize<Persisted>(json, Options);
            if (p is null || string.IsNullOrWhiteSpace(p.Version))
                return null;
            return new PersistedUpdateOffer(
                new AppUpdateInfo(p.Version, p.ReleaseNotesMarkdown, p.PublishedAtUtc, p.IsMandatory),
                string.IsNullOrWhiteSpace(p.Channel) ? null : p.Channel);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private sealed record Persisted(
        string Version,
        string? ReleaseNotesMarkdown,
        DateTime? PublishedAtUtc,
        bool IsMandatory,
        string? Channel = null);
}
