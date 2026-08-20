using System.Security;

using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Host.Startup;

namespace Mnemo.Host.Tests.Startup;

/// <summary>
/// Reconciling for real needs a login session to register against, which this suite
/// does not have. What it can drive directly: where the mac and linux entries live,
/// what they say, and how the file on disk tracks the enabled flag once a path and a
/// composer are handed to it.
/// </summary>
public sealed class LaunchAtStartupServiceTests
{
    [Fact]
    public void MacLaunchAgentPath_SitsUnderLibraryLaunchAgents()
    {
        var expected = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Library",
            "LaunchAgents",
            "com.mnemo.app.plist");

        Assert.Equal(expected, LaunchAtStartupService.MacLaunchAgentPath());
    }

    [Fact]
    public void ComposeMacLaunchAgent_RunsTheExecutableAtLoadAndNotKeptAlive()
    {
        var plist = LaunchAtStartupService.ComposeMacLaunchAgent("/Applications/Mnemo.app/Contents/MacOS/Mnemo");

        Assert.Contains("<key>Label</key>", plist);
        Assert.Contains("<string>com.mnemo.app</string>", plist);
        Assert.Contains("<string>/Applications/Mnemo.app/Contents/MacOS/Mnemo</string>", plist);
        Assert.Contains("<key>RunAtLoad</key>", plist);
        Assert.Contains("<true/>", plist);
        // RunAtLoad and not KeepAlive: quitting the app should not have launchd relaunch it.
        Assert.DoesNotContain("KeepAlive", plist);
    }

    [Fact]
    public void ComposeMacLaunchAgent_XmlEscapesTheExecutablePath()
    {
        const string executable = "/Users/A & B/Mnemo";

        var plist = LaunchAtStartupService.ComposeMacLaunchAgent(executable);

        Assert.Contains(SecurityElement.Escape(executable)!, plist);
        Assert.DoesNotContain("A & B", plist);
    }

    [Fact]
    public void ComposeLinuxAutostart_QuotesTheExecutableForTheDesktopEntrySpec()
    {
        var entry = LaunchAtStartupService.ComposeLinuxAutostart("/opt/My Programs/Mnemo/mnemo");

        Assert.Contains("[Desktop Entry]", entry);
        Assert.Contains("Exec=\"/opt/My Programs/Mnemo/mnemo\"", entry);
        Assert.Contains("X-GNOME-Autostart-enabled=true", entry);
    }

    [Fact]
    public void LinuxAutostartPath_UsesXdgConfigHome_WhenSet()
    {
        using var scope = new EnvironmentVariableScope("XDG_CONFIG_HOME", "/custom/config");

        Assert.Equal(
            Path.Combine("/custom/config", "autostart", "mnemo.desktop"),
            LaunchAtStartupService.LinuxAutostartPath());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void LinuxAutostartPath_FallsBackToDotConfig_WhenXdgConfigHomeIsUnset(string? xdgConfigHome)
    {
        using var scope = new EnvironmentVariableScope("XDG_CONFIG_HOME", xdgConfigHome);

        var expected = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".config",
            "autostart",
            "mnemo.desktop");

        Assert.Equal(expected, LaunchAtStartupService.LinuxAutostartPath());
    }

    [Fact]
    public void ApplyToFile_WritesTheComposedContent_WhenEnabled()
    {
        using var directory = new TemporaryDirectory();
        using var service = new LaunchAtStartupService(new FakeSettings(), new FakeLogger());
        var path = Path.Combine(directory.Path, "entry.txt");

        service.ApplyToFile(true, path, _ => "composed content");

        Assert.True(File.Exists(path));
        Assert.Equal("composed content", File.ReadAllText(path));
    }

    [Fact]
    public void ApplyToFile_CreatesTheParentDirectory_WhenItDoesNotExistYet()
    {
        using var directory = new TemporaryDirectory();
        using var service = new LaunchAtStartupService(new FakeSettings(), new FakeLogger());
        var path = Path.Combine(directory.Path, "nested", "autostart", "entry.txt");

        service.ApplyToFile(true, path, _ => "composed content");

        Assert.True(File.Exists(path));
    }

    [Fact]
    public void ApplyToFile_DoesNotRewriteTheFile_WhenTheComposedContentIsUnchanged()
    {
        // Reconcile runs on every boot; a file that already says the right thing should
        // not have its timestamp churned for no change.
        using var directory = new TemporaryDirectory();
        using var service = new LaunchAtStartupService(new FakeSettings(), new FakeLogger());
        var path = Path.Combine(directory.Path, "entry.txt");

        service.ApplyToFile(true, path, _ => "same content");
        var firstWrite = File.GetLastWriteTimeUtc(path);

        service.ApplyToFile(true, path, _ => "same content");

        Assert.Equal(firstWrite, File.GetLastWriteTimeUtc(path));
    }

    [Fact]
    public void ApplyToFile_RemovesAnExistingFile_WhenDisabled()
    {
        using var directory = new TemporaryDirectory();
        var path = Path.Combine(directory.Path, "entry.txt");
        File.WriteAllText(path, "stale");
        using var service = new LaunchAtStartupService(new FakeSettings(), new FakeLogger());

        service.ApplyToFile(false, path, _ => "composed content");

        Assert.False(File.Exists(path));
    }

    [Fact]
    public void ApplyToFile_DoesNothing_WhenDisabledAndNoFileExists()
    {
        using var directory = new TemporaryDirectory();
        var path = Path.Combine(directory.Path, "entry.txt");
        using var service = new LaunchAtStartupService(new FakeSettings(), new FakeLogger());

        service.ApplyToFile(false, path, _ => "composed content");

        Assert.False(File.Exists(path));
    }

    /// <summary>
    /// Sets one environment variable for the duration of a test and restores whatever
    /// was there before on dispose. Safe without cross-test isolation: <c>XDG_CONFIG_HOME</c>
    /// is read nowhere else in the codebase, so no other test observes the change.
    /// </summary>
    private sealed class EnvironmentVariableScope : IDisposable
    {
        private readonly string _name;
        private readonly string? _previous;

        public EnvironmentVariableScope(string name, string? value)
        {
            _name = name;
            _previous = Environment.GetEnvironmentVariable(name);
            Environment.SetEnvironmentVariable(name, value);
        }

        public void Dispose() => Environment.SetEnvironmentVariable(_name, _previous);
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public string Path { get; } =
            System.IO.Path.Combine(System.IO.Path.GetTempPath(), "mnemo-launch-at-startup-tests", Guid.NewGuid().ToString("N"));

        public TemporaryDirectory() => Directory.CreateDirectory(Path);

        public void Dispose()
        {
            if (Directory.Exists(Path))
                Directory.Delete(Path, recursive: true);
        }
    }

    private sealed class FakeSettings : ISettingsService
    {
        public event EventHandler<string>? SettingChanged;

        public Task<T> GetAsync<T>(string key, T defaultValue = default!) => Task.FromResult(defaultValue);

        public Task SetAsync<T>(string key, T value)
        {
            SettingChanged?.Invoke(this, key);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
