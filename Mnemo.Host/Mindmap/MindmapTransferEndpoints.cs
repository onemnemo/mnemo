using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Flashcards;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// Mindmap import and export. Same shape as <see cref="Notes.NoteTransferEndpoints"/> and the same
/// <see cref="TransferStagingStore"/> underneath it, driving the mindmap adapter instead of the note
/// ones: a browser cannot hand the coordinator a file path the way the desktop's file dialog does,
/// so <c>POST uploads</c> stages a file and reports what is in it, then <c>POST import</c> commits
/// the staged files the user confirmed, and <c>POST export</c> streams a generated file back for
/// download.
/// <para>
/// Simpler than the note side in one way that matters: <c>.mnemo</c> is the only mindmap format, so
/// there is no second format with a narrower idea of what a selection can be, and no target folder
/// to choose either, since a package carries the folders its maps were filed in.
/// </para>
/// </summary>
public static class MindmapTransferEndpoints
{
    private const string MindmapsContentType = "mindmaps";

    /// <summary>
    /// Files in one import batch, matching the note and flashcard limit for the same reason: the cap
    /// keeps a single synchronous import bounded, and the client is not the thing that should hold
    /// that line.
    /// </summary>
    private const int MaxBatchFiles = 5;

    public static void MapMindmapTransfer(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/mindmaps/transfer/formats", (IImportExportCoordinator transfer) =>
            transfer.GetCapabilities(MindmapsContentType).Select(TransferFormatDto.FromModel).ToList());

        MapUploads(endpoints);
        MapImport(endpoints);
        MapExport(endpoints);
    }

    private static void MapUploads(IEndpointRouteBuilder endpoints)
    {
        // The multipart body is read directly rather than bound as IFormFile so no antiforgery
        // filter is attached; loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/mindmaps/transfer/uploads", async (
            HttpRequest request,
            IImportExportCoordinator transfer,
            CancellationToken cancellationToken) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new ErrorDto("invalid_upload", "Expected a multipart form upload."));

            // Kestrel's default 30 MB body / 128 MB form limits sit below what a package full of map
            // images can reach. Without raising them the size check below is dead code: an oversized
            // upload dies in the framework as a generic 500 before the friendly message can fire.
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
                            ContentType = MindmapsContentType,
                            // Named explicitly rather than left to the coordinator's extension guess,
                            // which falls back to an arbitrary adapter when nothing matches. A
                            // .mnemo package can hold notes or cards instead, and the mindmap
                            // adapter is the one that can say so.
                            FormatId = format.FormatId,
                            FilePath = path,
                        },
                        cancellationToken)
                    .ConfigureAwait(false);

                // A file that cannot be read is reported rather than rejected: the dialog lists it
                // with the reason attached, which is more use than a bare "upload failed".
                if (!preview.IsSuccess || preview.Value is null)
                {
                    return Results.Ok(Described(uploadId, path, file.Length, format, canImport: false, mapCount: null,
                        warnings: [preview.ErrorMessage ?? "The file could not be read."]));
                }

                int? mapCount = preview.Value.DiscoveredCounts.TryGetValue(MindmapsContentType, out var counted)
                    ? counted
                    : null;

                return Results.Ok(Described(uploadId, path, file.Length, format,
                    preview.Value.CanImport, mapCount, preview.Value.Warnings));
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
        });

        // Removing a file from the dialog queue, or closing it, gives back the staged bytes now
        // instead of leaving them for the sweep.
        endpoints.MapDelete("/api/mindmaps/transfer/uploads/{uploadId}", (string uploadId) =>
        {
            TransferStagingStore.DeleteUpload(uploadId);
            return Results.NoContent();
        });
    }

    private static void MapImport(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/mindmaps/transfer/import", async (
            MindmapTransferImportDto body,
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

            // Rejected rather than allowed to fall back. The option parser answers an unknown policy
            // with KeepBoth, so a typo would quietly duplicate maps the user asked to have
            // overwritten, a wrong outcome reported as success.
            var policy = ImportConflictPolicy.KeepBoth;
            if (!string.IsNullOrWhiteSpace(body.ConflictPolicy) &&
                !Enum.TryParse(body.ConflictPolicy, ignoreCase: true, out policy))
            {
                return Results.BadRequest(new ErrorDto("invalid_conflict_policy",
                    $"'{body.ConflictPolicy}' is not a conflict policy."));
            }

            var succeeded = 0;
            var importedMaps = 0;
            var warnings = new List<string>();
            var errors = new List<string>();

            // Every id is accounted for even if the loop leaves early: a staged file whose import
            // never ran is still nobody's but ours to clean up.
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
                            ContentType = MindmapsContentType,
                            FormatId = format.FormatId,
                            FilePath = path,
                        };
                        request.Options[ImportExportOptionKeys.ConflictPolicy] = policy;

                        // Deliberately not the request's token. An import writes maps, folders and
                        // image assets as it goes, so cancelling one part-way leaves the library
                        // holding half a package with nothing to say so.
                        var result = await transfer.ImportAsync(request, CancellationToken.None).ConfigureAwait(false);
                        var value = result.Value;
                        if (!result.IsSuccess || value is null || !value.Success)
                        {
                            errors.Add($"\"{name}\": {result.ErrorMessage ?? value?.ErrorMessage ?? "Import failed."}");
                            continue;
                        }

                        succeeded++;
                        if (value.ProcessedCounts.TryGetValue(MindmapsContentType, out var maps))
                            importedMaps += maps;

                        // Attributed, because a batch that all warn about the same missing image
                        // would otherwise collapse to one line naming no file.
                        warnings.AddRange(value.Warnings.Select(warning => $"\"{name}\": {warning}"));
                    }
                    catch (Exception ex)
                    {
                        // An adapter is free to throw, and one bad file must not discard the results
                        // of the files around it.
                        errors.Add($"\"{name}\": {ex.Message}");
                    }
                    finally
                    {
                        // Consumed either way: a file that failed is not going to succeed on a retry
                        // of the same bytes, and the user re-adds it to try again.
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

            return Results.Ok(new MindmapTransferImportResultDto(
                succeeded,
                uploadIds.Count - succeeded,
                Math.Max(0, importedMaps),
                warnings,
                errors));
        });
    }

    private static void MapExport(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/mindmaps/transfer/export", async (
            MindmapTransferExportDto body,
            IImportExportCoordinator transfer,
            IMindmapService maps,
            CancellationToken cancellationToken) =>
        {
            var mapIds = (body.MapIds ?? []).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToArray();
            if (mapIds.Length == 0)
                return Results.BadRequest(new ErrorDto("no_maps", "No mindmaps were selected to export."));

            var format = transfer.GetCapabilities(MindmapsContentType)
                .FirstOrDefault(c => c.SupportsExport && string.Equals(c.FormatId, body.FormatId, StringComparison.OrdinalIgnoreCase));
            if (format is null)
                return Results.BadRequest(new ErrorDto("unsupported_format", $"'{body.FormatId}' is not an export format."));

            // Headers, not documents: the only thing wanted here is a title for the download name,
            // and a map big enough to be worth exporting is one worth not deserializing twice.
            string? singleTitle = null;
            if (mapIds.Length == 1)
            {
                var summaries = await maps.ListAsync(cancellationToken).ConfigureAwait(false);
                singleTitle = summaries.Value?.FirstOrDefault(summary => summary.Id == mapIds[0])?.Title;
            }

            // Swept here as well as on upload, so somebody who only ever exports still reclaims what
            // a failed export left behind.
            TransferStagingStore.SweepStale();

            var extension = format.Extensions.FirstOrDefault() ?? ".mnemo";
            var path = TransferStagingStore.CreateExportPath(extension);
            try
            {
                var result = await transfer.ExportAsync(
                        new ImportExportRequest
                        {
                            ContentType = MindmapsContentType,
                            FormatId = format.FormatId,
                            FilePath = path,
                            Payload = mapIds,
                        },
                        cancellationToken)
                    .ConfigureAwait(false);

                if (!result.IsSuccess || result.Value is null || !result.Value.Success)
                {
                    return Results.BadRequest(new ErrorDto("export_failed",
                        result.ErrorMessage ?? result.Value?.ErrorMessage ?? "Export failed."));
                }

                // DeleteOnClose hands cleanup to the response pipeline: the staged copy lives exactly
                // as long as it takes to write it to the client, including when the client
                // disconnects part-way through.
                var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024,
                    FileOptions.DeleteOnClose | FileOptions.Asynchronous);
                return Results.File(stream, "application/octet-stream", BuildDownloadName(singleTitle, extension));
            }
            catch (Exception)
            {
                // Nothing downstream will ever open this file, so nothing else would delete it.
                // Covers a cancelled export, an adapter that threw part-way through writing, and a
                // handle that could not be opened once it had.
                TransferStagingStore.TryDeleteFile(path);
                throw;
            }
        });
    }

    private static MindmapTransferUploadDto Described(
        string uploadId,
        string path,
        long sizeBytes,
        ImportExportCapability format,
        bool canImport,
        int? mapCount,
        IReadOnlyList<string> warnings) =>
        new(uploadId, Path.GetFileName(path), sizeBytes, format.FormatId, format.DisplayName, canImport, mapCount, warnings);

    /// <summary>The import format an extension belongs to, or null when nothing claims it.</summary>
    private static ImportExportCapability? ResolveImportFormat(IImportExportCoordinator transfer, string? extension)
    {
        if (string.IsNullOrWhiteSpace(extension))
            return null;

        return transfer.GetCapabilities(MindmapsContentType)
            .FirstOrDefault(c => c.SupportsImport &&
                c.Extensions.Any(ext => string.Equals(ext, extension, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>
    /// What the browser saves the download as: one map exports under its own title, a selection under
    /// a generic name, matching the names the desktop's save dialog suggests.
    /// </summary>
    private static string BuildDownloadName(string? singleTitle, string extension)
    {
        var name = string.IsNullOrWhiteSpace(singleTitle) ? "mindmaps" : singleTitle!;

        foreach (var invalid in Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');

        name = name.Trim().Trim('.');
        return (string.IsNullOrWhiteSpace(name) ? "mindmaps" : name) + extension;
    }
}
