using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

public sealed class FlashcardsMnemoFormatAdapter : IContentFormatAdapter
{
    private readonly IMnemoPackageService _packageService;

    public FlashcardsMnemoFormatAdapter(IMnemoPackageService packageService)
    {
        _packageService = packageService;
    }

    public string ContentType => "flashcards";
    public string FormatId => "flashcards.mnemo";
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

        preview.Value.DiscoveredCounts.TryGetValue("flashcards", out var count);
        return new ImportExportPreview
        {
            CanImport = count > 0,
            ContentType = ContentType,
            FormatId = FormatId,
            DiscoveredCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["flashcards"] = count },
            Warnings = preview.Value.Warnings
        };
    }

    public async Task<ImportExportResult> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var import = await _packageService.ImportAsync(request.FilePath, new MnemoPackageImportOptions
        {
            ConflictPolicy = ImportExportOptionKeys.GetConflictPolicy(request.Options),
            PayloadTypes = ["flashcards"]
        }, cancellationToken).ConfigureAwait(false);

        return new ImportExportResult
        {
            Success = import.IsSuccess && import.Value != null && import.Value.Success,
            ContentType = ContentType,
            FormatId = FormatId,
            ProcessedCounts = import.Value?.ImportedCountsByPayload ?? new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase),
            Warnings = import.Value?.Warnings ?? new List<string>(),
            ErrorMessage = import.IsSuccess ? null : import.ErrorMessage
        };
    }

    public async Task<ImportExportResult> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var payloadOptions = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (request.Payload is Mnemo.Core.Models.Flashcards.FlashcardDeck deck)
            payloadOptions["flashcards.deckIds"] = new[] { deck.Id };
        if (request.Payload is string deckId && !string.IsNullOrWhiteSpace(deckId))
            payloadOptions["flashcards.deckIds"] = new[] { deckId };
        if (request.Payload is IEnumerable<string> deckIds)
        {
            var filteredDeckIds = deckIds
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            if (filteredDeckIds.Length > 0)
                payloadOptions["flashcards.deckIds"] = filteredDeckIds;
        }

        var export = await _packageService.ExportAsync(request.FilePath, new MnemoPackageExportOptions
        {
            PayloadTypes = ["flashcards"],
            PackageKind = "flashcards",
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
                ["flashcards"] = export.Value?.Entries.FirstOrDefault(e => string.Equals(e.PayloadType, "flashcards", StringComparison.OrdinalIgnoreCase))?.ItemCount ?? 0
            }
        };
    }
}
