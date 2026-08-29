using System.Runtime.Versioning;
using System.Security;

using Mnemo.Core.Services;

namespace Mnemo.Host.Startup;

/// <summary>
/// Keeps the operating system's autostart entry in step with the
/// <c>App.LaunchAtStartup</c> setting.
/// </summary>
/// <remarks>
/// Reconciled at boot as well as on change: the setting can be written by another
/// instance, arrive through an import, or be restored from a backup while this
/// process is not running, and the executable path itself moves when the app is
/// reinstalled elsewhere.
/// </remarks>
public sealed class LaunchAtStartupService : IDisposable
{
    public const string SettingKey = "App.LaunchAtStartup";

    private const string Category = "Mnemo.Host";

    /// <summary>The Run value name. Renaming it strands whatever the old name registered.</summary>
    private const string EntryName = "Mnemo";

    /// <summary>
    /// The launchd label, and the plist is named for it. Strands the old entry if renamed,
    /// exactly as <see cref="EntryName"/> does.
    /// </summary>
    private const string MacLaunchAgentLabel = "com.mnemo.app";

    /// <summary>The autostart entry's file name. Renaming it strands the old file.</summary>
    private const string LinuxAutostartFileName = "mnemo.desktop";

    private readonly ISettingsService _settings;
    private readonly ILoggerService _logger;

    public LaunchAtStartupService(ISettingsService settings, ILoggerService logger)
    {
        _settings = settings;
        _logger = logger;
        _settings.SettingChanged += OnSettingChanged;
    }

    public void Dispose() => _settings.SettingChanged -= OnSettingChanged;

    /// <summary>Brings the autostart entry in line with the saved setting.</summary>
    public async Task ReconcileAsync()
    {
        try
        {
            var enabled = await _settings.GetAsync(SettingKey, false).ConfigureAwait(false);

            if (OperatingSystem.IsWindows())
                ApplyOnWindows(enabled);
            else if (OperatingSystem.IsMacOS())
                ApplyToFile(enabled, MacLaunchAgentPath(), ComposeMacLaunchAgent);
            else if (OperatingSystem.IsLinux())
                ApplyToFile(enabled, LinuxAutostartPath(), ComposeLinuxAutostart);
        }
        catch (Exception ex)
        {
            // A toggle that fails to take is worth reporting, but not worth failing a
            // settings write or a startup over.
            _logger.Error(Category, "Could not apply the launch at startup setting.", ex);
        }
    }

    private void OnSettingChanged(object? sender, string key)
    {
        if (!string.Equals(key, SettingKey, StringComparison.Ordinal))
            return;

        // The write that raised this is on a request thread; registry work does not belong
        // there, and ReconcileAsync reports its own failures rather than faulting the task.
        _ = Task.Run(ReconcileAsync);
    }

    [SupportedOSPlatform("windows")]
    private void ApplyOnWindows(bool enabled)
    {
        var current = WindowsRunKey.Read(EntryName);

        if (!enabled)
        {
            if (current is null)
                return;

            WindowsRunKey.Remove(EntryName);
            _logger.Info(Category, "Removed the launch at startup entry.");
            return;
        }

        var command = ResolveCommand();
        if (command is null)
        {
            _logger.Warning(Category, "Launch at startup is on, but this process has no resolvable executable path to register.");
            return;
        }

        if (string.Equals(current, command, StringComparison.OrdinalIgnoreCase))
            return;

        WindowsRunKey.Write(EntryName, command);
        _logger.Info(Category, $"Registered {command} to launch at startup.");
    }

    /// <summary>
    /// Writes or removes the autostart file that stands in for the Windows Run key.
    /// </summary>
    /// <remarks>
    /// macOS and the XDG desktops both read their autostart directory at login, so the file
    /// being on disk is the entire registration: nothing to load, nothing to reload, and
    /// deleting it deregisters cleanly. Internal rather than private so the write/remove/
    /// idempotent-rewrite behaviour can be driven directly against a temp file in a test,
    /// which needs no login session and no real mac or linux to run.
    /// </remarks>
    internal void ApplyToFile(bool enabled, string path, Func<string, string> compose)
    {
        if (!enabled)
        {
            if (!File.Exists(path))
                return;

            File.Delete(path);
            _logger.Info(Category, "Removed the launch at startup entry.");
            return;
        }

        var executable = ResolveAutostartExecutable(
            OperatingSystem.IsLinux(),
            Environment.GetEnvironmentVariable("APPIMAGE"),
            Environment.ProcessPath);
        if (string.IsNullOrWhiteSpace(executable))
        {
            _logger.Warning(Category, "Launch at startup is on, but this process has no resolvable executable path to register.");
            return;
        }

        var desired = compose(executable);

        // Reconcile runs on every boot, and rewriting a file that already says the right
        // thing would churn its timestamp each time for no change.
        if (File.Exists(path) && string.Equals(File.ReadAllText(path), desired, StringComparison.Ordinal))
            return;

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, desired);
        _logger.Info(Category, $"Registered {executable} to launch at startup.");
    }

    /// <summary>
    /// Resolves the executable to register for startup. AppImage mounts disappear at exit, so Linux
    /// prefers APPIMAGE over the temporary process path.
    /// </summary>
    internal static string? ResolveAutostartExecutable(bool isLinux, string? appImage, string? processPath) =>
        isLinux && !string.IsNullOrWhiteSpace(appImage) ? appImage : processPath;

    /// <remarks>Internal rather than private so the path formula has a unit test of its own.</remarks>
    internal static string MacLaunchAgentPath() =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Library",
            "LaunchAgents",
            $"{MacLaunchAgentLabel}.plist");

    /// <remarks>
    /// RunAtLoad and not KeepAlive: this starts the app once at login, and someone who then
    /// quits it has quit it. Internal rather than private so the plist text has a unit test
    /// of its own, including that the executable path is XML-escaped.
    /// </remarks>
    internal static string ComposeMacLaunchAgent(string executable) =>
        $"""
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>{MacLaunchAgentLabel}</string>
            <key>ProgramArguments</key>
            <array>
                <string>{SecurityElement.Escape(executable)}</string>
            </array>
            <key>RunAtLoad</key>
            <true/>
        </dict>
        </plist>

        """;

    /// <remarks>Internal rather than private so both branches of the fallback have a unit test.</remarks>
    internal static string LinuxAutostartPath()
    {
        // The spec's own variable, falling back to the default the spec names for it.
        var configHome = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME");
        if (string.IsNullOrWhiteSpace(configHome))
            configHome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config");

        return Path.Combine(configHome, "autostart", LinuxAutostartFileName);
    }

    /// <remarks>
    /// Exec is quoted for the same reason the Windows command is: install paths contain
    /// spaces, and the desktop entry spec reads an unquoted one as an argument separator.
    /// Internal rather than private so the entry text has a unit test of its own.
    /// </remarks>
    internal static string ComposeLinuxAutostart(string executable) =>
        $"""
        [Desktop Entry]
        Type=Application
        Name=Mnemo
        Exec="{executable}"
        Terminal=false
        X-GNOME-Autostart-enabled=true

        """;

    /// <summary>
    /// The command line Windows runs at sign-in, quoted because install paths contain
    /// spaces often enough to matter.
    /// </summary>
    /// <remarks>
    /// The running executable is the right thing to register for an installed build:
    /// Velopack keeps the app under a folder named "current" and replaces its contents
    /// on update, so a path written today still resolves after the next one.
    /// </remarks>
    private static string? ResolveCommand()
    {
        var executable = Environment.ProcessPath;
        return string.IsNullOrWhiteSpace(executable) ? null : $"\"{executable}\"";
    }
}
