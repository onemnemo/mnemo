using Avalonia.Controls;
using Avalonia.Media;

namespace Mnemo.UI.Services;

/// <summary>
/// TextMate grammar-based syntax highlighting (TextMateSharp + bundled grammars).
/// </summary>
public interface ITextMateSyntaxHighlighter
{
    /// <summary>
    /// Replaces <paramref name="target"/>'s inlines with highlighted runs. Uses <paramref name="defaultForeground"/>
    /// when no token color is resolved.
    /// </summary>
    void ApplyToTextBlock(TextBlock target, string code, string? languageFenceId, IBrush defaultForeground);
}
