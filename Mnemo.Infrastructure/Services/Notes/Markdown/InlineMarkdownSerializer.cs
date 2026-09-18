using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Text;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes.Markdown;

/// <summary>Serializes <see cref="InlineSpan"/> lists to CommonMark-style inline markdown.</summary>
public static class InlineMarkdownSerializer
{
    private static readonly Regex EmbeddedImageRegex = new(
        @"!\[[^\]]*\]\([^)]+\)(?:\{align=(?:left|center|right)\})?",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    public static string SerializeSpans(IReadOnlyList<InlineSpan> spans)
    {
        if (spans.Count == 0) return string.Empty;
        var sb = new StringBuilder();
        foreach (var s in spans)
            sb.Append(SerializeSpan(s));
        return sb.ToString();
    }

    private static string SerializeSpan(InlineSpan s) => s switch
    {
        // An empty chip is a placeholder with nothing to say, and the "$$" it would write is a
        // fence to every reader, which swallows the rest of the document into one equation.
        EquationSpan e => e.Latex.Length == 0 ? string.Empty : "$" + e.Latex + "$",
        FractionSpan f => $"\\{f.Numerator}/{f.Denominator}",
        TextSpan t => SerializeTextSpan(t),
        _ => string.Empty
    };

    private static string SerializeTextSpan(TextSpan r)
    {
        if (r.Text.Length == 0)
            return string.Empty;

        if (r.Style.Code)
            return SerializeCodeSpan(r.Text);

        var escaped = EscapeMarkdownTextPreservingEmbeddedImages(r.Text);
        var o = escaped;
        if (r.Style.Bold && r.Style.Italic)
            o = "***" + o + "***";
        else if (r.Style.Bold)
            o = "**" + o + "**";
        else if (r.Style.Italic)
            o = "*" + o + "*";
        if (r.Style.Strikethrough)
            o = "~~" + o + "~~";
        if (!string.IsNullOrEmpty(r.Style.LinkUrl))
            o = "[" + o + "](" + EscapeMarkdownLinkDestination(r.Style.LinkUrl) + ")";
        return o;
    }

    private static string EscapeMarkdownLinkDestination(string url)
    {
        if (string.IsNullOrEmpty(url)) return url;
        return url.Replace("\\", "\\\\", System.StringComparison.Ordinal).Replace(")", "\\)", System.StringComparison.Ordinal);
    }

    /// <summary>
    /// A code span is fenced by one more backtick than its longest internal run, padded when it
    /// holds any backtick at all. A newline cannot ride inside the span, where a backslash is
    /// literal and CommonMark reads a line ending as a space, so the span is closed, the hard
    /// break written, and the span reopened on the next line.
    /// </summary>
    private static string SerializeCodeSpan(string text)
    {
        if (text.Contains('\n') || text.Contains('\r'))
        {
            var lines = text.Replace("\r\n", "\n", System.StringComparison.Ordinal).Replace('\r', '\n').Split('\n');
            var parts = new string[lines.Length];
            for (var i = 0; i < lines.Length; i++)
                parts[i] = lines[i].Length > 0 ? SerializeCodeSpan(lines[i]) : string.Empty;
            return string.Join(MarkdownHardBreak.Marker, parts);
        }

        var maxRun = MaxConsecutiveBackticks(text);
        var fenceLen = maxRun + 1;
        var fence = new string('`', fenceLen);
        var pad = maxRun > 0 ? " " : string.Empty;
        return fence + pad + text + pad + fence;
    }

    private static int MaxConsecutiveBackticks(string text)
    {
        var max = 0;
        var cur = 0;
        foreach (var c in text)
        {
            if (c == '`') { cur++; max = System.Math.Max(max, cur); }
            else cur = 0;
        }
        return max;
    }

    /// <summary>
    /// Backslash-escapes markdown control characters. A newline becomes a hard break, so a reader
    /// that splits on physical lines still knows it was inside the block.
    /// </summary>
    private static string EscapeMarkdownText(string text)
    {
        if (text.Length == 0) return text;
        var normalized = text.Replace("\r\n", "\n", System.StringComparison.Ordinal).Replace('\r', '\n');
        var sb = new StringBuilder(normalized.Length + 8);
        var lineStart = true;
        for (var i = 0; i < normalized.Length; i++)
        {
            var c = normalized[i];
            if (c == '\n')
            {
                sb.Append(MarkdownHardBreak.Marker);
                lineStart = true;
                continue;
            }

            // What follows a break is folded onto the same line by the reader and then handed to a
            // document parser, so a character that opens a block at a line start is escaped there,
            // as is the dot or bracket of an ordered list marker.
            if (lineStart)
            {
                // Blanks do not end the line start: a reader trims them before it looks for a marker.
                if (c is ' ' or '\t')
                {
                    sb.Append(c);
                    continue;
                }

                lineStart = false;
                if (LineStartSpecials.Contains(c))
                {
                    sb.Append('\\').Append(c);
                    continue;
                }

                var marker = OrderedMarkerRegex.Match(normalized, i);
                if (marker.Success && marker.Index == i)
                {
                    sb.Append(marker.Value, 0, marker.Length - 1).Append('\\').Append(marker.Value[^1]);
                    i += marker.Length - 1;
                    continue;
                }
            }

            switch (c)
            {
                case '\\':
                case '*':
                case '_':
                case '~':
                case '`':
                case '[':
                case ']':
                    sb.Append('\\');
                    sb.Append(c);
                    break;
                default:
                    sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    /// <summary>
    /// Characters that open a block when they start a line: a heading, a bullet, a quote, a table
    /// row, an HTML block, a setext underline or a math fence.
    /// </summary>
    private static readonly HashSet<char> LineStartSpecials = ['#', '-', '+', '>', '|', '<', '=', '$'];

    /// <summary>An ordered list marker at a line start; the dot or bracket is what gets escaped.</summary>
    private static readonly Regex OrderedMarkerRegex = new(@"\G[0-9]{1,9}[.)]", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static string EscapeMarkdownTextPreservingEmbeddedImages(string text)
    {
        if (string.IsNullOrEmpty(text))
            return text;

        var matches = EmbeddedImageRegex.Matches(text);
        if (matches.Count == 0)
            return EscapeMarkdownText(text);

        var sb = new StringBuilder(text.Length + 16);
        var cursor = 0;
        foreach (Match match in matches)
        {
            if (match.Index > cursor)
                sb.Append(EscapeMarkdownText(text[cursor..match.Index]));
            sb.Append(match.Value);
            cursor = match.Index + match.Length;
        }

        if (cursor < text.Length)
            sb.Append(EscapeMarkdownText(text[cursor..]));
        return sb.ToString();
    }
}
