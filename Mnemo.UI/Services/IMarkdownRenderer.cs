using System.Collections.Generic;
using System.Threading.Tasks;
using Avalonia.Controls;
using Mnemo.Core.Models.Markdown;

namespace Mnemo.UI.Services;

using Avalonia.Media;
// ...
public interface IMarkdownRenderer
{
    /// <summary>
    /// Renders markdown to a control tree. When <paramref name="baseFontSizeOverride"/> is set it replaces
    /// the user's Markdown.* font-size settings for this render (headings, code and math scale with it),
    /// letting compact surfaces like chat opt out of the document-reading scale.
    /// </summary>
    Task<Control> RenderAsync(string markdown, Dictionary<string, MarkdownSpecialInline> specialInlines, IBrush? foreground = null, double? baseFontSizeOverride = null);
}