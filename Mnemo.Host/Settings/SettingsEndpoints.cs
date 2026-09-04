using System.Collections.Generic;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Modules.Proofing;

namespace Mnemo.Host.Settings;

/// <summary>
/// The app-preferences surface the SPA reads at startup and writes on change,
/// backed by the settings service and the same stored keys the rest of the app
/// reads, so a preference set here is the one every other reader sees.
/// </summary>
public static class SettingsEndpoints
{
    // The stored key holding the chosen UI language.
    private const string LanguageSettingKey = "App.Language";
    private const string DefaultLanguage = "en";

    // The proofing languages, checked below against what actually shipped.
    private const string ProofingLanguageKey = "Proofing.Language";
    private const string ProofingLanguagesKey = "Proofing.Languages";

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

        endpoints.MapPut("/api/settings/values/{key}", async (string key, SettingValueDto body, ISettingsService settings, IServiceProvider services) =>
        {
            if (!SettingsKeyRegistry.TryGet(key, out var descriptor))
                return Results.NotFound(new ErrorDto("unknown_setting", $"'{key}' is not an exposed setting."));

            if (RejectUnknownProofingLanguage(key, body.Value, services) is { } rejected)
                return rejected;

            switch (descriptor.Kind)
            {
                case SettingValueKind.Boolean when body.Value.ValueKind is JsonValueKind.True or JsonValueKind.False:
                    await settings.SetAsync(key, body.Value.GetBoolean()).ConfigureAwait(false);
                    return Results.NoContent();

                case SettingValueKind.Text when body.Value.ValueKind is JsonValueKind.String:
                    await settings.SetAsync(key, body.Value.GetString() ?? string.Empty).ConfigureAwait(false);
                    return Results.NoContent();

                case SettingValueKind.StringList when body.Value.ValueKind is JsonValueKind.Array:
                {
                    var items = ReadStringList(body.Value);
                    if (items is null)
                        return InvalidValue($"'{key}' is stored as a {Shape(descriptor.Kind)}.");

                    // The proofing set is the only list key, and its entries have to name languages
                    // this build knows, so the check asks the feature the way the single-language
                    // guard below does.
                    var stored = string.Equals(key, ProofingLanguagesKey, StringComparison.Ordinal)
                        ? CanonicalProofingLanguages(items, services)
                        : items;
                    if (stored is null)
                        return InvalidValue($"'{key}' takes languages this build knows about.");

                    // Stored as string[] because that is the type the proofing service reads it back
                    // as. The settings cache holds the written value and type-tests it on read, so a
                    // List<string> here would read back as absent until the next launch.
                    await settings.SetAsync(key, stored).ConfigureAwait(false);
                    return Results.NoContent();
                }

                default:
                    return InvalidValue($"'{key}' is stored as a {Shape(descriptor.Kind)}.");
            }
        });
    }

    /// <summary>
    /// The array as <c>string[]</c>, or null when any element is something other than a string.
    /// </summary>
    private static string[]? ReadStringList(JsonElement value)
    {
        var items = new List<string>();
        foreach (var element in value.EnumerateArray())
        {
            if (element.ValueKind is not JsonValueKind.String)
                return null;

            items.Add(element.GetString() ?? string.Empty);
        }

        return [.. items];
    }

    /// <summary>
    /// The proofing languages in the catalog's own spelling, without duplicates and in the order
    /// given, or null when one of them names no language this build carries.
    /// <para>
    /// A tag is refused rather than dropped for the same reason the single-language guard refuses
    /// one: a settings page showing a choice that every check then ignores is worse than a failed
    /// write. Uninstalled languages are kept, because resolution filters those and the picker can
    /// legitimately hold one that a later build will ship.
    /// </para>
    /// </summary>
    internal static string[]? CanonicalProofingLanguages(IReadOnlyList<string> requested, IServiceProvider services)
    {
        var catalog = services.GetRequiredService<ProofingDictionaryCatalog>();

        // The catalog is the whole population, so anything longer is duplicates or junk. Taking the
        // first entries bounds the lookups below rather than trusting the request's length.
        var capped = requested.Count > catalog.Entries.Count
            ? requested.Take(catalog.Entries.Count).ToArray()
            : requested;

        if (capped.Any(id => catalog.Find(id) is null))
            return null;

        return [.. ProofingLanguages.Canonical(catalog, capped)];
    }

    private static IResult InvalidValue(string message) =>
        Results.BadRequest(new ErrorDto("invalid_setting_value", message));

    private static string Shape(SettingValueKind kind) => kind switch
    {
        SettingValueKind.Boolean => "boolean",
        SettingValueKind.StringList => "list of strings",
        _ => "string",
    };

    /// <summary>
    /// Refuses a proofing language with no dictionary behind it, and returns null for every other
    /// key and every allowed value.
    /// <para>
    /// This is the one exposed key whose valid values depend on which dictionaries shipped rather
    /// than on a fixed list, so the check has to ask the feature. Storing a language nothing can
    /// check would leave the settings page showing a choice that every check then quietly ignores.
    /// </para>
    /// </summary>
    internal static IResult? RejectUnknownProofingLanguage(string key, JsonElement value, IServiceProvider services)
    {
        if (!string.Equals(key, ProofingLanguageKey, StringComparison.Ordinal))
            return null;

        if (value.ValueKind is not JsonValueKind.String)
            return null;

        // Resolved here rather than taken as a handler parameter, so that a proofing service which
        // cannot be constructed fails the one key that needs it instead of every settings write.
        var proofing = services.GetRequiredService<IProofingService>();
        var language = value.GetString() ?? string.Empty;
        return proofing.IsInstalled(language)
            ? null
            : Results.BadRequest(new ErrorDto("unknown_proofing_language", $"'{language}' has no installed dictionary."));
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
        // rather than null; that reads as Undefined, alongside a stored JSON null.
        var value = result.Value;
        return value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ? null : value;
    }
}
