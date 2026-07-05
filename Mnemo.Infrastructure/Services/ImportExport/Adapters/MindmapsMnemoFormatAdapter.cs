using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

public sealed class MindmapsMnemoFormatAdapter : IContentFormatAdapter
{
    private readonly IMnemoPackageService _packageService;

    public MindmapsMnemoFormatAdapter(IMnemoPackageService packageService)
    {
        _packageService = packageService;
    }

    public string ContentType => "mindmaps";
    public string FormatId => "mindmaps.mnemo";
    public string DisplayName => "Mnemo Package (.mnemo)";
    public IReadOnlyList<string> Extensions => [".mnemo"];
    public bool SupportsImport => true;
    public bool SupportsExport => true;

    public async Task<ImportExportPreview> PreviewImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var preview = await _packageService.PreviewAsync(request.FilePath, cancellationToken).ConfigureAwait(false);
        if (!preview.IsSuccess || preview.Value == null)
        {
            return new ImportExportPreview
            {
                CanImport = false,
                ContentType = ContentType,
                FormatId = FormatId,
                Warnings = { preview.ErrorMessage ?? "Unable to preview package." }
            };
        }

        preview.Value.DiscoveredCounts.TryGetValue("mindmaps", out var count);
        return new ImportExportPreview
        {
            CanImport = count > 0,
            ContentType = ContentType,
            FormatId = FormatId,
            DiscoveredCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["mindmaps"] = count },
            Warnings = preview.Value.Warnings
        };
    }

    public async Task<ImportExportResult> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var import = await _packageService.ImportAsync(request.FilePath, new MnemoPackageImportOptions
        {
            ConflictPolicy = ImportExportOptionKeys.GetConflictPolicy(request.Options),
            PayloadTypes = ["mindmaps"]
        }, cancellationToken).ConfigureAwait(false);

        var importedCount = import.Value?.ImportedCountsByPayload.TryGetValue("mindmaps", out var importedMindmaps) == true
            ? importedMindmaps
            : 0;
        var skippedCount = import.Value?.SkippedCountsByPayload.TryGetValue("mindmaps", out var skippedMindmaps) == true
            ? skippedMindmaps
            : 0;
        var success = import.IsSuccess && import.Value != null && import.Value.Success && importedCount + skippedCount > 0;

        return new ImportExportResult
        {
            Success = success,
            ContentType = ContentType,
            FormatId = FormatId,
            ProcessedCounts = import.Value?.ImportedCountsByPayload ?? new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase),
            Warnings = import.Value?.Warnings ?? new List<string>(),
            ErrorMessage = success
                ? null
                : import.IsSuccess
                    ? import.Value?.ErrorMessage ?? "No mindmaps were imported from the selected package."
                    : import.ErrorMessage
        };
    }

    public async Task<ImportExportResult> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var payloadOptions = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (request.Payload is string mindmapId && !string.IsNullOrWhiteSpace(mindmapId))
            payloadOptions["mindmaps.ids"] = new[] { mindmapId };

        var export = await _packageService.ExportAsync(request.FilePath, new MnemoPackageExportOptions
        {
            PayloadTypes = ["mindmaps"],
            PackageKind = "mindmaps",
            PayloadOptions = payloadOptions
        }, cancellationToken).ConfigureAwait(false);

        return new ImportExportResult
        {
            Success = export.IsSuccess,
            ContentType = ContentType,
            FormatId = FormatId,
            ErrorMessage = export.IsSuccess ? null : export.ErrorMessage,
            ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
            {
                ["mindmaps"] = export.Value?.Entries.FirstOrDefault(e => string.Equals(e.PayloadType, "mindmaps", StringComparison.OrdinalIgnoreCase))?.ItemCount ?? 0
            }
        };
    }
}
