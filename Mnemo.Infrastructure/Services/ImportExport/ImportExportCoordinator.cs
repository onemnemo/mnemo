using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ImportExport;

public sealed class ImportExportCoordinator : IImportExportCoordinator
{
    private readonly IReadOnlyList<IContentFormatAdapter> _adapters;

    public ImportExportCoordinator(IEnumerable<IContentFormatAdapter> adapters)
    {
        _adapters = adapters.ToList();
    }

    public IReadOnlyList<ImportExportCapability> GetCapabilities(string? contentType = null)
    {
        return _adapters
            .Where(a => string.IsNullOrWhiteSpace(contentType) || string.Equals(a.ContentType, contentType, StringComparison.OrdinalIgnoreCase))
            .Select(a => new ImportExportCapability
            {
                ContentType = a.ContentType,
                FormatId = a.FormatId,
                DisplayName = a.DisplayName,
                Extensions = a.Extensions.ToList(),
                SupportsImport = a.SupportsImport,
                SupportsExport = a.SupportsExport,
                SupportsConflictPolicy = a.SupportsConflictPolicy
            })
            .OrderBy(c => c.ContentType, StringComparer.OrdinalIgnoreCase)
            .ThenBy(c => c.FormatId, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public async Task<Result<ImportExportPreview>> PreviewImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var adapter = ResolveAdapter(request, forImport: true);
        if (adapter == null)
            return Result<ImportExportPreview>.Failure("No compatible import adapter was found.");

        return Result<ImportExportPreview>.Success(await adapter.PreviewImportAsync(request, cancellationToken).ConfigureAwait(false));
    }

    public async Task<Result<ImportExportResult>> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var adapter = ResolveAdapter(request, forImport: true);
        if (adapter == null)
            return Result<ImportExportResult>.Failure("No compatible import adapter was found.");

        return Result<ImportExportResult>.Success(await adapter.ImportAsync(request, cancellationToken).ConfigureAwait(false));
    }

    public async Task<Result<ImportExportResult>> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var adapter = ResolveAdapter(request, forImport: false);
        if (adapter == null)
            return Result<ImportExportResult>.Failure("No compatible export adapter was found.");

        return Result<ImportExportResult>.Success(await adapter.ExportAsync(request, cancellationToken).ConfigureAwait(false));
    }

    private IContentFormatAdapter? ResolveAdapter(ImportExportRequest request, bool forImport)
    {
        IEnumerable<IContentFormatAdapter> candidates = _adapters;
        if (!string.IsNullOrWhiteSpace(request.ContentType))
        {
            candidates = candidates.Where(a => string.Equals(a.ContentType, request.ContentType, StringComparison.OrdinalIgnoreCase));
        }

        candidates = forImport
            ? candidates.Where(a => a.SupportsImport)
            : candidates.Where(a => a.SupportsExport);

        if (!string.IsNullOrWhiteSpace(request.FormatId))
        {
            return candidates.FirstOrDefault(a => string.Equals(a.FormatId, request.FormatId, StringComparison.OrdinalIgnoreCase));
        }

        var extension = Path.GetExtension(request.FilePath);
        if (!string.IsNullOrWhiteSpace(extension))
        {
            var byExtension = candidates.FirstOrDefault(a =>
                a.Extensions.Any(ext => string.Equals(ext, extension, StringComparison.OrdinalIgnoreCase)));
            if (byExtension != null)
                return byExtension;
        }

        return candidates.FirstOrDefault();
    }
}
