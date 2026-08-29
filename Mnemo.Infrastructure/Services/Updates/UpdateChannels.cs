using System;
using NuGet.Versioning;

namespace Mnemo.Infrastructure.Services.Updates;

/// <summary>
/// The update tracks a user can follow, and how a released version maps onto one.
/// </summary>
/// <remarks>
/// <para>
/// A version says how mature a build is; a channel says how close to development the
/// user has chosen to sit. They are deliberately not the same list. Alpha and nightly
/// builds are both too raw for anyone who did not ask for them, so both publish to
/// Nightly; beta and release candidates both mean "the next release, early", so both
/// publish to Beta. Exposing four channels because there are four prerelease labels
/// would make the user pick a maturity rather than a track.
/// </para>
/// <para>
/// The tracks nest rather than partition. Someone on Beta wants the next release
/// early, which has to include the finished release when it lands, otherwise they sit
/// on the last prerelease of a version that already shipped. So each channel offers
/// its own builds and every calmer channel's.
/// </para>
/// </remarks>
public static class UpdateChannels
{
    public const string Stable = "stable";
    public const string Beta = "beta";
    public const string Nightly = "nightly";

    /// <summary>Every channel, calmest first.</summary>
    public static readonly string[] All = [Stable, Beta, Nightly];

    /// <summary>
    /// Resolves a stored or client-supplied channel name. Anything unrecognised follows
    /// Stable, so a corrupted setting or an older build's value cannot silently opt
    /// someone into prerelease updates.
    /// </summary>
    public static string Normalize(string? channel)
    {
        if (string.IsNullOrWhiteSpace(channel))
            return Stable;

        var trimmed = channel.Trim();
        foreach (var known in All)
        {
            if (string.Equals(trimmed, known, StringComparison.OrdinalIgnoreCase))
                return known;
        }

        return Stable;
    }

    /// <summary>
    /// The name the update feed is published and read under, which is not the name the
    /// user picked.
    /// </summary>
    /// <remarks>
    /// Every platform's packages share one GitHub release, and the channel is the only
    /// thing in an index asset's name, so without the runtime identifier a win-x64 build
    /// and a linux-x64 build would both claim releases.stable.json in the same release.
    /// The release workflow builds the same string; the two have to agree or the app
    /// looks for an index nothing writes.
    /// </remarks>
    public static string FeedName(string runtimeIdentifier, string channel) =>
        $"{runtimeIdentifier}-{Normalize(channel)}";

    /// <summary>
    /// Returns the channel token from a recognized feed name, or null. Match the full final segment
    /// so unknown feeds cannot become persisted channel choices.
    /// </summary>
    public static string? ChannelFromFeedName(string? feedName)
    {
        if (string.IsNullOrWhiteSpace(feedName))
            return null;

        var trimmed = feedName.Trim();
        var lastDash = trimmed.LastIndexOf('-');
        var token = lastDash < 0 ? trimmed : trimmed[(lastDash + 1)..];

        foreach (var known in All)
        {
            if (string.Equals(token, known, StringComparison.OrdinalIgnoreCase))
                return known;
        }

        return null;
    }

    /// <summary>How close to development a channel sits. Higher means less settled.</summary>
    public static int Rank(string channel) => Normalize(channel) switch
    {
        Beta => 1,
        Nightly => 2,
        _ => 0,
    };

    /// <summary>Which channel publishes a build carrying this version.</summary>
    public static string ForVersion(SemanticVersion version)
    {
        if (version is null || !version.IsPrerelease)
            return Stable;

        var label = version.ReleaseLabels is null ? null : FirstLabel(version);
        if (string.IsNullOrEmpty(label))
            return Beta;

        if (label.StartsWith("nightly", StringComparison.OrdinalIgnoreCase)
            || label.StartsWith("alpha", StringComparison.OrdinalIgnoreCase)
            || label.StartsWith("dev", StringComparison.OrdinalIgnoreCase))
            return Nightly;

        // Beta, rc, and anything else with a prerelease label we have not met. Falling
        // back to Beta rather than Stable keeps an unknown label out of the track whose
        // whole promise is that it only carries finished releases.
        return Beta;
    }

    private static string? FirstLabel(SemanticVersion version)
    {
        foreach (var label in version.ReleaseLabels)
            return label;

        return null;
    }

    /// <summary>True when a user following <paramref name="selected"/> should be offered a build published to <paramref name="released"/>.</summary>
    public static bool Offers(string selected, string released) => Rank(selected) >= Rank(released);

    /// <summary>
    /// True when the running build is less settled than the channel now selected, so
    /// the selected channel has nothing to offer until it catches up.
    /// </summary>
    /// <remarks>
    /// This is the state behind the "you are on a newer Beta build" note. Velopack could
    /// install the older Stable build instead (that is what AllowVersionDowngrade is
    /// for), and it is deliberately not enabled: a downgrade would run an older schema
    /// reader against a database a newer build has already written, and nothing gates
    /// that today. Waiting is the safe half of the trade, and the user is told why.
    /// </remarks>
    public static bool IsAwaitingCatchUp(string selected, SemanticVersion? current) =>
        current is not null && Rank(ForVersion(current)) > Rank(selected);
}
