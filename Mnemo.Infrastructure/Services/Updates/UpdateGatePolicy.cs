using System;

namespace Mnemo.Infrastructure.Services.Updates;

/// <summary>Pure helpers for when an update prompt may be shown.</summary>
public static class UpdateGatePolicy
{
    public static readonly string[] AllowedRoutes = { "overview", "settings" };

    public static bool IsAllowedRoute(string? route)
    {
        if (string.IsNullOrEmpty(route))
            return false;
        foreach (var allowed in AllowedRoutes)
        {
            if (string.Equals(route, allowed, StringComparison.Ordinal))
                return true;
        }

        return false;
    }

    /// <summary>Snooze is active: user dismissed and we have not reached the resume condition yet.</summary>
    public static bool IsSnoozeActive(DateTime? snoozeUntilUtc, int? snoozeLaunchesRemaining)
    {
        if (!snoozeUntilUtc.HasValue)
            return false;

        if (snoozeLaunchesRemaining == null)
            return DateTime.UtcNow < snoozeUntilUtc.Value;

        return DateTime.UtcNow < snoozeUntilUtc.Value && snoozeLaunchesRemaining.Value > 0;
    }

    public static bool IsSkipped(string? skippedVersion, string updateVersion)
    {
        if (string.IsNullOrEmpty(skippedVersion))
            return false;
        return string.Equals(skippedVersion.Trim(), updateVersion.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsOverPromptCap(int promptCount, int maxPrompts = 3) => promptCount >= maxPrompts;

    /// <summary>
    /// Whether an offer an earlier process stored still applies to this one: strictly newer
    /// than the running build, and from the selected channel.
    /// </summary>
    /// <remarks>
    /// Anything that cannot be shown current is declined. Declining costs at most one
    /// cooldown window before a real check answers; resuming a stale offer asks the user to
    /// install the build they already run. An offer stored without a channel is kept only
    /// when the selected channel's feed lists its version's track.
    /// </remarks>
    public static bool ShouldResumeOffer(
        string offerVersion,
        string? offerChannel,
        string? runningVersion,
        string selectedChannel)
    {
        var offered = VelopackUpdateService.ParseVersion(offerVersion);
        var running = VelopackUpdateService.ParseVersion(runningVersion);
        if (offered is null || running is null || offered.CompareTo(running) <= 0)
            return false;

        var selected = UpdateChannels.Normalize(selectedChannel);
        // Matched strictly: Normalize would read an unrecognised stored value as Stable.
        if (offerChannel is not null)
            return string.Equals(offerChannel.Trim(), selected, StringComparison.OrdinalIgnoreCase);

        return UpdateChannels.FeedCarries(selected, UpdateChannels.ForVersion(offered));
    }
}
