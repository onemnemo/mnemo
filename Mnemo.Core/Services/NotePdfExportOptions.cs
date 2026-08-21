using System.Collections.Generic;

namespace Mnemo.Core.Services;

public enum NotePdfPaperKind
{
    A4,
    Letter,
    Legal,
    A5
}

public enum NotePdfMarginPreset
{
    Normal,
    Narrow,
    Wide
}

public enum NotePdfPageNumberAlignment
{
    None,
    Left,
    Center,
    Right
}

public enum NotePdfPageNumberFormat
{
    /// <summary>Just the page, e.g. <c>2</c>.</summary>
    CurrentPage,

    /// <summary>Page over total, e.g. <c>2 / 7</c>.</summary>
    CurrentAndTotalPages,

    /// <summary>Spelled out, e.g. <c>Page 2 of 7</c>.</summary>
    PageOfTotal
}

/// <summary>Options for exporting a note to PDF. Used by <see cref="INotePdfExportService"/>.</summary>
public sealed class NotePdfExportOptions
{
    public NotePdfPaperKind Paper { get; init; } = NotePdfPaperKind.A4;

    /// <summary>Turns the sheet on its side; the paper keeps its size.</summary>
    public bool Landscape { get; init; }

    public NotePdfMarginPreset Margin { get; init; } = NotePdfMarginPreset.Normal;

    public bool IncludeNoteTitle { get; init; } = true;

    /// <summary>Print the note's tags under its title. Ignored when the note has none.</summary>
    public bool IncludeTags { get; init; } = true;

    public float BaseFontSizePt { get; init; } = 11f;

    public NotePdfPageNumberAlignment PageNumberAlignment { get; init; } = NotePdfPageNumberAlignment.Center;

    public NotePdfPageNumberFormat PageNumberFormat { get; init; } = NotePdfPageNumberFormat.CurrentAndTotalPages;

    /// <summary>
    /// The wording for <see cref="NotePdfPageNumberFormat.PageOfTotal"/>, with <c>{0}</c> for the page
    /// and <c>{1}</c> for the total. The caller passes its own translation so a note does not print
    /// a footer in the fallback language; the literal parts are escaped into the Typst pattern.
    /// </summary>
    public string PageNumberWordedFormat { get; init; } = "Page {0} of {1}";

    /// <summary>Render inline highlights and text/background colors. When false the document renders monochrome.</summary>
    public bool RenderColors { get; init; } = true;

    /// <summary>Render image and sketch blocks. When false they are omitted from the document.</summary>
    public bool RenderImages { get; init; } = true;

    /// <summary>
    /// Print sub-page blocks as the title of the note they point at. A link cannot be followed on
    /// paper, so when false the row is dropped entirely rather than printed as dead blue text.
    /// </summary>
    public bool RenderSubpageLinks { get; init; } = true;

    /// <summary>
    /// Titles for the notes sub-page blocks reference, keyed by note id. The block itself stores only
    /// the id, so a caller that can read the corpus resolves them up front; an id missing from here
    /// prints <see cref="MissingSubpageTitle"/> instead.
    /// </summary>
    public IReadOnlyDictionary<string, string>? SubpageTitlesById { get; init; }

    /// <summary>Stands in for a sub-page whose note could not be read, e.g. because it was deleted.</summary>
    public string MissingSubpageTitle { get; init; } = "Untitled";

    /// <summary>DPI for preview rasterization only (<see cref="INotePdfExportService.GeneratePreviewPngPagesAsync"/>).</summary>
    public int PreviewRasterDpi { get; init; } = 120;

    /// <summary>
    /// Maps inline background keys from the notes editor (e.g. <c>swatch1</c>) to <c>#RRGGBB</c> for PDF rendering.
    /// Should use <see cref="NotePdfLightSwatches.Background"/> so colors match a light page regardless of the app theme.
    /// When null, only literal hex strings in span styles resolve.
    /// </summary>
    public IReadOnlyDictionary<string, string>? BackgroundSwatchHexByName { get; init; }

    /// <summary>
    /// Maps inline foreground keys from the notes editor (e.g. <c>swatch1</c>) to <c>#RRGGBB</c> for PDF rendering.
    /// Should use <see cref="NotePdfLightSwatches.Foreground"/> so colors match a light page regardless of the app theme.
    /// </summary>
    public IReadOnlyDictionary<string, string>? ForegroundSwatchHexByName { get; init; }
}
