using System.Runtime.Versioning;
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
