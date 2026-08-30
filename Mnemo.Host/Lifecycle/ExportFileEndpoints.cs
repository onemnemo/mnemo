using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Choosing where an exported file goes, and writing one the page is holding.
/// </summary>
/// <remarks>
/// A browser saves a file by clicking a synthetic <c>&lt;a download&gt;</c>, which does produce a
/// file, but it lands wherever the downloads folder is rather than anywhere the user chose, and the
/// page learns nothing about it: the click returns the same whether the write happened or not. That
/// blindness is what left five dialogs reporting success unconditionally. The host raising the
/// chooser and writing the bytes is the only arrangement that can name the file afterwards, or tell
/// a dismissed dialog from a failure.
///
/// The chooser route runs before any work does, so dismissing it costs nothing. It hands back a
/// grant, and every save route in the app writes to the destination that grant carries. The upload
/// route here is for the two exports the renderer draws itself; a file the host produced never
/// travels to the page and back, it is written where it was asked for.
/// </remarks>
public static class ExportFileEndpoints
{
    private const string LogCategory = "App.Export";

    public static void MapExportFile(this IEndpointRouteBuilder endpoints)
    {
        // What a dialog shows as its destination before anyone has chosen one. Where a file goes is
        // a decision made once and then repeated, so the folder the last export went to is a better
        // default to show than anything the app could pick.
        endpoints.MapGet("/api/app/export-folders", async (ISettingsService settings, NativeFileDialogs dialogs) =>
            new ExportFoldersDto(dialogs.IsAvailable, await ExportFolders.ListAsync(settings).ConfigureAwait(false)));

        // Raises the system save chooser. Only the host can: a web page cannot open one, and the
        // handle the File System Access API would give back is not a path anything else here
        // could write to.
        endpoints.MapPost("/api/app/export-file/target", async (
            ExportSaveTargetRequest? body,
            NativeFileDialogs dialogs,
            ExportGrants grants,
            ISettingsService settings) =>
        {
            if (!dialogs.IsAvailable)
                return Results.Ok(new ExportSaveTargetDto(Available: false, Path: null));

            var fileName = body?.FileName?.Trim();
            if (string.IsNullOrEmpty(fileName) || Path.GetFileName(fileName) != fileName)
                return Results.BadRequest(new ErrorDto("invalid_file_name", "That file name cannot be used."));

            var title = string.IsNullOrWhiteSpace(body?.Title) ? "Save as" : body!.Title!.Trim();
            var folders = await ExportFolders.ListAsync(settings).ConfigureAwait(false);
            var chosen = await dialogs.PickSaveFileAsync(title, folders.FirstOrDefault(), fileName).ConfigureAwait(false);

            // Dismissed is an outcome, not a failure, so it answers 200 with nothing chosen rather
            // than a status the caller has to tell apart from a real error.
            if (string.IsNullOrWhiteSpace(chosen))
                return Results.Ok(new ExportSaveTargetDto(Available: true, Path: null));

            // The extension is settled here and only here, so the destination the grant carries is
            // the one that gets written. A chooser hands back whatever was typed, and a package
            // saved as "decks" is a file nothing will open.
            if (!ExportTarget.TryResolvePath(chosen, Path.GetExtension(fileName), out var target, out var error))
                return Results.BadRequest(new ErrorDto(error, "That destination cannot be written to."));

            // The chooser asked about overwriting the name that was typed. Appending an extension
            // moves the write to a name it never asked about, so anything already sitting there
            // would be replaced with no prompt at all.
            var appended = !string.Equals(target!.FullPath, Path.GetFullPath(chosen!), StringComparison.Ordinal);
            var confirmOverwrite = appended && File.Exists(target.FullPath);

            return Results.Ok(new ExportSaveTargetDto(
                Available: true,
                Path: target.FullPath,
                Grant: grants.Issue(target),
                ConfirmOverwrite: confirmOverwrite));
        });

        // The mind map pictures, which are drawn in the renderer and exist nowhere else.
        endpoints.MapPost("/api/app/export-file", async (
            HttpRequest request,
            ExportGrants grants,
            ISettingsService settings,
            ILoggerService logger,
            CancellationToken cancellationToken) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new ErrorDto("invalid_upload", "Expected a multipart form upload."));

            // Kestrel's default 30 MB body limit sits below what an export of a collection with
            // images reaches. The bytes arrive as a file part rather than in JSON so they survive
            // the trip as themselves, with no base64 inflating them by a third on the way.
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

            // The destination comes from the grant and nowhere else. Nothing in the request body
            // names a path, so a page that has been made to say whatever an attacker wants still
            // cannot name a file to write.
            if (!grants.TryConsume(form["grant"], out var target))
                return Results.BadRequest(new ErrorDto("unknown_grant", "That destination was not chosen, or the choice has lapsed."));

            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null)
                return Results.BadRequest(new ErrorDto("empty_upload", "No file was uploaded."));
            if (file.Length > TransferLimits.MaxFileBytes)
                return Results.BadRequest(new ErrorDto("file_too_large", $"The file exceeds the {TransferLimits.MaxFileMegabytes} MB limit."));

            var pending = string.Empty;
            try
            {
                pending = ExportDestination.PathFor(target);
                await using (var destination = new FileStream(
                    pending, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize: 81920, useAsync: true))
                {
                    await using var source = file.OpenReadStream();
                    await source.CopyToAsync(destination, cancellationToken).ConfigureAwait(false);
                }

                return await ExportDestination.CommitAsync(target!, pending, settings).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // The window closed or the request was abandoned. Not a write failure, and not the
                // route's to answer: the framework unwinds it without writing a response.
                ExportDestination.Discard(pending);
                throw;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return ExportDestination.Failed(target!, pending, logger, LogCategory, ex);
            }
        });
    }
}
