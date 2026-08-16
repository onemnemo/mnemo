using System;
using System.Text.Json;
using Mnemo.Host.Updates;
using Xunit;

namespace Mnemo.Host.Tests.Updates;

/// <summary>
/// What <c>/api/updates/*</c> puts on the wire.
/// <para>
/// The stage is the reason this file exists. Nothing in the SPA reads a number: it branches
/// on the stage name to decide whether the button offers a check, a download or a restart,
/// so an enum serialized as an ordinal leaves every branch unmatched and the row stuck on
/// "Check now" forever. That failure is silent on both sides, because a valid response
/// arrives and the page renders.
/// </para>
/// </summary>
public sealed class UpdateStatusWireTests
{
    /// <summary>Matches what the minimal API emits: camelCase names, case-insensitive on read.</summary>
    private static readonly JsonSerializerOptions WireJson = new(JsonSerializerDefaults.Web);

    [Theory]
    [InlineData(UpdateStage.Idle, "Idle")]
    [InlineData(UpdateStage.Checking, "Checking")]
    [InlineData(UpdateStage.UpToDate, "UpToDate")]
    [InlineData(UpdateStage.Available, "Available")]
    [InlineData(UpdateStage.Downloading, "Downloading")]
    [InlineData(UpdateStage.Ready, "Ready")]
    [InlineData(UpdateStage.Failed, "Failed")]
    public void EveryStageIsWrittenByName(UpdateStage stage, string expected)
    {
        // The literals in mnemo-web/src/updates/types.ts, spelled out rather than derived,
        // so renaming a member here fails this instead of the app.
        Assert.Equal($"\"{expected}\"", JsonSerializer.Serialize(stage, WireJson));
    }

    [Fact]
    public void NoStageIsLeftOut()
    {
        // The theory above is the contract; this catches a value added without one.
        Assert.Equal(7, Enum.GetValues<UpdateStage>().Length);
    }

    [Fact]
    public void TheStatusCarriesTheStageNameAndTheNamesTheClientMirrors()
    {
        var status = new UpdateStatus(
            UpdateStage.Available,
            "0.8.0-beta+3f2a1b9",
            "beta",
            SupportsInAppApply: true,
            AwaitingChannelCatchUp: false,
            LastCheckedUtc: new DateTime(2026, 8, 16, 12, 0, 0, DateTimeKind.Utc),
            AvailableVersion: "0.9.0",
            ReleaseNotesMarkdown: null,
            DownloadProgress: 40,
            Error: null);

        var wire = JsonSerializer.Serialize(status, WireJson);

        Assert.Contains("\"stage\":\"Available\"", wire);
        // Hand-mirrored in mnemo-web/src/updates/types.ts, which reads these exact names.
        Assert.Contains("\"supportsInAppApply\":true", wire);
        Assert.Contains("\"awaitingChannelCatchUp\":false", wire);
        Assert.Contains("\"availableVersion\":\"0.9.0\"", wire);
        Assert.Contains("\"downloadProgress\":40", wire);
        Assert.Contains("\"lastCheckedUtc\":", wire);
        Assert.Contains("\"releaseNotesMarkdown\":null", wire);
        Assert.Contains("\"error\":null", wire);
    }
}
