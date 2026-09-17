using System;

namespace Mnemo.Infrastructure.Services.Notes.Markdown;

/// <summary>
/// The markdown form of a newline inside one block, shared by the writer, the block reader and
/// the inline parser so the three cannot drift. The editor's <c>hard-break</c> module is the same
/// rule.
/// </summary>
/// <remarks>
/// A soft break is a literal newline in span text. Written bare, a reader that splits on physical
/// lines cannot tell it from the next block, so it goes out as the CommonMark hard break: a
/// backslash before the line ending. A literal backslash is escaped to two, which is why a line
/// ends in a break exactly when its trailing run of backslashes is odd.
/// </remarks>
public static class MarkdownHardBreak
{
    public const string Marker = "\\\n";

    /// <summary>True when a physical line (no line ending) ends in a hard break marker.</summary>
    public static bool EndsWithMarker(string line)
    {
        var run = 0;
        for (var i = line.Length - 1; i >= 0 && line[i] == '\\'; i--)
            run++;
        return run % 2 == 1;
    }

    /// <summary>Inline markdown folded onto one line, for a table cell or an image caption.</summary>
    public static string Collapse(string markdown) =>
        markdown.Replace(Marker, " ", StringComparison.Ordinal);

    /// <summary>
    /// Splits off the hard breaks a text ends with, which a CommonMark parser would read as literal
    /// backslashes because nothing follows them. The reader puts them back as the newlines they
    /// stand for once the rest has been parsed.
    /// </summary>
    public static string SplitTrailing(string text, out int breaks)
    {
        breaks = 0;
        while (text.EndsWith('\n') && EndsWithMarker(text[..^1]))
        {
            text = text[..^Marker.Length];
            breaks++;
        }

        return text;
    }
}
