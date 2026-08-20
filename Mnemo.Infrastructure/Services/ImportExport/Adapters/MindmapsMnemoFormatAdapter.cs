using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
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
                Warnings = { MnemoPackagePreviewWarning.PreviewFailed(preview.ErrorMessage) }
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

        return new ImportExportResult
        {
            Success = import.IsSuccess && import.Value != null && import.Value.Success,
            ContentType = ContentType,
            FormatId = FormatId,
            ProcessedCounts = import.Value?.ImportedCountsByPayload ?? new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase),
            Warnings = import.Value?.Warnings ?? new List<TransferWarning>(),
            ErrorMessage = import.IsSuccess ? null : import.ErrorMessage
        };
    }

    public async Task<ImportExportResult> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var payloadOptions = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (request.Payload is MindmapDocumentSummary summary && !string.IsNullOrWhiteSpace(summary.Id))
            payloadOptions["mindmaps.mapIds"] = new[] { summary.Id };
        else if (request.Payload is MindmapLibraryEntry entry && !string.IsNullOrWhiteSpace(entry.Document.Id))
            payloadOptions["mindmaps.mapIds"] = new[] { entry.Document.Id };
        else if (request.Payload is string mapId && !string.IsNullOrWhiteSpace(mapId))
            payloadOptions["mindmaps.mapIds"] = new[] { mapId };
        else if (request.Payload is IEnumerable<string> mapIds)
        {
            var selected = mapIds.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToArray();
            if (selected.Length > 0)
                payloadOptions["mindmaps.mapIds"] = selected;
        }

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
