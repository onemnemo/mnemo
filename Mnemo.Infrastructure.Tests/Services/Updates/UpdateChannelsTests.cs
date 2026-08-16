using Mnemo.Infrastructure.Services.Updates;
using NuGet.Versioning;

namespace Mnemo.Infrastructure.Tests.Services.Updates;

/// <summary>
/// The rules that decide which builds an install is offered.
///
/// Worth pinning because both halves are silent when wrong: a version that maps to the
/// wrong channel puts a raw build in front of someone who asked for finished ones, and a
/// channel that stops offering the calmer channels' builds leaves a Beta user parked on
/// the last prerelease of a version that already shipped. Neither shows up as an error.
/// </summary>
public class UpdateChannelsTests
{
    [Theory]
    [InlineData("0.9.0", UpdateChannels.Stable)]
    [InlineData("1.0.0", UpdateChannels.Stable)]
    [InlineData("0.9.1", UpdateChannels.Stable)]
    [InlineData("0.9.0-beta.1", UpdateChannels.Beta)]
    [InlineData("0.9.0-rc.1", UpdateChannels.Beta)]
    [InlineData("0.9.0-alpha.1", UpdateChannels.Nightly)]
    [InlineData("0.9.0-nightly.20260816", UpdateChannels.Nightly)]
    [InlineData("0.9.0-dev.4", UpdateChannels.Nightly)]
    public void ForVersion_MapsAReleaseOntoItsTrack(string version, string expected) =>
        Assert.Equal(expected, UpdateChannels.ForVersion(SemanticVersion.Parse(version)));

    /// <summary>
    /// A label nobody planned for is still a prerelease, so it belongs anywhere but the
    /// track whose whole promise is that it carries only finished releases.
    /// </summary>
    [Fact]
    public void ForVersion_TreatsAnUnknownPrereleaseLabelAsBeta() =>
        Assert.Equal(UpdateChannels.Beta, UpdateChannels.ForVersion(SemanticVersion.Parse("0.9.0-preview.2")));

    /// <summary>Build metadata says how a build was made, not how finished it is.</summary>
    [Fact]
    public void ForVersion_IgnoresBuildMetadata() =>
        Assert.Equal(UpdateChannels.Stable, UpdateChannels.ForVersion(SemanticVersion.Parse("0.9.0+abcdef1")));

    [Theory]
    [InlineData("stable")]
    [InlineData("STABLE")]
    [InlineData("  stable  ")]
    public void Normalize_AcceptsTheNameHoweverItWasStored(string stored) =>
        Assert.Equal(UpdateChannels.Stable, UpdateChannels.Normalize(stored));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("canary")]
    [InlineData("alpha")]
    public void Normalize_FallsBackToStable(string? stored) =>
        Assert.Equal(UpdateChannels.Stable, UpdateChannels.Normalize(stored));

    /// <summary>
    /// "alpha" is a version state rather than a track, so it is not a channel name. A
    /// stored value naming one must not opt anyone into prerelease builds.
    /// </summary>
    [Fact]
    public void Normalize_DoesNotAcceptAVersionStateAsAChannel() =>
        Assert.DoesNotContain("alpha", UpdateChannels.All);

    [Theory]
    // Stable follows only finished releases.
    [InlineData(UpdateChannels.Stable, UpdateChannels.Stable, true)]
    [InlineData(UpdateChannels.Stable, UpdateChannels.Beta, false)]
    [InlineData(UpdateChannels.Stable, UpdateChannels.Nightly, false)]
    // Beta means "the next release, early", which has to include the release itself.
    [InlineData(UpdateChannels.Beta, UpdateChannels.Stable, true)]
    [InlineData(UpdateChannels.Beta, UpdateChannels.Beta, true)]
    [InlineData(UpdateChannels.Beta, UpdateChannels.Nightly, false)]
    // Nightly sits closest to development and takes everything.
    [InlineData(UpdateChannels.Nightly, UpdateChannels.Stable, true)]
    [InlineData(UpdateChannels.Nightly, UpdateChannels.Beta, true)]
    [InlineData(UpdateChannels.Nightly, UpdateChannels.Nightly, true)]
    public void Offers_LetsEachChannelSeeItsOwnBuildsAndEveryCalmerOne(
        string selected,
        string released,
        bool expected) =>
        Assert.Equal(expected, UpdateChannels.Offers(selected, released));

    /// <summary>
    /// The state behind the "you are on a newer Beta build" note: switching to Stable
    /// while running a beta leaves nothing to install, because downgrading is not on
    /// offer, so the user has to be told rather than shown "up to date".
    /// </summary>
    [Fact]
    public void IsAwaitingCatchUp_IsTrueForABetaBuildFollowingStable() =>
        Assert.True(UpdateChannels.IsAwaitingCatchUp(UpdateChannels.Stable, SemanticVersion.Parse("0.9.0-beta.2")));

    [Theory]
    [InlineData(UpdateChannels.Stable, "0.9.0")]
    [InlineData(UpdateChannels.Beta, "0.9.0-beta.2")]
    [InlineData(UpdateChannels.Beta, "0.9.0")]
    [InlineData(UpdateChannels.Nightly, "0.9.0-nightly.3")]
    public void IsAwaitingCatchUp_IsFalseWhenTheChannelCanStillOfferSomething(string selected, string current) =>
        Assert.False(UpdateChannels.IsAwaitingCatchUp(selected, SemanticVersion.Parse(current)));

    /// <summary>An unreadable version is no evidence of being ahead of anything.</summary>
    [Fact]
    public void IsAwaitingCatchUp_IsFalseWithoutAVersion() =>
        Assert.False(UpdateChannels.IsAwaitingCatchUp(UpdateChannels.Stable, null));

    [Theory]
    [InlineData("0.9.0", "0.9.0")]
    [InlineData("0.9.0-beta.1", "0.9.0-beta.1")]
    // The informational version CI stamps carries the commit after a plus, which is not
    // part of the SemVer core and must not stop the version being read at all.
    [InlineData("0.9.0+3f2a1b9", "0.9.0")]
    [InlineData("0.9.0-beta.1+3f2a1b9", "0.9.0-beta.1")]
    public void ParseVersion_ReadsWhatTheBuildStamped(string informational, string expected) =>
        Assert.Equal(expected, VelopackUpdateService.ParseVersion(informational)?.ToString());

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not a version")]
    public void ParseVersion_AnswersNothingRatherThanGuessing(string? informational) =>
        Assert.Null(VelopackUpdateService.ParseVersion(informational));

    /// <summary>
    /// The release workflow builds these same strings by hand, in bash, and publishes the
    /// feed under them. Spelled out rather than derived, so changing the format here
    /// fails until the workflow is changed with it: if the two ever disagree the app
    /// looks for an index nothing writes, finds no update, and reports no error either.
    /// </summary>
    [Theory]
    [InlineData("win-x64", UpdateChannels.Stable, "win-x64-stable")]
    [InlineData("win-x64", UpdateChannels.Beta, "win-x64-beta")]
    [InlineData("win-x64", UpdateChannels.Nightly, "win-x64-nightly")]
    [InlineData("linux-x64", UpdateChannels.Stable, "linux-x64-stable")]
    [InlineData("osx-arm64", UpdateChannels.Beta, "osx-arm64-beta")]
    public void FeedName_IsTheNameTheReleaseWorkflowPublishesUnder(string rid, string channel, string expected) =>
        Assert.Equal(expected, UpdateChannels.FeedName(rid, channel));

    /// <summary>
    /// A corrupted setting must not send the app looking for a feed that does not exist,
    /// for the same reason Normalize exists at all.
    /// </summary>
    [Theory]
    [InlineData("STABLE", "win-x64-stable")]
    [InlineData("garbage", "win-x64-stable")]
    [InlineData("Beta", "win-x64-beta")]
    public void FeedName_NormalizesTheChannelFirst(string channel, string expected) =>
        Assert.Equal(expected, UpdateChannels.FeedName("win-x64", channel));
}
