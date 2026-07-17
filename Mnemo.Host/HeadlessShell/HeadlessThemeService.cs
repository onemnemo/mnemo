using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// Server-side theme service. The SPA owns theme rendering, so this keeps only the
/// parts that must agree with the desktop app: the persisted <c>Appearance.Theme</c>
/// setting, the default, the legacy-name migration, and the bundled catalog. Values
/// stay identical to Mnemo.UI's ThemeService so a user can move between the desktop
/// app and the SPA against the same database and see the same theme.
/// </summary>
public sealed class HeadlessThemeService : IThemeService
{
    private const string ThemeSettingKey = "Appearance.Theme";
    private const string DefaultTheme = "Dawn";

    private static readonly Dictionary<string, string> LegacyThemeNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["New-Dark"] = "Ember",
    };

    private readonly ISettingsService _settings;

    public HeadlessThemeService(ISettingsService settings)
    {
        _settings = settings;
    }

    public async Task ApplyThemeAsync(string themeName)
    {
        if (LegacyThemeNames.TryGetValue(themeName, out var migrated))
            themeName = migrated;

        var available = await GetAllThemesAsync().ConfigureAwait(false);
        if (!available.Any(t => string.Equals(t.Name, themeName, StringComparison.OrdinalIgnoreCase)))
            themeName = DefaultTheme;
        else
            themeName = available.First(t => string.Equals(t.Name, themeName, StringComparison.OrdinalIgnoreCase)).Name;

        await _settings.SetAsync(ThemeSettingKey, themeName).ConfigureAwait(false);
    }

    public async Task<string> GetCurrentThemeAsync()
    {
        var stored = await _settings.GetAsync(ThemeSettingKey, DefaultTheme).ConfigureAwait(false);
        if (LegacyThemeNames.TryGetValue(stored, out var migrated))
            stored = migrated;

        var available = await GetAllThemesAsync().ConfigureAwait(false);
        return available.Any(t => t.Name == stored) ? stored : DefaultTheme;
    }

    public Task<IEnumerable<ThemeManifest>> GetAllThemesAsync()
    {
        // The bundled catalog, mirroring Mnemo.UI ThemeService.GetAllThemesAsync.
        IEnumerable<ThemeManifest> themes =
        [
            new() { Name = "Dawn", DisplayName = "Dawn", Description = "Default light theme" },
            new() { Name = "Noon", DisplayName = "Noon", Description = "Warm editorial light theme" },
            new() { Name = "Dusk", DisplayName = "Dusk", Description = "Default dark theme" },
            new() { Name = "Ember", DisplayName = "Ember", Description = "Warm dark theme with walnut surfaces and coral accents" },
        ];
        return Task.FromResult(themes);
    }

    // Rendering-side operations stay inert; the SPA applies themes itself.
    public void StartWatching() { }
    public void StopWatching() { }
    public Task<bool> ImportAsync(string path) => Task.FromResult(false);
    public Task ExportAsync(string themeName, string path) => Task.CompletedTask;
}
