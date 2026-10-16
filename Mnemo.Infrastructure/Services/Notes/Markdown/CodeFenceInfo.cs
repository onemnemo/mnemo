using System.Text.RegularExpressions;

namespace Mnemo.Infrastructure.Services.Notes.Markdown;

/// <summary>
/// A code block caption in markdown, written as <c>caption="..."</c> at the end of the fence info.
/// Other readers take the first word as the language and ignore the rest.
/// </summary>
/// <remarks>Backslash, quote and backtick are escaped. A line break is written as a space.</remarks>
public static partial class CodeFenceInfo
{
    [GeneratedRegex("^(.*?)(?:^|\\s)caption=\"((?:[^\"\\\\]|\\\\.)*)\"$")]
    private static partial Regex TrailingCaption();

    [GeneratedRegex("\\\\(\\\\|\"|u0060)")]
    private static partial Regex Escapes();

    [GeneratedRegex("[\\r\\n]+")]
    private static partial Regex LineBreaks();

    public static string Format(string language, string caption)
    {
        var head = language.Trim();
        var text = LineBreaks().Replace(caption, " ").Trim();
        if (text.Length == 0)
            return head;
        var escaped = text.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("\"", "\\\"", StringComparison.Ordinal)
            .Replace("`", "\\u0060", StringComparison.Ordinal);
        return $"{head}{(head.Length == 0 ? string.Empty : " ")}caption=\"{escaped}\"";
    }

    /// <summary>The info string split into what precedes the caption and the caption itself.</summary>
    public static (string Head, string Caption) Parse(string info)
    {
        var trimmed = info.Trim();
        var match = TrailingCaption().Match(trimmed);
        if (!match.Success)
            return (trimmed, string.Empty);
        var caption = Escapes().Replace(match.Groups[2].Value, m => m.Groups[1].Value == "u0060" ? "`" : m.Groups[1].Value);
        return (match.Groups[1].Value.Trim(), caption);
    }
}
