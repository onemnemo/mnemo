using System.Text.Json;
using Mnemo.Infrastructure.Services.Updates;
using NuGet.Versioning;

namespace Mnemo.Infrastructure.Tests.Services.Updates;

public sealed class PortableReleaseSelectorTests
{
    [Fact]
    public void AReleaseWithoutAnAssetForThisRuntimeIsSkipped()
    {
        var selected = Select(
            """
            [
              {
                "tag_name": "v0.9.0",
                "draft": false,
                "assets": [{ "name": "Mnemo-Portable-linux-x64.tar.gz" }]
              },
              {
                "tag_name": "v0.8.2",
                "draft": false,
                "body": "Windows fixes",
                "published_at": "2026-09-12T08:30:00Z",
                "assets": [{ "name": "Mnemo-Portable-win-x64.zip" }]
              }
            ]
            """);

        Assert.NotNull(selected);
        Assert.Equal("0.8.2", selected.Version.ToString());
        Assert.Equal("Windows fixes", selected.Notes);
        Assert.Equal(new DateTime(2026, 9, 12, 8, 30, 0, DateTimeKind.Utc), selected.PublishedAtUtc);
    }

    [Fact]
    public void NoUpdateIsOfferedWhenNoReleaseHasACompatibleAsset()
    {
        var selected = Select(
            """
            [
              {
                "tag_name": "v0.9.0",
                "draft": false,
                "assets": [{ "name": "Mnemo-Portable-linux-x64.tar.gz" }]
              },
              {
                "tag_name": "v0.8.2",
                "draft": false
              }
            ]
            """);

        Assert.Null(selected);
    }

    [Fact]
    public void InstallerAssetsMatchTheRuntimeWithoutCaseSensitivity()
    {
        var selected = Select(
            """
            [
              {
                "tag_name": "v0.8.3-beta.1",
                "draft": false,
                "assets": [{ "name": "Mnemo-WIN-X64-beta-Setup.exe" }]
              }
            ]
            """,
            UpdateChannels.Beta);

        Assert.NotNull(selected);
        Assert.Equal("0.8.3-beta.1", selected.Version.ToString());
    }

    [Fact]
    public void ACompatibleReleaseAtTheCurrentVersionIsNotAnUpdate()
    {
        var selected = Select(
            """
            [
              {
                "tag_name": "v0.8.0",
                "draft": false,
                "assets": [{ "name": "Mnemo-Portable-win-x64.zip" }]
              }
            ]
            """);

        Assert.Null(selected);
    }

    [Fact]
    public void OneMatchingAssetAmongManyIsEnough()
    {
        var selected = Select(
            """
            [
              {
                "tag_name": "v0.8.1",
                "draft": false,
                "assets": [
                  { "name": "Mnemo-Portable-linux-x64.tar.gz" },
                  { "name": "Mnemo.Desktop.V2-linux-x64-stable.AppImage" },
                  { "name": "RELEASES" },
                  { "name": "Mnemo-Portable-win-x64.zip" },
                  { "name": "Mnemo.Desktop.V2-win-x64-stable-Setup.exe" }
                ]
              }
            ]
            """);

        Assert.NotNull(selected);
        Assert.Equal("0.8.1", selected.Version.ToString());
    }

    [Fact]
    public void ADraftIsNeverOfferedEvenWhenItIsTheNewestCompatibleRelease()
    {
        var selected = Select(
            """
            [
              {
                "tag_name": "v0.9.0",
                "draft": true,
                "assets": [{ "name": "Mnemo-Portable-win-x64.zip" }]
              },
              {
                "tag_name": "v0.8.1",
                "draft": false,
                "assets": [{ "name": "Mnemo-Portable-win-x64.zip" }]
              }
            ]
            """);

        Assert.NotNull(selected);
        Assert.Equal("0.8.1", selected.Version.ToString());
    }

    private static PortableRelease? Select(
        string json,
        string channel = UpdateChannels.Stable,
        string runtimeIdentifier = "win-x64",
        string current = "0.8.0")
    {
        using var document = JsonDocument.Parse(json);
        return PortableReleaseSelector.Select(
            document.RootElement,
            channel,
            runtimeIdentifier,
            SemanticVersion.Parse(current));
    }
}
