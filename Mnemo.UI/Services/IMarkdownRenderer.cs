using System.Collections.Generic;
using System.Threading.Tasks;
using Avalonia.Controls;
using Mnemo.Core.Models.Markdown;

namespace Mnemo.UI.Services;

using Avalonia.Media;

/// <summary>
/// Typographic profile for a rendered markdown surface. Documents keep the classic
/// heading ramp (H1 at 2x body); conversational surfaces cap headings near body size
/// and shrink code so an answer reads as prose rather than a document.
/// </summary>
public enum MarkdownRenderProfile
{
    Document,
    Conversation
}

public interface IMarkdownRenderer
{
    /// <summary>
    /// Renders markdown to a control tree. When <paramref name="baseFontSizeOverride"/> is set it replaces
    /// the user's Markdown.* font-size settings for this render (headings, code and math scale with it),
    /// letting compact surfaces like chat opt out of the document-reading scale.
    /// <paramref name="lineHeightOverride"/> does the same for leading, so a surface can set its own
    /// reading rhythm without rewriting the user's document-wide preference.
    /// </summary>
    Task<Control> RenderAsync(
        string markdown,
        Dictionary<string, MarkdownSpecialInline> specialInlines,
        IBrush? foreground = null,
        double? baseFontSizeOverride = null,
        double? lineHeightOverride = null,
        MarkdownRenderProfile profile = MarkdownRenderProfile.Document);
}
