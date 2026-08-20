using System;

namespace Mnemo.Core.Formatting;

/// <summary>
/// Pure-logic applier for inline formatting using markdown-style delimiters.
/// Wrap/unwrap is based on simple string checks, no regex.
/// </summary>
public static class InlineFormatApplier
{
    public static (string NewContent, int NewSelectionStart, int NewSelectionEnd) Apply(
        string content, int start, int end, InlineFormatKind kind, string? color = null)
    {
        if (string.IsNullOrEmpty(content) || start < 0 || end <= start || end > content.Length)
            return (content, start, end);

        if (kind == InlineFormatKind.Subscript || kind == InlineFormatKind.Superscript)
            return (content, start, end);

        if (kind == InlineFormatKind.BackgroundColor)
            return ApplyBackgroundColor(content, start, end, color);

        var (open, close) = GetDelimiters(kind);
        if (open == null || close == null)
            return (content, start, end);

        string selected = content.Substring(start, end - start);

        if (IsWrapped(selected, open, close))
            return Unwrap(content, start, end, open, close);

        if (IsWrappedInContext(content, start, end, open, close))
            return UnwrapFromContext(content, start, end, open, close);

        return Wrap(content, start, end, open, close);
    }

    private static (string? Open, string? Close) GetDelimiters(InlineFormatKind kind) => kind switch
    {
        InlineFormatKind.Bold => ("**", "**"),
        InlineFormatKind.Italic => ("*", "*"),
        InlineFormatKind.Underline => ("__", "__"),
        InlineFormatKind.Strikethrough => ("~~", "~~"),
        InlineFormatKind.Highlight => ("==", "=="),
        _ => (null, null)
    };

    private static bool IsWrapped(string text, string open, string close)
    {
        return text.Length >= open.Length + close.Length
            && text.StartsWith(open)
            && text.EndsWith(close);
    }

    /// <summary>
    /// Checks if the selection is surrounded by delimiters in the full content
    /// (e.g. user selects "bold" inside "**bold**").
    /// </summary>
    private static bool IsWrappedInContext(string content, int start, int end, string open, string close)
    {
        return start >= open.Length
            && end + close.Length <= content.Length
            && content.Substring(start - open.Length, open.Length) == open
            && content.Substring(end, close.Length) == close;
    }

    private static (string, int, int) Unwrap(string content, int start, int end, string open, string close)
    {
        string selected = content.Substring(start, end - start);
        string inner = selected.Substring(open.Length, selected.Length - open.Length - close.Length);
        string newContent = content.Substring(0, start) + inner + content.Substring(end);
        return (newContent, start, start + inner.Length);
    }

    private static (string, int, int) UnwrapFromContext(string content, int start, int end, string open, string close)
    {
        int outerStart = start - open.Length;
        int outerEnd = end + close.Length;
        string inner = content.Substring(start, end - start);
        string newContent = content.Substring(0, outerStart) + inner + content.Substring(outerEnd);
        return (newContent, outerStart, outerStart + inner.Length);
    }

    private static (string, int, int) Wrap(string content, int start, int end, string open, string close)
    {
        string selected = content.Substring(start, end - start);
        string wrapped = open + selected + close;
        string newContent = content.Substring(0, start) + wrapped + content.Substring(end);
        int newSelStart = start + open.Length;
        int newSelEnd = newSelStart + selected.Length;
        return (newContent, newSelStart, newSelEnd);
    }

    private static (string, int, int) ApplyBackgroundColor(string content, int start, int end, string? color)
    {
        if (string.IsNullOrEmpty(color))
            return (content, start, end);

        string openTag = "{bg:" + color + "}";
        string closeTag = "{/bg}";

        string selected = content.Substring(start, end - start);

        if (selected.StartsWith(openTag) && selected.EndsWith(closeTag))
        {
            string inner = selected.Substring(openTag.Length, selected.Length - openTag.Length - closeTag.Length);
            string newContent = content.Substring(0, start) + inner + content.Substring(end);
            return (newContent, start, start + inner.Length);
        }

        if (start >= openTag.Length && end + closeTag.Length <= content.Length
            && content.Substring(start - openTag.Length, openTag.Length) == openTag
            && content.Substring(end, closeTag.Length) == closeTag)
        {
            int outerStart = start - openTag.Length;
            int outerEnd = end + closeTag.Length;
            string inner = content.Substring(start, end - start);
            string newContent = content.Substring(0, outerStart) + inner + content.Substring(outerEnd);
            return (newContent, outerStart, outerStart + inner.Length);
        }

        // Check if wrapped with any bg tag (different color) and replace
        var existingOpen = TryFindBgOpenTag(content, start);
        if (existingOpen != null
            && end + closeTag.Length <= content.Length
            && content.Substring(end, closeTag.Length) == closeTag)
        {
            int outerStart = existingOpen.Value.tagStart;
            int outerEnd = end + closeTag.Length;
            string inner = content.Substring(start, end - start);
            string wrapped = openTag + inner + closeTag;
            string newContent = content.Substring(0, outerStart) + wrapped + content.Substring(outerEnd);
            int newSelStart = outerStart + openTag.Length;
            return (newContent, newSelStart, newSelStart + inner.Length);
        }

        // Wrap
        string w = openTag + selected + closeTag;
        string nc = content.Substring(0, start) + w + content.Substring(end);
        int ns = start + openTag.Length;
        return (nc, ns, ns + selected.Length);
    }

    private static (int tagStart, string tag)? TryFindBgOpenTag(string content, int selectionStart)
    {
        string prefix = "{bg:";
        for (int i = selectionStart - 1; i >= 0; i--)
        {
            if (i + prefix.Length <= selectionStart && content.Substring(i, prefix.Length) == prefix)
            {
                int closeIdx = content.IndexOf('}', i + prefix.Length);
                if (closeIdx >= 0 && closeIdx < selectionStart)
                {
                    string tag = content.Substring(i, closeIdx - i + 1);
                    return (i, tag);
                }
            }
        }
        return null;
    }
}
