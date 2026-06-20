using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Models.Tools.Settings;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Tools;

/// <summary>Safe, allowlisted settings access for AI tools.</summary>
public sealed class SettingsToolService
{
    private readonly ISettingsService _settings;
    private readonly IThemeService _themeService;

    /// <summary>Same storage key as <see cref="IThemeService"/> / UI theme application.</summary>
    private const string ThemeSettingKey = "Appearance.Theme";

    /// <summary>Must stay aligned with <c>Mnemo.UI.Services.ThemeService</c> bundled themes.</summary>
    private static readonly string[] ThemeIds = ["Dawn", "Noon", "Dusk", "Ember", "Glass"];

    /// <summary>Human-friendly keys models often use; values are catalog keys used for storage.</summary>
    private static readonly IReadOnlyDictionary<string, string> KeyAliases =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["theme"] = ThemeSettingKey,
        };

    private static readonly IReadOnlyDictionary<string, SettingDescriptor> Catalog = new Dictionary<string, SettingDescriptor>
    {
        [ThemeSettingKey] = new("Appearance", true, "Dawn", CoerceTheme, ThemeIds),
        ["App.Language"] = new("App", true, "en", v => v?.ToString() ?? "en"),
        ["App.EnableGamification"] = new("App", true, true, CoerceBool),
        ["App.EnableToasts"] = new("App", true, true, CoerceBool),
        ["App.LaunchAtStartup"] = new("App", true, false, CoerceBool),
        ["App.Icon"] = new("App", false, string.Empty, v => v?.ToString() ?? string.Empty),
        ["User.DisplayName"] = new("User", true, "John Doe", v => v?.ToString() ?? "John Doe"),
        ["User.ProfilePicture"] = new("User", false, string.Empty, v => v?.ToString() ?? string.Empty),
        ["Editor.AutoSave"] = new("Editor", true, true, CoerceBool),
        ["Editor.SpellCheck"] = new("Editor", true, true, CoerceBool),
        ["Editor.SpellCheckLanguages"] = new("Editor", true, "en", v => v?.ToString() ?? "en"),
        ["Editor.Width"] = new("Editor", true, "Wide", v => v?.ToString() ?? "Wide"),
        ["AI.EnableAssistant"] = new("AI", true, false, CoerceBool),
        ["AI.SmartUnitGeneration"] = new("AI", true, false, CoerceBool),
        ["AI.GpuAcceleration"] = new("AI", true, false, CoerceBool),
        ["AI.EnableRAG"] = new("AI", true, true, CoerceBool),
        ["AI.EmbeddingModel"] = new("AI", true, "BgeSmallFast", v => v?.ToString() ?? "BgeSmallFast"),
    };

    private sealed record SettingDescriptor(
        string Category,
        bool Writable,
        object Default,
        Func<object?, object> Coerce,
        IReadOnlyList<string>? AllowedValues = null);

    public sealed record SettingCatalogEntry(
        string Key,
        string Category,
        bool Writable,
        IReadOnlyList<string>? AllowedValues);

    private static bool TryGetDescriptor(string trimmedKey, out string catalogKey, out SettingDescriptor descriptor)
    {
        if (Catalog.TryGetValue(trimmedKey, out var d))
        {
            catalogKey = trimmedKey;
            descriptor = d;
            return true;
        }

        if (KeyAliases.TryGetValue(trimmedKey, out var alias) && Catalog.TryGetValue(alias, out d))
        {
            catalogKey = alias;
            descriptor = d;
            return true;
        }

        catalogKey = trimmedKey;
        descriptor = default!;
        return false;
    }

    public SettingsToolService(ISettingsService settings, IThemeService themeService)
    {
        _settings = settings;
        _themeService = themeService;
    }

    public IReadOnlyList<SettingCatalogEntry> GetCatalogEntries()
    {
        return Catalog
            .Select(kv => new SettingCatalogEntry(
                kv.Key,
                kv.Value.Category,
                kv.Value.Writable,
                kv.Value.AllowedValues))
            .ToList();
    }

    public async Task<ToolInvocationResult> GetSettingAsync(GetSettingParameters p)
    {
        if (string.IsNullOrWhiteSpace(p.Key))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "key is required.");
        var requested = p.Key.Trim();
        if (!TryGetDescriptor(requested, out var catalogKey, out var desc))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "Unknown or restricted setting key.");

        var val = await GetBoxedAsync(catalogKey, desc.Default).ConfigureAwait(false);
        return ToolInvocationResult.Success("OK", new { key = catalogKey, category = desc.Category, writable = desc.Writable, value = val });
    }

    public async Task<ToolInvocationResult> SetSettingAsync(SetSettingParameters p)
    {
        if (string.IsNullOrWhiteSpace(p.Key))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "key is required.");
        var requested = p.Key.Trim();
        if (!TryGetDescriptor(requested, out var catalogKey, out var desc) || !desc.Writable)
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "Key is not writable or unknown.");

        object coerced;
        try
        {
            coerced = desc.Coerce(p.Value);
        }
        catch (Exception ex)
        {
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, $"Invalid value: {ex.Message}");
        }

        await PersistSettingAsync(catalogKey, coerced).ConfigureAwait(false);
        return ToolInvocationResult.Success("Setting updated.", new { key = catalogKey, value = coerced });
    }

    public Task<ToolInvocationResult> ListSettingsAsync(ListSettingsParameters p)
    {
        var catFilter = p.Category?.Trim();
        var list = new List<object>();
        foreach (var kv in Catalog)
        {
            if (!string.IsNullOrEmpty(catFilter) &&
                !string.Equals(kv.Value.Category, catFilter, StringComparison.OrdinalIgnoreCase))
                continue;
            list.Add(new
            {
                key = kv.Key,
                category = kv.Value.Category,
                writable = kv.Value.Writable,
                allowedValues = kv.Value.AllowedValues
            });
        }

        return Task.FromResult(ToolInvocationResult.Success($"Catalog: {list.Count} keys.", new { keys = list }));
    }

    public async Task<ToolInvocationResult> ResetSettingAsync(ResetSettingParameters p)
    {
        if (string.IsNullOrWhiteSpace(p.Key))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "key is required.");
        var requested = p.Key.Trim();
        if (!TryGetDescriptor(requested, out var catalogKey, out var desc) || !desc.Writable)
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "Key is not writable or unknown.");

        await PersistSettingAsync(catalogKey, desc.Default).ConfigureAwait(false);
        return ToolInvocationResult.Success("Reset to default.", new { key = catalogKey, value = desc.Default });
    }

    private async Task<object> GetBoxedAsync(string key, object defaultVal)
    {
        return defaultVal switch
        {
            bool d => await _settings.GetAsync(key, d).ConfigureAwait(false),
            int d => await _settings.GetAsync(key, d).ConfigureAwait(false),
            string d => await _settings.GetAsync(key, d).ConfigureAwait(false),
            _ => await _settings.GetAsync(key, defaultVal?.ToString() ?? string.Empty).ConfigureAwait(false)
        };
    }

    private async Task PersistSettingAsync(string key, object value)
    {
        if (string.Equals(key, ThemeSettingKey, StringComparison.Ordinal) && value is string theme)
        {
            await _themeService.ApplyThemeAsync(theme).ConfigureAwait(false);
            return;
        }

        await SetDynamicAsync(key, value).ConfigureAwait(false);
    }

    private async Task SetDynamicAsync(string key, object value)
    {
        switch (value)
        {
            case bool b:
                await _settings.SetAsync(key, b).ConfigureAwait(false);
                break;
            case int i:
                await _settings.SetAsync(key, i).ConfigureAwait(false);
                break;
            case string s:
                await _settings.SetAsync(key, s).ConfigureAwait(false);
                break;
            default:
                await _settings.SetAsync(key, value.ToString() ?? string.Empty).ConfigureAwait(false);
                break;
        }
    }

    private static object CoerceBool(object? v)
    {
        return v switch
        {
            bool b => b,
            JsonElement je when je.ValueKind == JsonValueKind.True => true,
            JsonElement je when je.ValueKind == JsonValueKind.False => false,
            string s when bool.TryParse(s, out var b) => b,
            _ => throw new InvalidOperationException("Expected boolean.")
        };
    }

    private static object CoerceTheme(object? v)
    {
        var s = (v switch
        {
            null => throw new InvalidOperationException("Expected theme name string."),
            JsonElement je when je.ValueKind == JsonValueKind.String => je.GetString() ?? string.Empty,
            _ => v!.ToString() ?? string.Empty
        }).Trim();

        if (string.IsNullOrEmpty(s))
            throw new InvalidOperationException("Theme name is required.");

        foreach (var id in ThemeIds)
        {
            if (string.Equals(s, id, StringComparison.OrdinalIgnoreCase))
                return id;
        }

        throw new InvalidOperationException($"Theme must be one of: {string.Join(", ", ThemeIds)}.");
    }
}
