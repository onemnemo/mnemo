using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

public sealed class NotesMnemoFormatAdapter : IContentFormatAdapter
{
    /// <summary>
    /// What a notes package carries. Proofing rides along because the languages a note is checked in
    /// and the words it accepts are part of that note, and this is the only route a user has to a
    /// package that holds notes at all; left out, they are lost on every export and every restore.
    /// The count the caller sees stays the note count, since proofing is not a thing anyone selected.
    /// </summary>
    private static readonly string[] PayloadTypes = ["notes", "proofing"];

    private readonly IMnemoPackageService _packageService;

    public NotesMnemoFormatAdapter(IMnemoPackageService packageService)
    {
        _packageService = packageService;
    }

    public string ContentType => "notes";

    public string FormatId => "notes.mnemo";

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

        if (preview.Value.DiscoveredCounts.TryGetValue("notes", out var noteCount))
        {
            return new ImportExportPreview
            {
                CanImport = true,
                ContentType = ContentType,
                FormatId = FormatId,
                DiscoveredCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["notes"] = noteCount },
                Warnings = preview.Value.Warnings
            };
        }

        return new ImportExportPreview
        {
            CanImport = false,
            ContentType = ContentType,
            FormatId = FormatId,
            Warnings = { TransferWarning.Of("PackageMissingNotesPayload") }
        };
    }

    public async Task<ImportExportResult> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var import = await _packageService.ImportAsync(request.FilePath, new MnemoPackageImportOptions
        {
            ConflictPolicy = ImportExportOptionKeys.GetConflictPolicy(request.Options),
            PayloadTypes = PayloadTypes
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
        if (request.Payload is Note note)
            payloadOptions[MnemoPayloadOptionKeys.NoteIds] = new[] { note.NoteId };
        else if (request.Payload is IEnumerable<string> noteIds)
        {
            var selected = noteIds.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToArray();
            if (selected.Length > 0)
                payloadOptions[MnemoPayloadOptionKeys.NoteIds] = selected;
        }

        var export = await _packageService.ExportAsync(request.FilePath, new MnemoPackageExportOptions
        {
            PayloadTypes = PayloadTypes,
            PackageKind = "notes",
            PayloadOptions = payloadOptions
        }, cancellationToken).ConfigureAwait(false);

        return new ImportExportResult
        {
            Success = export.IsSuccess,
            ContentType = ContentType,
            FormatId = FormatId,
            ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
            {
                ["notes"] = export.Value?.Entries.FirstOrDefault(e => string.Equals(e.PayloadType, "notes", StringComparison.OrdinalIgnoreCase))?.ItemCount ?? 0
            },
            ErrorMessage = export.IsSuccess ? null : export.ErrorMessage
        };
    }
}
