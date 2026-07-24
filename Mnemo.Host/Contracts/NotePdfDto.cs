namespace Mnemo.Host.Contracts;

/// <summary>
/// PDF export/preview options from the client. Every field is optional; an omitted field takes the
/// same default the desktop overlay uses. Enum-like fields are lenient string tokens so the client
/// sends readable values rather than magic indices, and an unrecognized token falls back to default.
/// </summary>
public sealed record NotePdfExportOptionsDto(
    string? Paper = null,               // "a4" | "letter"
    string? Margin = null,              // "normal" | "narrow"
    bool? IncludeNoteTitle = null,
    float? BaseFontSizePt = null,
    string? PageNumberAlignment = null, // "none" | "left" | "center" | "right"
    string? PageNumberFormat = null,    // "current" | "currentAndTotal"
    bool? RenderColors = null,
    bool? RenderImages = null);
