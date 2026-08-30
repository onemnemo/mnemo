using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Lifecycle;
using Mnemo.Host.Transfer;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Flashcard import and export. The work itself is the same <see cref="IImportExportCoordinator"/>
/// the desktop drives; what changes here is how a file reaches it. The desktop passes the path the
/// user picked in a file dialog, so a browser has to upload first and download after, and this is
/// the two-step that bridges that: <c>POST uploads</c> stages a file and reports what is in it,
/// then <c>POST import</c> commits the staged files the user confirmed.
/// </summary>
public static class TransferEndpoints
{
    private const string FlashcardsContentType = "flashcards";
    private const string LogCategory = "Flashcards.Transfer";

    /// <summary>
    /// Files in one import batch, matching the desktop dialog's queue limit. Enforced here too
    /// because the limit exists to keep a single synchronous import bounded, and the client is not
    /// the thing that should be trusted to hold that line.
    /// </summary>
    private const int MaxBatchFiles = 5;

    /// <summary>
    /// The Mnemo package format - the one whose reported item count is decks where every other
    /// format's is cards. Both count rules below are really about telling it apart from the rest.
    /// </summary>
    private const string PackageFormatId = "flashcards.mnemo";

    /// <summary>
    /// Formats whose <em>preview</em> genuinely opens the file and counts cards. Only the Anki
    /// adapter does; the CSV adapter returns a hardcoded 1 without reading anything, and a package
    /// reports its manifest's deck count. Anything not listed reports no count before importing
    /// rather than a number the import would then contradict.
    /// </summary>
    private static readonly HashSet<string> FormatsWithTrustedPreview = new(StringComparer.OrdinalIgnoreCase)
    {
        "flashcards.anki",
    };

    public static void MapFlashcardTransfer(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/flashcards/transfer/formats", (IImportExportCoordinator transfer) =>
            transfer.GetCapabilities(FlashcardsContentType).Select(TransferFormatDto.FromModel).ToList());

        MapUploads(endpoints);
        MapImport(endpoints);
        MapExport(endpoints);
    }

    private static void MapUploads(IEndpointRouteBuilder endpoints)
    {
        // The multipart body is read directly rather than bound as IFormFile so no antiforgery
        // filter is attached - loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/flashcards/transfer/uploads", async (
            HttpRequest request,
            IImportExportCoordinator transfer,
            CancellationToken cancellationToken) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new ErrorDto("invalid_upload", "Expected a multipart form upload."));

            // Kestrel caps a request body at 30 MB and form parsing at 128 MB by default, both far
            // below what a collection-sized Anki package needs. Without raising them the size check
            // below is dead code: an oversized upload dies in the framework and surfaces as a
            // generic 500 rather than the message that says what the limit is.
            var sizeLimit = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (sizeLimit is { IsReadOnly: false })
                sizeLimit.MaxRequestBodySize = TransferLimits.MaxRequestBytes;

            IFormCollection form;
            try
            {
                form = await request
                    .ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = TransferLimits.MaxRequestBytes }, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (BadHttpRequestException)
            {
                return Results.Json(
                    new ErrorDto("file_too_large", $"The file exceeds the {TransferLimits.MaxFileMegabytes} MB limit."),
                    statusCode: StatusCodes.Status413PayloadTooLarge);
            }

            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new ErrorDto("empty_upload", "No file was uploaded."));
            if (file.Length > TransferLimits.MaxFileBytes)
                return Results.BadRequest(new ErrorDto("file_too_large", $"The file exceeds the {TransferLimits.MaxFileMegabytes} MB limit."));

            var extension = Path.GetExtension(file.FileName);
            var format = ResolveImportFormat(transfer, extension);
            if (format is null)
                return Results.BadRequest(new ErrorDto("unsupported_format", $"'{extension}' files cannot be imported."));

            TransferStagingStore.SweepStale();
            var (uploadId, path) = TransferStagingStore.CreateUpload(file.FileName);
            try
            {
                await using (var stream = File.Create(path))
                    await file.CopyToAsync(stream, cancellationToken).ConfigureAwait(false);

                var preview = await transfer.PreviewImportAsync(
                        new ImportExportRequest
                        {
                            ContentType = FlashcardsContentType,
                            // Named explicitly rather than left to the coordinator's extension
                            // guess, which falls back to an arbitrary adapter when nothing matches.
                            FormatId = format.FormatId,
                            FilePath = path,
                        },
                        cancellationToken)
                    .ConfigureAwait(false);

                // A file that cannot be read is still reported rather than rejected: the dialog
                // lists it with the reason attached, which is more use than a bare "upload failed".
                if (!preview.IsSuccess || preview.Value is null)
                {
                    return Results.Ok(Described(uploadId, path, file.Length, format, canImport: false, cardCount: null,
                        warnings: [TransferWarningDto.UploadPreviewFailed(preview.ErrorMessage)]));
                }

                int? cardCount = null;
                if (FormatsWithTrustedPreview.Contains(format.FormatId) &&
                    preview.Value.DiscoveredCounts.TryGetValue(FlashcardsContentType, out var counted))
                {
                    cardCount = counted;
                }

                return Results.Ok(Described(uploadId, path, file.Length, format,
                    preview.Value.CanImport, cardCount, preview.Value.Warnings.Select(TransferWarningDto.FromModel).ToList(),
                    preview.Value.Evidence is { } evidence ? PackageEvidenceDto.FromModel(evidence) : null));
            }
            catch (Exception)
            {
                // The staged copy is only useful to the import that was going to follow. A client
                // that aborted mid-upload, or a preview that threw, leaves bytes nobody will ever
                // ask for - and an aborted upload is routine here, since removing a file from the
                // dialog queue cancels its request.
                TransferStagingStore.DeleteUpload(uploadId);
                throw;
            }
        });

        // Removing a file from the dialog queue, or closing it, gives back the staged bytes now
        // instead of leaving them for the sweep.
        endpoints.MapDelete("/api/flashcards/transfer/uploads/{uploadId}", (string uploadId) =>
        {
            TransferStagingStore.DeleteUpload(uploadId);
            return Results.NoContent();
        });
    }

    private static void MapImport(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/flashcards/transfer/import", async (
            TransferImportDto body,
            IImportExportCoordinator transfer,
            IFlashcardLibraryService library,
            CancellationToken cancellationToken) =>
        {
            // Deduplicated first: the same id twice would import once and then report the second
            // occurrence as a missing file, because importing consumes the staged bytes.
            var uploadIds = (body.UploadIds ?? []).Distinct(StringComparer.Ordinal).ToList();
            if (uploadIds.Count == 0)
                return Results.BadRequest(new ErrorDto("no_uploads", "No files were selected to import."));
            if (uploadIds.Count > MaxBatchFiles)
                return Results.BadRequest(new ErrorDto("too_many_files", $"At most {MaxBatchFiles} files can be imported at once."));

            // Rejected rather than allowed to fall back. The option parser answers an unknown
            // policy with KeepBoth, so a typo would quietly duplicate a library the user asked to
            // have overwritten - a wrong outcome reported as success.
            var policy = ImportConflictPolicy.KeepBoth;
            if (!string.IsNullOrWhiteSpace(body.ConflictPolicy) &&
                !Enum.TryParse(body.ConflictPolicy, ignoreCase: true, out policy))
            {
                return Results.BadRequest(new ErrorDto("invalid_conflict_policy",
                    $"'{body.ConflictPolicy}' is not a conflict policy."));
            }

            var succeeded = 0;
            var importedCards = 0;
            var measure = false;
            var warnings = new List<TransferWarningDto>();
            var errors = new List<string>();

            // Every id is accounted for even if the loop leaves early: a staged file whose import
            // never ran is still nobody's but ours to clean up.
            var pending = new HashSet<string>(uploadIds, StringComparer.Ordinal);
            var cardsBefore = 0;
            var measured = false;

            try
            {
                foreach (var uploadId in uploadIds)
                {
                    var path = TransferStagingStore.ResolveUpload(uploadId);
                    if (path is null)
                    {
                        pending.Remove(uploadId);
                        errors.Add("A selected file is no longer available. Add it again and retry.");
                        continue;
                    }

                    var name = Path.GetFileName(path);
                    var format = ResolveImportFormat(transfer, Path.GetExtension(path));
                    if (format is null)
                    {
                        pending.Remove(uploadId);
                        TransferStagingStore.DeleteUpload(uploadId);
                        errors.Add($"\"{name}\" is not a supported file type.");
                        continue;
                    }

                    // Only a package forces the expensive route. Measuring means two whole-library
                    // scans, and every other adapter already reports a real card count.
                    if (!measured && string.Equals(format.FormatId, PackageFormatId, StringComparison.OrdinalIgnoreCase))
                    {
                        cardsBefore = await CountCardsAsync(library, cancellationToken).ConfigureAwait(false);
                        measure = true;
                        measured = true;
                    }

                    try
                    {
                        var request = new ImportExportRequest
                        {
                            ContentType = FlashcardsContentType,
                            FormatId = format.FormatId,
                            FilePath = path,
                        };
                        request.Options[ImportExportOptionKeys.ConflictPolicy] = policy;

                        // Deliberately not the request's token. An import writes decks and cards
                        // as it goes, so cancelling one part-way leaves the library holding half a
                        // file with nothing to say so - the same reason grading a study card does
                        // not take RequestAborted either.
                        var result = await transfer.ImportAsync(request, CancellationToken.None).ConfigureAwait(false);
                        var value = result.Value;
                        if (!result.IsSuccess || value is null || !value.Success)
                        {
                            errors.Add($"\"{name}\": {result.ErrorMessage ?? value?.ErrorMessage ?? "Import failed."}");
                            continue;
                        }

                        succeeded++;
                        if (!string.Equals(format.FormatId, PackageFormatId, StringComparison.OrdinalIgnoreCase) &&
                            value.ProcessedCounts.TryGetValue(FlashcardsContentType, out var cards))
                        {
                            importedCards += cards;
                        }

                        // Attributed, because a batch of five packages that all warn about the same
                        // missing image would otherwise be indistinguishable from one another. The
                        // file name travels as a parameter rather than being spliced into the text,
                        // so it still resolves to a real sentence once translated.
                        warnings.AddRange(value.Warnings.Select(warning => TransferWarningDto.FromModel(warning).WithFileName(name)));
                    }
                    catch (Exception ex)
                    {
                        // An adapter is free to throw - the CSV one has no error handling at all -
                        // and one bad file must not discard the results of the files around it.
                        errors.Add($"\"{name}\": {ex.Message}");
                    }
                    finally
                    {
                        // Consumed either way: a file that failed is not going to succeed on a
                        // retry of the same bytes, and the user re-adds it if they want another go.
                        pending.Remove(uploadId);
                        TransferStagingStore.DeleteUpload(uploadId);
                    }
                }
            }
            finally
            {
                foreach (var leftover in pending)
                    TransferStagingStore.DeleteUpload(leftover);
            }

            if (measure)
            {
                // A package's own count is decks, so what it added has to be observed instead.
                var cardsAfter = await CountCardsAsync(library, cancellationToken).ConfigureAwait(false);
                importedCards = Math.Max(importedCards, cardsAfter - cardsBefore);
            }

            return Results.Ok(new TransferImportResultDto(
                succeeded,
                uploadIds.Count - succeeded,
                Math.Max(0, importedCards),
                warnings,
                errors));
        });
    }

    private static void MapExport(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/flashcards/transfer/export", async (
            TransferExportDto body,
            IImportExportCoordinator transfer,
            IFlashcardLibraryService library,
            ExportGrants grants,
            ISettingsService settings,
            ILoggerService logger,
            CancellationToken cancellationToken) =>
        {
            var deckIds = (body.DeckIds ?? []).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToArray();
            if (deckIds.Length == 0)
                return Results.BadRequest(new ErrorDto("no_decks", "No decks were selected to export."));

            var format = transfer.GetCapabilities(FlashcardsContentType)
                .FirstOrDefault(c => c.SupportsExport && string.Equals(c.FormatId, body.FormatId, StringComparison.OrdinalIgnoreCase));
            if (format is null)
                return Results.BadRequest(new ErrorDto("unsupported_format", $"'{body.FormatId}' is not an export format."));

            if (ExportDestination.Claim(body.Grant, grants, out var target) is { } refusal)
                return refusal;

            var extension = format.Extensions.FirstOrDefault() ?? ".mnemo";
            var path = ExportDestination.PathFor(target, extension);
            try
            {
                var request = new ImportExportRequest
                {
                    ContentType = FlashcardsContentType,
                    FormatId = format.FormatId,
                    FilePath = path,
                    Payload = deckIds,
                };
                if (!string.IsNullOrWhiteSpace(body.Kind))
                    request.Options[ImportExportOptionKeys.PackageKind] = body.Kind;

                var result = await transfer.ExportAsync(request, cancellationToken).ConfigureAwait(false);

                if (!result.IsSuccess || result.Value is null || !result.Value.Success)
                {
                    ExportDestination.Discard(path);
                    return Results.BadRequest(new ErrorDto("export_failed",
                        result.ErrorMessage ?? result.Value?.ErrorMessage ?? "Export failed."));
                }

                if (target is not null)
                    return await ExportDestination.CommitAsync(target, path, settings).ConfigureAwait(false);

                var downloadName = await BuildDownloadNameAsync(library, deckIds, extension, cancellationToken).ConfigureAwait(false);

                // DeleteOnClose hands the cleanup to the response pipeline: the staged copy lives
                // exactly as long as it takes to write it to the client, including when the client
                // disconnects part-way through.
                var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024,
                    FileOptions.DeleteOnClose | FileOptions.Asynchronous);
                return Results.File(stream, ContentTypeFor(extension), downloadName);
            }
            catch (Exception ex) when (target is not null && ex is IOException or UnauthorizedAccessException)
            {
                return ExportDestination.Failed(target, path, logger, LogCategory, ex);
            }
            catch (Exception)
            {
                // Nothing downstream will ever open this file, so nothing else would delete it.
                // Covers a cancelled export, an adapter that threw part-way through writing, and
                // a handle that could not be opened once it had.
                ExportDestination.Discard(path);
                throw;
            }
        });
    }

    private static TransferUploadDto Described(
        string uploadId,
        string path,
        long sizeBytes,
        ImportExportCapability format,
        bool canImport,
        int? cardCount,
        IReadOnlyList<TransferWarningDto> warnings,
        PackageEvidenceDto? evidence = null) =>
        new(uploadId, Path.GetFileName(path), sizeBytes, format.FormatId, format.DisplayName, canImport, cardCount, warnings, evidence);

    /// <summary>The import format an extension belongs to, or null when nothing claims it.</summary>
    private static ImportExportCapability? ResolveImportFormat(IImportExportCoordinator transfer, string? extension)
    {
        if (string.IsNullOrWhiteSpace(extension))
            return null;

        return transfer.GetCapabilities(FlashcardsContentType)
            .FirstOrDefault(c => c.SupportsImport &&
                c.Extensions.Any(ext => string.Equals(ext, extension, StringComparison.OrdinalIgnoreCase)));
    }

    private static async Task<int> CountCardsAsync(IFlashcardLibraryService library, CancellationToken cancellationToken)
    {
        var decks = await library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        return decks.Sum(deck => deck.TotalCards);
    }

    /// <summary>
    /// What the browser saves the download as: one deck exports under its own name, a selection
    /// under a generic one, matching the names the desktop's save dialog suggests.
    /// </summary>
    private static async Task<string> BuildDownloadNameAsync(
        IFlashcardLibraryService library,
        IReadOnlyList<string> deckIds,
        string extension,
        CancellationToken cancellationToken)
    {
        var name = "flashcards";
        if (deckIds.Count == 1)
        {
            var deck = await library.GetDeckAsync(deckIds[0], cancellationToken).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(deck?.Name))
                name = deck!.Name;
        }

        foreach (var invalid in Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');

        name = name.Trim().Trim('.');
        return (string.IsNullOrWhiteSpace(name) ? "flashcards" : name) + extension;
    }

    private static string ContentTypeFor(string extension) => extension.ToLowerInvariant() switch
    {
        ".csv" => "text/csv",
        _ => "application/octet-stream",
    };
}
