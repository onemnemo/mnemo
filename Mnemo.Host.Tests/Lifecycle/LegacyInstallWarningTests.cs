using Mnemo.Core.Services;
using Mnemo.Host.Lifecycle;
using Xunit;

namespace Mnemo.Host.Tests.Lifecycle;

public sealed class LegacyInstallDetectorTests : IDisposable
{
    private readonly string _localAppData =
        Path.Combine(Path.GetTempPath(), "mnemo-host-tests-legacy", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_localAppData))
            Directory.Delete(_localAppData, recursive: true);
    }

    [Fact]
    public void IsPresent_FindsTheLegacyExecutableUnderTheOverrideRoot()
    {
        var legacyExecutable = LegacyInstallDetector.LegacyExecutablePath(_localAppData);
        Directory.CreateDirectory(Path.GetDirectoryName(legacyExecutable)!);
        File.WriteAllBytes(legacyExecutable, [1]);

        Assert.Equal(OperatingSystem.IsWindows(), LegacyInstallDetector.IsPresent(_localAppData));
    }

    [Fact]
    public void IsPresent_FalseWhenNothingIsThere()
    {
        Directory.CreateDirectory(_localAppData);
        Assert.False(LegacyInstallDetector.IsPresent(_localAppData));
    }

    [Fact]
    public void LegacyExecutablePath_NamesTheOldPackIdAndExecutable()
    {
        var path = LegacyInstallDetector.LegacyExecutablePath(_localAppData);

        Assert.Equal(
            Path.Combine(_localAppData, "Mnemo.Desktop", "current", "Mnemo.UI.exe"),
            path);
    }
}

public sealed class LegacyInstallWarningTests
{
    [Fact]
    public async Task ShouldWarnAsync_TrueOnceWhenTheLegacyInstallIsPresent()
    {
        var settings = new FakeSettings();
        var warning = new LegacyInstallWarning(settings, isLegacyInstallPresent: () => true);

        Assert.True(await warning.ShouldWarnAsync());
    }

    [Fact]
    public async Task ShouldWarnAsync_FalseOnASecondCallEvenAcrossANewInstance()
    {
        var settings = new FakeSettings();
        var first = new LegacyInstallWarning(settings, isLegacyInstallPresent: () => true);
        Assert.True(await first.ShouldWarnAsync());

        // A fresh instance sharing the same settings store, standing in for the next launch.
        var second = new LegacyInstallWarning(settings, isLegacyInstallPresent: () => true);
        Assert.False(await second.ShouldWarnAsync());
    }

    [Fact]
    public async Task ShouldWarnAsync_FalseWhenNoLegacyInstallIsPresent()
    {
        var settings = new FakeSettings();
        var warning = new LegacyInstallWarning(settings, isLegacyInstallPresent: () => false);

        Assert.False(await warning.ShouldWarnAsync());
        Assert.False(await settings.GetAsync(LegacyInstallWarning.ShownSettingKey, false));
    }

    private sealed class FakeSettings : ISettingsService
    {
        private readonly Dictionary<string, object?> _values = new(StringComparer.Ordinal);

        public event EventHandler<string>? SettingChanged;

        public Task<T> GetAsync<T>(string key, T defaultValue = default!)
        {
            if (!_values.TryGetValue(key, out var value) || value is null)
                return Task.FromResult(defaultValue);

            return Task.FromResult(value is T typed ? typed : defaultValue);
        }

        public Task SetAsync<T>(string key, T value)
        {
            _values[key] = value;
            SettingChanged?.Invoke(this, key);
            return Task.CompletedTask;
        }

        public Task<bool> ExistsAsync(string key) =>
            Task.FromResult(_values.TryGetValue(key, out var value) && value is not null);
    }
}
