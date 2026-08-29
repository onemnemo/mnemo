using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Updates;
using Mnemo.Infrastructure.Tests.Widgets;
using NuGet.Versioning;
using Velopack;

namespace Mnemo.Infrastructure.Tests.Services.Updates;

/// <summary>
/// Checks channel initialization and download guards without contacting an update feed.
/// </summary>
public sealed class VelopackUpdateServiceTests
{
    private const string ChannelKey = "Updates.Channel";

    [Fact]
    public async Task TheChannelIsSeededFromTheInstalledChannelOnFirstRun()
    {
        var settings = new SettingsService(new InMemoryStorageProvider());
        using var service = new VelopackUpdateService(new TestLogger(), settings);

        Assert.True(await service.SeedChannelIfAbsentAsync(() => UpdateChannels.Nightly));

        // The bare token the setting holds, not the feed name the package reports.
        Assert.Equal(UpdateChannels.Nightly, await settings.GetAsync<string?>(ChannelKey));
    }

    [Fact]
    public async Task AStoredChannelIsNeverOverwritten()
    {
        var settings = new SettingsService(new InMemoryStorageProvider());
        await settings.SetAsync(ChannelKey, UpdateChannels.Beta);
        using var service = new VelopackUpdateService(new TestLogger(), settings);

        var asked = false;
        Assert.False(await service.SeedChannelIfAbsentAsync(() =>
        {
            asked = true;
            return UpdateChannels.Nightly;
        }));

        Assert.Equal(UpdateChannels.Beta, await settings.GetAsync<string?>(ChannelKey));
        Assert.False(asked);
    }

    [Fact]
    public async Task NothingIsWrittenWhenTheInstalledChannelCannotBeRead()
    {
        var settings = new SettingsService(new InMemoryStorageProvider());
        using var service = new VelopackUpdateService(new TestLogger(), settings);

        Assert.False(await service.SeedChannelIfAbsentAsync(() => null));

        // Leave unknown channels unset so a later launch can detect them.
        Assert.False(await settings.ExistsAsync(ChannelKey));
    }

    [Fact]
    public async Task NothingIsWrittenWhenTheStoredChannelCannotBeRead()
    {
        var storage = new InMemoryStorageProvider();
        storage.Seed(ChannelKey, "{ not valid json");
        var settings = new SettingsService(storage);
        using var service = new VelopackUpdateService(new TestLogger(), settings);

        var asked = false;
        Assert.False(await service.SeedChannelIfAbsentAsync(() =>
        {
            asked = true;
            return UpdateChannels.Nightly;
        }));

        // A failed read must leave the existing setting unchanged.
        Assert.False(asked);
        Assert.Equal("{ not valid json", storage.Raw[ChannelKey]);
    }

    /// <summary>
    /// Downloading requires an update object resolved by this service instance.
    /// </summary>
    [Fact]
    public async Task ADownloadWithoutACheckIsRefusedBeforeTheNetwork()
    {
        using var service = new VelopackUpdateService(new TestLogger(), new SettingsService(new InMemoryStorageProvider()));

        var result = await service.DownloadUpdatesAsync(
            new AppUpdateInfo("0.9.0", null, null, false), progress: null);

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task ADownloadForADifferentVersionThanThePendingOneIsRefused()
    {
        using var service = new VelopackUpdateService(new TestLogger(), new SettingsService(new InMemoryStorageProvider()));
        service.SetPendingUpdateForTests(PendingUpdate("0.9.0"));

        var result = await service.DownloadUpdatesAsync(
            new AppUpdateInfo("0.9.1", null, null, false), progress: null);

        Assert.False(result.IsSuccess);
        Assert.Contains("different version", result.ErrorMessage);
    }

    /// <summary>
    /// A failed apply must return a result so the caller can remove its restart marker.
    /// </summary>
    [Fact]
    public void AnApplyWithNothingPendingReportsFailureRatherThanReturningQuietly()
    {
        using var service = new VelopackUpdateService(new TestLogger(), new SettingsService(new InMemoryStorageProvider()));

        Assert.False(service.ApplyUpdatesAndRestart().IsSuccess);
    }

    /// <summary>The shape a check resolves, built by hand because no feed is reachable here.</summary>
    private static Velopack.UpdateInfo PendingUpdate(string version)
    {
        var asset = new VelopackAsset
        {
            PackageId = "Mnemo",
            Version = SemanticVersion.Parse(version),
            FileName = $"Mnemo-{version}-full.nupkg",
        };

        // The target release, not a downgrade, the same asset as the base, and no deltas.
        return new Velopack.UpdateInfo(asset, false, asset, []);
    }
}
