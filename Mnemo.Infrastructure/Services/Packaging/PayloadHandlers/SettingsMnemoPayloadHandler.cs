using System.Text;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

public sealed class SettingsMnemoPayloadHandler : IMnemoPayloadHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly string[] DefaultKeys =
    [
        "App.Language",
        "Theme.Current",
        "Theme.Mode"
    ];

    private readonly ISettingsService _settingsService;

    public SettingsMnemoPayloadHandler(ISettingsService settingsService)
    {
        _settingsService = settingsService;
    }

    public string PayloadType => "settings";

    public async Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default)
    {
        var keys = ResolveKeys(context.Options);
        var entries = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in keys)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var value = await _settingsService.GetAsync<string>(key, string.Empty).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(value))
                entries[key] = value;
        }

        return new MnemoPayloadExportData
        {
            ItemCount = entries.Count,
            SchemaVersion = 1,
            Files = new Dictionary<string, byte[]>
            {
                ["settings.json"] = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(entries, JsonOptions))
            }
        };
    }

    public async Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
    {
        if (!context.Files.TryGetValue("settings.json", out var bytes))
            return new MnemoPayloadImportResult { Warnings = { TransferWarning.Of("SettingsPayloadMissingFile") } };

        var entries = JsonSerializer.Deserialize<Dictionary<string, string>>(bytes, JsonOptions)
            ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var allowedKeys = new HashSet<string>(ResolveKeys(new MnemoPackageExportOptions
        {
            PayloadOptions = context.Options.PayloadOptions
        }), StringComparer.OrdinalIgnoreCase);

        var result = new MnemoPayloadImportResult();
        foreach (var pair in entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!allowedKeys.Contains(pair.Key))
            {
                result.Warnings.Add(TransferWarning.Of("SettingsKeyNotAllowed", ("settingKey", pair.Key)));
                continue;
            }

            await _settingsService.SetAsync(pair.Key, pair.Value).ConfigureAwait(false);
            result.ImportedCount++;
        }

        return result;
    }

    private static IReadOnlyList<string> ResolveKeys(MnemoPackageExportOptions options)
    {
        if (options.PayloadOptions.TryGetValue("settings.keys", out var raw) && raw is IEnumerable<string> keys)
            return keys.Where(k => !string.IsNullOrWhiteSpace(k)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        return DefaultKeys;
    }
}
