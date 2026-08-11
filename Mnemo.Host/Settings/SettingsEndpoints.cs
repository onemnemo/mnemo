using System.Collections.Generic;
using System.Text.Json;
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

        endpoints.MapGet("/api/themes", async (IThemeService themes) =>
        {
            var all = await themes.GetAllThemesAsync().ConfigureAwait(false);
            return all.Select(ThemeDto.FromManifest).ToList();
        });

        endpoints.MapPut("/api/settings/theme", async (UpdateSettingDto body, IThemeService themes) =>
        {
            // The SPA sends the lowercase id; ApplyThemeAsync matches case-insensitively,
            // migrates a retired name and falls back to the default on a miss.
            await themes.ApplyThemeAsync(body.Value).ConfigureAwait(false);
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

        endpoints.MapGet("/api/settings/values", async (IStorageProvider storage) =>
        {
            var values = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            var secrets = new Dictionary<string, bool>(StringComparer.Ordinal);

            foreach (var descriptor in SettingsKeyRegistry.All)
            {
                var stored = await ReadRawAsync(storage, descriptor.Key).ConfigureAwait(false);
                if (descriptor.WriteOnly)
                    secrets[descriptor.Key] = stored is { ValueKind: JsonValueKind.String } secret
                                              && !string.IsNullOrEmpty(secret.GetString());
                else if (stored is { } value)
                    values[descriptor.Key] = value;
            }

            return new SettingsValuesDto(values, secrets);
        });

        endpoints.MapPut("/api/settings/values/{key}", async (string key, SettingValueDto body, ISettingsService settings) =>
        {
            if (!SettingsKeyRegistry.TryGet(key, out var descriptor))
                return Results.NotFound(new ErrorDto("unknown_setting", $"'{key}' is not an exposed setting."));

            switch (descriptor.Kind)
            {
                case SettingValueKind.Boolean when body.Value.ValueKind is JsonValueKind.True or JsonValueKind.False:
                    await settings.SetAsync(key, body.Value.GetBoolean()).ConfigureAwait(false);
                    return Results.NoContent();

                case SettingValueKind.Text when body.Value.ValueKind is JsonValueKind.String:
                    await settings.SetAsync(key, body.Value.GetString() ?? string.Empty).ConfigureAwait(false);
                    return Results.NoContent();

                default:
                    return Results.BadRequest(new ErrorDto(
                        "invalid_setting_value",
                        $"'{key}' is stored as a {(descriptor.Kind == SettingValueKind.Boolean ? "boolean" : "string")}."));
            }
        });
    }

    /// <summary>
    /// Reads a setting as raw JSON, or null when nothing is stored.
    /// <para>
    /// This goes through <see cref="IStorageProvider"/> rather than
    /// <see cref="ISettingsService"/> on purpose: the settings cache is keyed by value,
    /// not by type, so priming it with a <see cref="JsonElement"/> would make every later
    /// <c>GetAsync&lt;bool&gt;</c> in this process fail its type check and silently return
    /// the caller's default.
    /// </para>
    /// </summary>
    private static async Task<JsonElement?> ReadRawAsync(IStorageProvider storage, string key)
    {
        var result = await storage.LoadAsync<JsonElement>(key).ConfigureAwait(false);
        if (!result.IsSuccess)
            return null;

        // JsonElement is a struct, so a missing key comes back as default(JsonElement)
        // rather than null — that reads as Undefined, alongside a stored JSON null.
        var value = result.Value;
        return value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ? null : value;
    }
}
