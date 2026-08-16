using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// Server-side theme service. The SPA owns theme rendering, so this keeps only the
/// parts that outlive a page: the persisted <c>Appearance.Theme</c> value, the default,
/// and the migration of names the app no longer ships.
/// </summary>
/// <remarks>
/// The catalog is the SPA's two themes, not the desktop app's four. The rehaul replaced
/// the ported Avalonia palette with a single light/dark pair, and a catalog listing
/// Dawn, Noon, Dusk and Ember was not merely stale: <see cref="ApplyThemeAsync"/>
/// validates against it, so every <c>light</c> or <c>dark</c> the SPA wrote missed,
/// fell back to the default and persisted <c>Dawn</c>. Choosing dark applied for the
/// session and reverted on the next load.
/// <para>
/// The desktop app still reads this key and knows only its own four names, so it now
/// falls back to its own default. The two UIs stopped sharing a palette when the rehaul
/// landed; this makes the stored value describe what the SPA can actually render rather
/// than keeping a name neither side means.
/// </para>
/// </remarks>
public sealed class HeadlessThemeService : IThemeService
{
    private const string ThemeSettingKey = "Appearance.Theme";
    private const string DefaultTheme = "Light";

    /// <summary>
    /// Follow the operating system. Stored like a theme but absent from the catalog:
    /// it names a way of choosing one, and only the client can see the answer.
    /// </summary>
    private const string SystemTheme = "System";

    private static readonly Dictionary<string, string> LegacyThemeNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["New-Dark"] = "Dark",
        ["Dawn"] = "Light",
        ["Noon"] = "Light",
        ["Dusk"] = "Dark",
        ["Ember"] = "Dark",
    };

    private readonly ISettingsService _settings;

    public HeadlessThemeService(ISettingsService settings)
    {
        _settings = settings;
    }

    public async Task ApplyThemeAsync(string themeName)
    {
        await _settings.SetAsync(ThemeSettingKey, await CanonicalizeAsync(themeName).ConfigureAwait(false))
            .ConfigureAwait(false);
    }

    public async Task<string> GetCurrentThemeAsync()
    {
        var stored = await _settings.GetAsync(ThemeSettingKey, DefaultTheme).ConfigureAwait(false);
        return await CanonicalizeAsync(stored ?? DefaultTheme).ConfigureAwait(false);
    }

    /// <summary>
    /// The stored spelling of a requested theme: a catalog name, <c>System</c>, or the
    /// default when the value names nothing this build can render.
    /// </summary>
    private async Task<string> CanonicalizeAsync(string themeName)
    {
        if (LegacyThemeNames.TryGetValue(themeName, out var migrated))
            themeName = migrated;

        if (string.Equals(themeName, SystemTheme, StringComparison.OrdinalIgnoreCase))
            return SystemTheme;

        var available = await GetAllThemesAsync().ConfigureAwait(false);
        var match = available.FirstOrDefault(t => string.Equals(t.Name, themeName, StringComparison.OrdinalIgnoreCase));
        return match?.Name ?? DefaultTheme;
    }

    public Task<IEnumerable<ThemeManifest>> GetAllThemesAsync()
    {
        // The preview colors are the frame, canvas and line surfaces from the SPA's
        // tokens.css, in that order, as sRGB approximations of its oklch values.
        IEnumerable<ThemeManifest> themes =
        [
            new()
            {
                Name = "Light",
                DisplayName = "Light",
                Description = "Mnemo's default light theme",
                PreviewColors = ["#FBFBFB", "#FFFFFF", "#E3E3E4"],
            },
            new()
            {
                Name = "Dark",
                DisplayName = "Dark",
                Description = "Mnemo's dark theme",
                PreviewColors = ["#1B1B1E", "#1F1F22", "#333338"],
            },
        ];
        return Task.FromResult(themes);
    }

    // Rendering-side operations stay inert; the SPA applies themes itself.
    public void StartWatching() { }
    public void StopWatching() { }
    public Task<bool> ImportAsync(string path) => Task.FromResult(false);
    public Task ExportAsync(string themeName, string path) => Task.CompletedTask;
}
