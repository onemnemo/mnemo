using System.Text;
using System.Text.Json;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Common;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

public sealed class MindmapsMnemoPayloadHandler : IMnemoPayloadHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IMindmapService _mindmapService;

    public MindmapsMnemoPayloadHandler(IMindmapService mindmapService)
    {
        _mindmapService = mindmapService;
    }

    public string PayloadType => "mindmaps";

    public async Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default)
    {
        var allResult = await _mindmapService.GetAllMindmapsAsync().ConfigureAwait(false);
        var items = allResult.IsSuccess ? allResult.Value?.ToList() ?? new List<Mindmap>() : new List<Mindmap>();
        var selectedIds = ResolveSelectedMindmapIds(context.Options);
        if (selectedIds.Count > 0)
            items = items.Where(m => selectedIds.Contains(m.Id)).ToList();
        return new MnemoPayloadExportData
        {
            ItemCount = items.Count,
            SchemaVersion = 1,
            Files = new Dictionary<string, byte[]>
            {
                ["data.json"] = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(items, JsonOptions))
            }
        };
    }

    public async Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
    {
        if (!context.Files.TryGetValue("data.json", out var bytes))
            return new MnemoPayloadImportResult { Warnings = { "Mindmaps payload missing data.json file." } };

        var items = JsonSerializer.Deserialize<List<Mindmap>>(bytes, JsonOptions) ?? new();
        var existing = await _mindmapService.GetAllMindmapsAsync().ConfigureAwait(false);
        var existingIds = existing.IsSuccess
            ? new HashSet<string>(existing.Value?.Select(x => x.Id) ?? Enumerable.Empty<string>(), StringComparer.Ordinal)
            : new HashSet<string>(StringComparer.Ordinal);

        var result = new MnemoPayloadImportResult();
        var policy = context.Options.ConflictPolicy;
        var usedTitles = new HashSet<string>(
            existing.IsSuccess ? existing.Value?.Select(x => x.Title) ?? Enumerable.Empty<string>() : Enumerable.Empty<string>(),
            StringComparer.OrdinalIgnoreCase);

        foreach (var mindmap in items)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var imported = CloneMindmap(mindmap);
            if (existingIds.Contains(imported.Id))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    result.SkippedCount++;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    imported.Id = Guid.NewGuid().ToString();
                    imported.Title = ImportNaming.NextAvailableName(imported.Title, usedTitles);
                    result.DuplicatedCount++;
                }
            }

            usedTitles.Add(imported.Title);
            var save = await _mindmapService.SaveMindmapAsync(imported).ConfigureAwait(false);
            if (!save.IsSuccess)
            {
                result.Warnings.Add($"Failed to import mindmap '{mindmap.Title}': {save.ErrorMessage}");
                continue;
            }

            result.ImportedCount++;
        }

        return result;
    }

    private static HashSet<string> ResolveSelectedMindmapIds(MnemoPackageExportOptions options)
    {
        if (!options.PayloadOptions.TryGetValue("mindmaps.ids", out var value))
            return new HashSet<string>(StringComparer.Ordinal);
        if (value is IEnumerable<string> ids)
            return new HashSet<string>(ids.Where(v => !string.IsNullOrWhiteSpace(v)), StringComparer.Ordinal);
        return new HashSet<string>(StringComparer.Ordinal);
    }

    private static Mindmap CloneMindmap(Mindmap source)
    {
        var json = JsonSerializer.Serialize(source, JsonOptions);
        return JsonSerializer.Deserialize<Mindmap>(json, JsonOptions) ?? new Mindmap();
    }
}
