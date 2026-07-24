using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
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

            return await RenderAsync(note, BuildOptions(body), pdf, logger, downloadName: null, cancellationToken)
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

            return await RenderAsync(note, BuildOptions(body), pdf, logger, DownloadName(note.Title), cancellationToken)
                .ConfigureAwait(false);
        }).RequireNotesMigrated();
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

    private static NotePdfExportOptions BuildOptions(NotePdfExportOptionsDto? dto)
    {
        var defaults = new NotePdfExportOptions();
        return new NotePdfExportOptions
        {
            Paper = ParsePaper(dto?.Paper, defaults.Paper),
            Margin = ParseMargin(dto?.Margin, defaults.Margin),
            IncludeNoteTitle = dto?.IncludeNoteTitle ?? defaults.IncludeNoteTitle,
            BaseFontSizePt = dto?.BaseFontSizePt is { } pt && pt is >= 6f and <= 32f ? pt : defaults.BaseFontSizePt,
            PageNumberAlignment = ParseAlignment(dto?.PageNumberAlignment, defaults.PageNumberAlignment),
            PageNumberFormat = ParseFormat(dto?.PageNumberFormat, defaults.PageNumberFormat),
            RenderColors = dto?.RenderColors ?? defaults.RenderColors,
            RenderImages = dto?.RenderImages ?? defaults.RenderImages,
            // The web host resolves inline color tokens against Dawn directly; no theme is involved.
            BackgroundSwatchHexByName = NotePdfDawnSwatches.Background,
            ForegroundSwatchHexByName = NotePdfDawnSwatches.Foreground,
        };
    }

    private static NotePdfPaperKind ParsePaper(string? value, NotePdfPaperKind fallback) => value?.Trim().ToLowerInvariant() switch
    {
        "a4" => NotePdfPaperKind.A4,
        "letter" or "us-letter" or "usletter" => NotePdfPaperKind.Letter,
        _ => fallback,
    };

    private static NotePdfMarginPreset ParseMargin(string? value, NotePdfMarginPreset fallback) => value?.Trim().ToLowerInvariant() switch
    {
        "normal" => NotePdfMarginPreset.Normal,
        "narrow" => NotePdfMarginPreset.Narrow,
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
