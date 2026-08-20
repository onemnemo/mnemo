using Mnemo.Core.Services;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Gates <see cref="LegacyInstallDetector"/> behind a one-shot settings flag, so the warning it
/// feeds is shown at most once, even across restarts.
/// </summary>
public sealed class LegacyInstallWarning
{
    /// <summary>
    /// Internal bookkeeping only, deliberately not in
    /// <see cref="Mnemo.Host.Settings.SettingsKeyRegistry"/>: the SPA never reads or writes it
    /// directly, only <see cref="ShouldWarnAsync"/> does.
    /// </summary>
    public const string ShownSettingKey = "App.LegacyInstallWarningShown";

    private readonly ISettingsService _settings;
    private readonly Func<bool> _isLegacyInstallPresent;

    public LegacyInstallWarning(ISettingsService settings, Func<bool>? isLegacyInstallPresent = null)
    {
        _settings = settings;
        _isLegacyInstallPresent = isLegacyInstallPresent ?? (() => LegacyInstallDetector.IsPresent());
    }

    /// <summary>
    /// True the first time this is called while the legacy install is present; false on every
    /// later call, whether or not the legacy install is still there, since the flag a true
    /// answer sets is never cleared.
    /// </summary>
    public async Task<bool> ShouldWarnAsync(CancellationToken cancellationToken = default)
    {
        if (!_isLegacyInstallPresent())
            return false;

        var alreadyShown = await _settings.GetAsync(ShownSettingKey, false).ConfigureAwait(false);
        if (alreadyShown)
            return false;

        cancellationToken.ThrowIfCancellationRequested();
        await _settings.SetAsync(ShownSettingKey, true).ConfigureAwait(false);
        return true;
    }
}
