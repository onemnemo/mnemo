using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
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
                Warnings = { MnemoPackagePreviewWarning.PreviewFailed(preview.ErrorMessage) }
            };
        }

        preview.Value.DiscoveredCounts.TryGetValue("flashcards", out var count);

        // Evidence is what the import dialog shows before anything is written. A package that
        // cannot be inspected still imports, so a failure here costs the dialog its detail rather
        // than costing the user their import.
        var evidence = await _packageService.InspectAsync(request.FilePath, cancellationToken).ConfigureAwait(false);

        return new ImportExportPreview
        {
            CanImport = count > 0,
            ContentType = ContentType,
            FormatId = FormatId,
            DiscoveredCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["flashcards"] = count },
            Evidence = evidence.IsSuccess ? evidence.Value : null,
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
            Warnings = import.Value?.Warnings ?? new List<TransferWarning>(),
            ErrorMessage = import.IsSuccess ? null : import.ErrorMessage
        };
    }

    public async Task<ImportExportResult> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var payloadOptions = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (request.Payload is FlashcardDeckSummary summary && !string.IsNullOrWhiteSpace(summary.Id))
            payloadOptions["flashcards.deckIds"] = new[] { summary.Id };
        else if (request.Payload is FlashcardDeckHeader header && !string.IsNullOrWhiteSpace(header.Id))
            payloadOptions["flashcards.deckIds"] = new[] { header.Id };
        else if (request.Payload is string deckId && !string.IsNullOrWhiteSpace(deckId))
            payloadOptions["flashcards.deckIds"] = new[] { deckId };
        else if (request.Payload is IEnumerable<string> deckIds)
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
            Kind = ResolveKind(request, payloadOptions),
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

    /// <summary>
    /// Whether this export is a backup of the collection or a package of chosen decks. The caller
    /// says so when it knows, because "every deck in the library" and "every deck a search left
    /// standing" both arrive here as a list of ids and only the caller can tell them apart. When
    /// nothing was said, a request that named no decks is taking the whole collection.
    /// </summary>
    /// <remarks>
    /// The difference is not cosmetic: a backup carries the review history and daily counters a
    /// restore needs, and an export deliberately does not, because somebody else's answers have no
    /// business landing in the reader's own record.
    /// </remarks>
    private static string ResolveKind(ImportExportRequest request, IReadOnlyDictionary<string, object?> payloadOptions)
    {
        if (ImportExportOptionKeys.GetStringOption(request.Options, ImportExportOptionKeys.PackageKind) is { } declared)
            return MnemoPackageKinds.Normalize(declared);

        return payloadOptions.ContainsKey("flashcards.deckIds") ? MnemoPackageKinds.Export : MnemoPackageKinds.Backup;
    }
}
