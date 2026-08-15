using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Lifecycle;
using Mnemo.Infrastructure.Services.Notes.Pdf;

namespace Mnemo.Host.Notes;

/// <summary>
/// Renders a note to PDF. Two routes over one <see cref="INotePdfExportService"/>: <c>preview</c>
/// returns the PDF inline for the editor's viewer to page through, <c>export</c> returns the same
/// bytes as a named download. Both take the note id in the route and the render options in the body,
/// so a settings change re-posts without re-sending the note.
/// </summary>
/// <remarks>
/// The web host has no Avalonia, so inline color tokens resolve against the shared Dawn table rather
/// than the live theme; that is the whole reason the swatch tables were lifted into Core. The request
/// token is honored, so a preview the user superseded before it finished is cancelled and its Typst
/// process killed rather than left running.
/// </remarks>
public static class NotePdfEndpoints
{
    private const string LogCategory = "Notes.Pdf";
    private const string PdfContentType = "application/pdf";

    public static void MapNotePdf(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/notes/{id}/pdf/preview", async (
            string id,
            NotePdfExportOptionsDto? body,
            INoteService notes,
            INotePdfExportService pdf,
            ILoggerService logger,
            CancellationToken cancellationToken) =>
        {
            var note = await notes.GetNoteAsync(id).ConfigureAwait(false);
            if (note is null)
                return Results.NotFound(new ErrorDto("unknown_note", $"No note '{id}'."));

            var options = await BuildOptionsAsync(body, note, notes).ConfigureAwait(false);
            return await RenderAsync(note, options, pdf, logger, downloadName: null, cancellationToken)
                .ConfigureAwait(false);
        }).RequireNotesMigrated();

        endpoints.MapPost("/api/notes/{id}/pdf/export", async (
            string id,
            NotePdfExportOptionsDto? body,
            INoteService notes,
            INotePdfExportService pdf,
            ILoggerService logger,
            CancellationToken cancellationToken) =>
        {
            var note = await notes.GetNoteAsync(id).ConfigureAwait(false);
            if (note is null)
                return Results.NotFound(new ErrorDto("unknown_note", $"No note '{id}'."));

            var options = await BuildOptionsAsync(body, note, notes).ConfigureAwait(false);
            return await RenderAsync(note, options, pdf, logger, DownloadName(note.Title), cancellationToken)
                .ConfigureAwait(false);
        }).RequireNotesMigrated();

        // The same render, written to a folder on this machine instead of returned.
        //
        // Its own route rather than a flag on export, because the two answer differently: one hands
        // back a PDF and lets the browser decide where it lands, the other writes the file and
        // reports a path. A dialog that names a destination needs the second, and there is no
        // destination to name until the host has actually chosen one.
        endpoints.MapPost("/api/notes/{id}/pdf/save", async (
            string id,
            NotePdfSaveRequestDto body,
            INoteService notes,
            INotePdfExportService pdf,
            ISettingsService settings,
            ILoggerService logger,
            CancellationToken cancellationToken) =>
        {
            var note = await notes.GetNoteAsync(id).ConfigureAwait(false);
            if (note is null)
                return Results.NotFound(new ErrorDto("unknown_note", $"No note '{id}'."));

            if (!TryResolveTarget(body, out var fullPath, out var directory, out var error))
                return Results.BadRequest(new ErrorDto(error, "That destination cannot be written to."));

            var options = await BuildOptionsAsync(body.Options, note, notes).ConfigureAwait(false);
            try
            {
                var bytes = await pdf.GeneratePdfAsync(note, options, cancellationToken).ConfigureAwait(false);
                Directory.CreateDirectory(directory);
                await File.WriteAllBytesAsync(fullPath, bytes, cancellationToken).ConfigureAwait(false);
            }
            catch (TypstToolchainUnavailableException ex)
            {
                logger.Error(LogCategory, "Typst toolchain unavailable for PDF export.", ex);
                return Results.Json(
                    new ErrorDto("pdf_unavailable", "PDF export is not available on this server."),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            catch (TypstCompileException ex)
            {
                logger.Error(LogCategory, "Typst failed to render a note to PDF.", ex);
                return Results.Json(
                    new ErrorDto("pdf_failed", "The note could not be rendered to PDF."),
                    statusCode: StatusCodes.Status500InternalServerError);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // A read-only folder, a removed drive, a file open in a reader. The user picked the
                // place, so this is theirs to fix rather than a fault to bury in the log alone.
                logger.Warning(LogCategory, $"Could not write a PDF to {directory}: {ex.Message}");
                return Results.Json(
                    new ErrorDto("write_failed", "The file could not be written to that folder."),
                    statusCode: StatusCodes.Status409Conflict);
            }

            // Only once the write succeeded: a folder that could not be written to is not one to
            // offer first the next time.
            await ExportFolders.RememberAsync(settings, directory).ConfigureAwait(false);
            return Results.Ok(new NotePdfSavedDto(fullPath));
        }).RequireNotesMigrated();
    }

    /// <summary>
    /// Turns a requested folder and file name into one absolute path, or refuses.
    /// </summary>
    /// <remarks>
    /// The security boundary of the save route. The folder is a path the caller supplies, which is
    /// the point of the feature, so the checks are on shape rather than on a list: it must be
    /// absolute, its parent must already exist (so a typo cannot conjure a tree), and the file name
    /// must be a name and not a path, which is what keeps <c>..\..\</c> out of the result.
    /// </remarks>
    private static bool TryResolveTarget(
        NotePdfSaveRequestDto body,
        out string fullPath,
        out string directory,
        out string error)
    {
        fullPath = string.Empty;
        directory = string.Empty;

        var name = body.FileName?.Trim() ?? string.Empty;
        if (name.Length == 0 || Path.GetFileName(name) != name || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
        {
            error = "invalid_file_name";
            return false;
        }

        var requested = body.Directory?.Trim() ?? string.Empty;
        if (requested.Length == 0 || !Path.IsPathFullyQualified(requested))
        {
            error = "invalid_directory";
            return false;
        }

        directory = Path.GetFullPath(requested);
        var parent = Path.GetDirectoryName(directory);
        if (!Directory.Exists(directory) && (parent is null || !Directory.Exists(parent)))
        {
            error = "missing_directory";
            return false;
        }

        fullPath = Path.Combine(directory, name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ? name : name + ".pdf");
        error = string.Empty;
        return true;
    }

    private static async Task<IResult> RenderAsync(
        Note note,
        NotePdfExportOptions options,
        INotePdfExportService pdf,
        ILoggerService logger,
        string? downloadName,
        CancellationToken cancellationToken)
    {
        try
        {
            var bytes = await pdf.GeneratePdfAsync(note, options, cancellationToken).ConfigureAwait(false);
            return downloadName is null
                ? Results.File(bytes, PdfContentType)
                : Results.File(bytes, PdfContentType, downloadName);
        }
        catch (TypstToolchainUnavailableException ex)
        {
            // A deployment problem, not a bad request: the binary was never restored on this server.
            logger.Error(LogCategory, "Typst toolchain unavailable for PDF export.", ex);
            return Results.Json(
                new ErrorDto("pdf_unavailable", "PDF export is not available on this server."),
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (TypstCompileException ex)
        {
            // The stderr is a developer detail; log it and hand the client a plain message.
            logger.Error(LogCategory, "Typst failed to render a note to PDF.", ex);
            return Results.Json(
                new ErrorDto("pdf_failed", "The note could not be rendered to PDF."),
                statusCode: StatusCodes.Status500InternalServerError);
        }
        // OperationCanceledException is left to propagate: a superseded preview is a client abort,
        // not a server error, and the framework unwinds it without writing a response.
    }

    private static async Task<NotePdfExportOptions> BuildOptionsAsync(
        NotePdfExportOptionsDto? dto,
        Note note,
        INoteService notes)
    {
        var defaults = new NotePdfExportOptions();
        var renderSubpages = dto?.RenderSubpageLinks ?? defaults.RenderSubpageLinks;
        return new NotePdfExportOptions
        {
            Paper = ParsePaper(dto?.Paper, defaults.Paper),
            Landscape = dto?.Landscape ?? defaults.Landscape,
            Margin = ParseMargin(dto?.Margin, defaults.Margin),
            IncludeNoteTitle = dto?.IncludeNoteTitle ?? defaults.IncludeNoteTitle,
            IncludeTags = dto?.IncludeTags ?? defaults.IncludeTags,
            BaseFontSizePt = dto?.BaseFontSizePt is { } pt && pt is >= 6f and <= 32f ? pt : defaults.BaseFontSizePt,
            PageNumberAlignment = ParseAlignment(dto?.PageNumberAlignment, defaults.PageNumberAlignment),
            PageNumberFormat = ParseFormat(dto?.PageNumberFormat, defaults.PageNumberFormat),
            PageNumberWordedFormat = Text(dto?.PageNumberWordedFormat, defaults.PageNumberWordedFormat),
            RenderColors = dto?.RenderColors ?? defaults.RenderColors,
            RenderImages = dto?.RenderImages ?? defaults.RenderImages,
            RenderSubpageLinks = renderSubpages,
            SubpageTitlesById = renderSubpages
                ? await ResolveSubpageTitlesAsync(note, notes).ConfigureAwait(false)
                : null,
            MissingSubpageTitle = Text(dto?.MissingSubpageTitle, defaults.MissingSubpageTitle),
            // The web host resolves inline color tokens against Dawn directly; no theme is involved.
            BackgroundSwatchHexByName = NotePdfDawnSwatches.Background,
            ForegroundSwatchHexByName = NotePdfDawnSwatches.Foreground,
        };
    }

    /// <summary>
    /// Titles for the notes this one links to as sub-pages. One read per distinct reference, and only
    /// when the sub-page rows are actually being printed; a note that links to nothing costs nothing.
    /// A reference that no longer resolves is left out, and the composer prints the stand-in.
    /// </summary>
    private static async Task<IReadOnlyDictionary<string, string>?> ResolveSubpageTitlesAsync(Note note, INoteService notes)
    {
        var ids = NotePdfSubpages.CollectReferencedNoteIds(note);
        if (ids.Count == 0)
            return null;

        var titles = new Dictionary<string, string>(ids.Count, StringComparer.Ordinal);
        foreach (var id in ids)
        {
            var referenced = await notes.GetNoteAsync(id).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(referenced?.Title))
                titles[id] = referenced!.Title.Trim();
        }
        return titles;
    }

    private static string Text(string? value, string fallback) =>
        string.IsNullOrWhiteSpace(value) ? fallback : value!.Trim();

    private static NotePdfPaperKind ParsePaper(string? value, NotePdfPaperKind fallback) => value?.Trim().ToLowerInvariant() switch
    {
        "a4" => NotePdfPaperKind.A4,
        "letter" or "us-letter" or "usletter" => NotePdfPaperKind.Letter,
        "legal" or "us-legal" or "uslegal" => NotePdfPaperKind.Legal,
        "a5" => NotePdfPaperKind.A5,
        _ => fallback,
    };

    private static NotePdfMarginPreset ParseMargin(string? value, NotePdfMarginPreset fallback) => value?.Trim().ToLowerInvariant() switch
    {
        "normal" => NotePdfMarginPreset.Normal,
        "narrow" => NotePdfMarginPreset.Narrow,
        "wide" => NotePdfMarginPreset.Wide,
        _ => fallback,
    };

    private static NotePdfPageNumberAlignment ParseAlignment(string? value, NotePdfPageNumberAlignment fallback) => value?.Trim().ToLowerInvariant() switch
    {
        "none" => NotePdfPageNumberAlignment.None,
        "left" => NotePdfPageNumberAlignment.Left,
        "center" or "centre" => NotePdfPageNumberAlignment.Center,
        "right" => NotePdfPageNumberAlignment.Right,
        _ => fallback,
    };

    private static NotePdfPageNumberFormat ParseFormat(string? value, NotePdfPageNumberFormat fallback) => value?.Trim().ToLowerInvariant() switch
    {
        "current" => NotePdfPageNumberFormat.CurrentPage,
        "currentandtotal" or "current-and-total" or "currenttotal" => NotePdfPageNumberFormat.CurrentAndTotalPages,
        "worded" or "pageoftotal" or "page-of-total" => NotePdfPageNumberFormat.PageOfTotal,
        _ => fallback,
    };

    /// <summary>The download filename: the note's title, sanitized, or a generic fallback.</summary>
    private static string DownloadName(string? title)
    {
        var name = string.IsNullOrWhiteSpace(title) ? "note" : title!;
        foreach (var invalid in Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');
        name = name.Trim().Trim('.');
        return (string.IsNullOrWhiteSpace(name) ? "note" : name) + ".pdf";
    }
}
