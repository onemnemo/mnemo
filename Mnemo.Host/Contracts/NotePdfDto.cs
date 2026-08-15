namespace Mnemo.Host.Contracts;

/// <summary>
/// PDF export/preview options from the client. Every field is optional; an omitted field takes the
/// same default the desktop overlay uses. Enum-like fields are lenient string tokens so the client
/// sends readable values rather than magic indices, and an unrecognized token falls back to default.
/// The two text fields carry the client's own translations, so a printed footer or a missing
/// sub-page reads in the language the app is running in rather than in English.
/// </summary>
public sealed record NotePdfExportOptionsDto(
    string? Paper = null,               // "a4" | "letter" | "legal" | "a5"
    bool? Landscape = null,
    string? Margin = null,              // "normal" | "narrow" | "wide"
    bool? IncludeNoteTitle = null,
    bool? IncludeTags = null,
    float? BaseFontSizePt = null,
    string? PageNumberAlignment = null, // "none" | "left" | "center" | "right"
    string? PageNumberFormat = null,    // "current" | "currentAndTotal" | "worded"
    string? PageNumberWordedFormat = null, // "{0}" is the page, "{1}" the total
    bool? RenderColors = null,
    bool? RenderImages = null,
    bool? RenderSubpageLinks = null,
    string? MissingSubpageTitle = null);
