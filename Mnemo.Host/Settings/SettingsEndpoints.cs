using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Settings;

/// <summary>
/// The app-preferences surface the SPA reads at startup and writes on change.
/// Backed by the same services and setting keys the desktop app uses, so the two
/// UIs stay in sync against one database during the parallel phase.
/// </summary>
public static class SettingsEndpoints
{
    // Mirrors Mnemo.UI's Bootstrapper.LoadSavedLanguageAsync / LanguageSettingViewModel.
    private const string LanguageSettingKey = "App.Language";
    private const string DefaultLanguage = "en";

    public static void MapSettings(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/settings", async (IThemeService themes, ISettingsService settings) =>
        {
            var theme = await themes.GetCurrentThemeAsync().ConfigureAwait(false);
            var language = await settings.GetAsync(LanguageSettingKey, DefaultLanguage).ConfigureAwait(false);
            // The SPA renders with the lowercase id; the DB holds the canonical name.
            return new AppSettingsDto(theme.ToLowerInvariant(), language ?? DefaultLanguage);
        });

        endpoints.MapPut("/api/settings/theme", async (UpdateSettingDto body, IThemeService themes) =>
        {
            // The SPA sends the lowercase id; resolve it back to the canonical name
            // (ApplyThemeAsync validates and falls back to the default on a miss).
            var all = await themes.GetAllThemesAsync().ConfigureAwait(false);
            var canonical = all.FirstOrDefault(t => string.Equals(t.Name, body.Value, StringComparison.OrdinalIgnoreCase))?.Name
                            ?? body.Value;
            await themes.ApplyThemeAsync(canonical).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapPut("/api/settings/language", async (UpdateSettingDto body, ISettingsService settings, ILocalizationService localization, CancellationToken cancellationToken) =>
        {
            await settings.SetAsync(LanguageSettingKey, body.Value).ConfigureAwait(false);
            // Mirror the desktop: persisting the choice and switching the server's
            // active culture are one action, so server-emitted strings follow.
            await localization.SetLanguageAsync(body.Value, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }
}
