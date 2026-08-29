using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Flashcards;
using Mnemo.Host.Trash;

namespace Mnemo.Host.Notes;

/// <summary>
/// Note import and export. Same shape as <see cref="TransferEndpoints"/> and the same
/// <see cref="TransferStagingStore"/> underneath it, driving the note adapters instead of the
/// flashcard ones: a browser cannot hand the coordinator a file path the way the desktop's file
/// dialog does, so <c>POST uploads</c> stages a file and reports what is in it, then
/// <c>POST import</c> commits the staged files the user confirmed, and <c>POST export</c> streams a
/// generated file back for download.
/// <para>
/// The two note formats are not symmetric. A <c>.mnemo</c> package carries any number of notes plus
/// their folders and images; a <c>.md</c> file is one note with no id, so it exports one note at a
/// time and collides by title rather than id. The export route enforces that asymmetry so a caller
/// cannot ask markdown to carry a selection it has no way to represent.
/// </para>
/// </summary>
public static class NoteTransferEndpoints
{
    private const string NotesContentType = "notes";

    private const string MarkdownFormatId = "notes.markdown";

    /// <summary>
    /// Files in one import batch, matching the flashcard limit for the same reason: the cap keeps a
    /// single synchronous import bounded, and the client is not the thing that should hold that line.
    /// </summary>
    private const int MaxBatchFiles = 5;

    public static void MapNoteTransfer(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/notes/transfer/formats", (IImportExportCoordinator transfer) =>
                transfer.GetCapabilities(NotesContentType).Select(TransferFormatDto.FromModel).ToList())
            .RequireNotesMigrated();

        MapUploads(endpoints);
        MapImport(endpoints);
        MapExport(endpoints);
    }

    private static void MapUploads(IEndpointRouteBuilder endpoints)
    {
        // The multipart body is read directly rather than bound as IFormFile so no antiforgery
        // filter is attached; loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/notes/transfer/uploads", async (
                HttpRequest request,
                IImportExportCoordinator transfer,
                CancellationToken cancellationToken) =>
            {
                if (!request.HasFormContentType)
                    return Results.BadRequest(new ErrorDto("invalid_upload", "Expected a multipart form upload."));

                // Kestrel's default 30 MB body / 128 MB form limits sit below what a note package
                // full of images can reach. Without raising them the size check below is dead code:
                // an oversized upload dies in the framework as a generic 500 before the friendly
                // message can fire.
                var sizeLimit = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
                if (sizeLimit is { IsReadOnly: false })
                    sizeLimit.MaxRequestBodySize = TransferStagingStore.MaxRequestBytes;

                IFormCollection form;
                try
                {
                    form = await request
                        .ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = TransferStagingStore.MaxRequestBytes }, cancellationToken)
                        .ConfigureAwait(false);
                }
                catch (BadHttpRequestException)
                {
                    return Results.Json(
                        new ErrorDto("file_too_large", $"The file exceeds the {TransferStagingStore.MaxFileBytes / (1024 * 1024)} MB limit."),
                        statusCode: StatusCodes.Status413PayloadTooLarge);
                }

                var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
                if (file is null || file.Length == 0)
                    return Results.BadRequest(new ErrorDto("empty_upload", "No file was uploaded."));
                if (file.Length > TransferStagingStore.MaxFileBytes)
                    return Results.BadRequest(new ErrorDto("file_too_large", $"The file exceeds the {TransferStagingStore.MaxFileBytes / (1024 * 1024)} MB limit."));

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
                                ContentType = NotesContentType,
                                // Named explicitly rather than left to the coordinator's extension
                                // guess, which falls back to an arbitrary adapter when nothing matches.
                                FormatId = format.FormatId,
                                FilePath = path,
                            },
                            cancellationToken)
                        .ConfigureAwait(false);

                    // A file that cannot be read is reported rather than rejected: the dialog lists
                    // it with the reason attached, which is more use than a bare "upload failed".
                    if (!preview.IsSuccess || preview.Value is null)
                    {
                        return Results.Ok(Described(uploadId, path, file.Length, format, canImport: false, noteCount: null,
                            warnings: [TransferWarningDto.UploadPreviewFailed(preview.ErrorMessage)]));
                    }

                    // Both note previews report a count that means what it says (a package reads its
                    // manifest, markdown is always one note), so it is surfaced whenever present.
                    int? noteCount = preview.Value.DiscoveredCounts.TryGetValue(NotesContentType, out var counted)
                        ? counted
                        : null;

                    return Results.Ok(Described(uploadId, path, file.Length, format,
                        preview.Value.CanImport, noteCount, preview.Value.Warnings.Select(TransferWarningDto.FromModel).ToList()));
                }
                catch (Exception)
                {
                    // The staged copy is only useful to the import that was going to follow. A client
                    // that aborted mid-upload, or a preview that threw, leaves bytes nobody will ask
                    // for, and an aborted upload is routine here since removing a file from the dialog
                    // queue cancels its request.
                    TransferStagingStore.DeleteUpload(uploadId);
                    throw;
                }
            })
            .RequireNotesMigrated();

        // Removing a file from the dialog queue, or closing it, gives back the staged bytes now
        // instead of leaving them for the sweep.
        endpoints.MapDelete("/api/notes/transfer/uploads/{uploadId}", (string uploadId) =>
            {
                TransferStagingStore.DeleteUpload(uploadId);
                return Results.NoContent();
            })
            .RequireNotesMigrated();
    }

    private static void MapImport(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/notes/transfer/import", async (
                NoteTransferImportDto body,
                IImportExportCoordinator transfer,
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
                // policy with KeepBoth, so a typo would quietly duplicate content the user asked to
                // have overwritten, a wrong outcome reported as success.
                var policy = ImportConflictPolicy.KeepBoth;
                if (!string.IsNullOrWhiteSpace(body.ConflictPolicy) &&
                    !Enum.TryParse(body.ConflictPolicy, ignoreCase: true, out policy))
                {
                    return Results.BadRequest(new ErrorDto("invalid_conflict_policy",
                        $"'{body.ConflictPolicy}' is not a conflict policy."));
                }

                var targetFolderId = string.IsNullOrWhiteSpace(body.TargetFolderId) ? null : body.TargetFolderId.Trim();

                var succeeded = 0;
                var importedNotes = 0;
                var warnings = new List<TransferWarningDto>();
                var errors = new List<string>();

                // Every id is accounted for even if the loop leaves early: a staged file whose
                // import never ran is still nobody's but ours to clean up.
                var pending = new HashSet<string>(uploadIds, StringComparer.Ordinal);

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

                        try
                        {
                            var request = new ImportExportRequest
                            {
                                ContentType = NotesContentType,
                                FormatId = format.FormatId,
                                FilePath = path,
                            };
                            request.Options[ImportExportOptionKeys.ConflictPolicy] = policy;
                            if (targetFolderId is not null)
                                request.Options[ImportExportOptionKeys.TargetFolderId] = targetFolderId;

                            // Deliberately not the request's token. An import writes notes and
                            // folders as it goes, so cancelling one part-way leaves the corpus
                            // holding half a file with nothing to say so, the same reason grading a
                            // study card does not take RequestAborted either.
                            var result = await transfer.ImportAsync(request, CancellationToken.None).ConfigureAwait(false);
                            var value = result.Value;
                            if (!result.IsSuccess || value is null || !value.Success)
                            {
                                errors.Add($"\"{name}\": {result.ErrorMessage ?? value?.ErrorMessage ?? "Import failed."}");
                                continue;
                            }

                            succeeded++;
                            // Both note adapters count the same unit, so unlike flashcards this needs
                            // no before/after library scan.
                            if (value.ProcessedCounts.TryGetValue(NotesContentType, out var notes))
                                importedNotes += notes;

                            // Attributed, because a batch that all warn about the same missing image
                            // would otherwise be indistinguishable from one another. The file name
                            // travels as a parameter rather than being spliced into the text, so it
                            // still resolves to a real sentence once translated.
                            warnings.AddRange(value.Warnings.Select(warning => TransferWarningDto.FromModel(warning).WithFileName(name)));
                        }
                        catch (Exception ex)
                        {
                            // An adapter is free to throw, and one bad file must not discard the
                            // results of the files around it.
                            errors.Add($"\"{name}\": {ex.Message}");
                        }
                        finally
                        {
                            // Consumed either way: a file that failed is not going to succeed on a
                            // retry of the same bytes, and the user re-adds it to try again.
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

                return Results.Ok(new NoteTransferImportResultDto(
                    succeeded,
                    uploadIds.Count - succeeded,
                    Math.Max(0, importedNotes),
                    warnings,
                    errors));
            })
            .RequireNotesMigrated().RequireTrash();
    }

    private static void MapExport(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/notes/transfer/export", async (
                NoteTransferExportDto body,
                IImportExportCoordinator transfer,
                INoteService notes,
                CancellationToken cancellationToken) =>
            {
                var noteIds = (body.NoteIds ?? []).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToArray();
                if (noteIds.Length == 0)
                    return Results.BadRequest(new ErrorDto("no_notes", "No notes were selected to export."));

                var format = transfer.GetCapabilities(NotesContentType)
                    .FirstOrDefault(c => c.SupportsExport && string.Equals(c.FormatId, body.FormatId, StringComparison.OrdinalIgnoreCase));
                if (format is null)
                    return Results.BadRequest(new ErrorDto("unsupported_format", $"'{body.FormatId}' is not an export format."));

                var isMarkdown = string.Equals(format.FormatId, MarkdownFormatId, StringComparison.OrdinalIgnoreCase);
                if (isMarkdown && noteIds.Length != 1)
                    return Results.BadRequest(new ErrorDto("markdown_single_note",
                        "Markdown exports one note at a time. Use the package format for a selection."));

                // Markdown needs the note itself (it has no id to resolve later); the package takes
                // the ids and reads them itself. The single load also names the download.
                object payload;
                string? singleTitle = null;
                if (isMarkdown)
                {
                    var note = await notes.GetNoteAsync(noteIds[0]).ConfigureAwait(false);
                    if (note is null)
                        return Results.NotFound(new ErrorDto("unknown_note", $"No note '{noteIds[0]}'."));
                    payload = note;
                    singleTitle = note.Title;
                }
                else
                {
                    payload = noteIds;
                    if (noteIds.Length == 1)
                        singleTitle = (await notes.GetNoteAsync(noteIds[0]).ConfigureAwait(false))?.Title;
                }

                // Swept here as well as on upload, so somebody who only ever exports still reclaims
                // what a failed export left behind.
                TransferStagingStore.SweepStale();

                var extension = format.Extensions.FirstOrDefault() ?? ".mnemo";
                var path = TransferStagingStore.CreateExportPath(extension);
                try
                {
                    var result = await transfer.ExportAsync(
                            new ImportExportRequest
                            {
                                ContentType = NotesContentType,
                                FormatId = format.FormatId,
                                FilePath = path,
                                Payload = payload,
                            },
                            cancellationToken)
                        .ConfigureAwait(false);

                    if (!result.IsSuccess || result.Value is null || !result.Value.Success)
                    {
                        return Results.BadRequest(new ErrorDto("export_failed",
                            result.ErrorMessage ?? result.Value?.ErrorMessage ?? "Export failed."));
                    }

                    var downloadName = BuildDownloadName(singleTitle, noteIds.Length, extension);

                    // DeleteOnClose hands cleanup to the response pipeline: the staged copy lives
                    // exactly as long as it takes to write it to the client, including when the
                    // client disconnects part-way through.
                    var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024,
                        FileOptions.DeleteOnClose | FileOptions.Asynchronous);
                    return Results.File(stream, ContentTypeFor(extension), downloadName);
                }
                catch (Exception)
                {
                    // Nothing downstream will ever open this file, so nothing else would delete it.
                    // Covers a cancelled export, an adapter that threw part-way through writing, and
                    // a handle that could not be opened once it had.
                    TransferStagingStore.TryDeleteFile(path);
                    throw;
                }
            })
            .RequireNotesMigrated();
    }

    private static NoteTransferUploadDto Described(
        string uploadId,
        string path,
        long sizeBytes,
        ImportExportCapability format,
        bool canImport,
        int? noteCount,
        IReadOnlyList<TransferWarningDto> warnings) =>
        new(uploadId, Path.GetFileName(path), sizeBytes, format.FormatId, format.DisplayName, canImport, noteCount, warnings);

    /// <summary>The import format an extension belongs to, or null when nothing claims it.</summary>
    private static ImportExportCapability? ResolveImportFormat(IImportExportCoordinator transfer, string? extension)
    {
        if (string.IsNullOrWhiteSpace(extension))
            return null;

        return transfer.GetCapabilities(NotesContentType)
            .FirstOrDefault(c => c.SupportsImport &&
                c.Extensions.Any(ext => string.Equals(ext, extension, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>
    /// What the browser saves the download as: one note exports under its own title, a selection
    /// under a generic name, matching the names the desktop's save dialog suggests.
    /// </summary>
    private static string BuildDownloadName(string? singleTitle, int noteCount, string extension)
    {
        var name = noteCount == 1 && !string.IsNullOrWhiteSpace(singleTitle) ? singleTitle! : "notes";

        foreach (var invalid in Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');

        name = name.Trim().Trim('.');
        return (string.IsNullOrWhiteSpace(name) ? "notes" : name) + extension;
    }

    private static string ContentTypeFor(string extension) => extension.ToLowerInvariant() switch
    {
        ".md" => "text/markdown",
        _ => "application/octet-stream",
    };
}
