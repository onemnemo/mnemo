using Mnemo.Infrastructure.Services.Updates;

namespace Mnemo.Infrastructure.Tests;

public sealed class UpdateGatePolicyTests
{
    [Fact]
    public void IsAllowedRoute_accepts_overview_and_settings_only()
    {
        Assert.True(UpdateGatePolicy.IsAllowedRoute("overview"));
        Assert.True(UpdateGatePolicy.IsAllowedRoute("settings"));
        Assert.False(UpdateGatePolicy.IsAllowedRoute("notes"));
        Assert.False(UpdateGatePolicy.IsAllowedRoute(null));
    }

    [Fact]
    public void IsSnoozeActive_hybrid_ends_when_time_passes_or_launches_hit_zero()
    {
        var until = DateTime.UtcNow.AddHours(1);
        Assert.True(UpdateGatePolicy.IsSnoozeActive(until, 2));

        Assert.False(UpdateGatePolicy.IsSnoozeActive(DateTime.UtcNow.AddHours(-1), 2));

        Assert.False(UpdateGatePolicy.IsSnoozeActive(until, 0));
    }

    [Fact]
    public void IsSnoozeActive_time_only_when_launches_null()
    {
        var until = DateTime.UtcNow.AddHours(1);
        Assert.True(UpdateGatePolicy.IsSnoozeActive(until, null));
        Assert.False(UpdateGatePolicy.IsSnoozeActive(DateTime.UtcNow.AddHours(-1), null));
    }

    [Theory]
    [InlineData("0.9.0", "stable", "0.8.0", "stable", true)]
    [InlineData("0.9.0", "stable", "0.9.0", "stable", false)]
    [InlineData("0.9.0", "stable", "0.9.0+3f2a1b9", "stable", false)]
    [InlineData("0.9.0", "stable", "0.9.1", "stable", false)]
    [InlineData("0.9.0-rc.1", "beta", "0.9.0-rc.1", "beta", false)]
    [InlineData("0.9.0", "beta", "0.9.0-rc.2", "beta", true)]
    [InlineData("0.9.0-nightly.2", "nightly", "0.9.0-nightly.10", "nightly", false)]
    [InlineData("0.9.0-nightly.10", "nightly", "0.9.0-nightly.2", "nightly", true)]
    [InlineData("0.9.0", "beta", "0.8.0", "stable", false)]
    [InlineData("0.9.0-beta.1", "beta", "0.8.0", "nightly", false)]
    [InlineData("0.9.0", "STABLE", "0.8.0", "stable", true)]
    [InlineData("0.9.0", "unknown", "0.8.0", "stable", false)]
    [InlineData("0.9.0", null, "0.8.0", "stable", true)]
    [InlineData("0.9.0-beta.1", null, "0.8.0", "stable", false)]
    [InlineData("0.9.0-beta.1", null, "0.8.0", "beta", true)]
    [InlineData("0.9.0-nightly.1", null, "0.8.0", "beta", false)]
    [InlineData("0.9.0-nightly.1", null, "0.8.0", "nightly", true)]
    [InlineData("0.9.0-beta.1", null, "0.8.0", "nightly", false)]
    [InlineData("0.9.0", null, "0.8.0", "nightly", false)]
    [InlineData("0.9.0", null, "0.8.0", "beta", true)]
    [InlineData("0.9.0", "stable", null, "stable", false)]
    [InlineData("0.9.0", "stable", "unknown", "stable", false)]
    [InlineData("not a version", "stable", "0.8.0", "stable", false)]
    public void ShouldResumeOffer_needs_a_newer_version_from_the_selected_channel(
        string offered, string? offerChannel, string? running, string selected, bool expected)
    {
        Assert.Equal(expected, UpdateGatePolicy.ShouldResumeOffer(offered, offerChannel, running, selected));
    }
}
