using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes.Markdown;

public static partial class NoteBlockMarkdownConverter
{
    /// <summary>
    /// An empty paragraph. A blank line only separates blocks, so an empty Text block needs a
    /// visible body; CommonMark readers render this one as an empty paragraph too.
    /// </summary>
    internal const string EmptyParagraph = "&nbsp;";

    private static readonly Regex PageRefPattern = new(@"^\[\[page:([^\]]*)\]\]\s*$", RegexOptions.Compiled);
    private static readonly Regex ImageRefPattern = new(@"^!\[([^\]]*)\]\(([^)]*)\)\s*$", RegexOptions.Compiled);
    private static readonly Regex ChecklistPattern = new(@"^-\s*\[\s*[xX]?\s*\]", RegexOptions.Compiled);
    private static readonly Regex StarOrPlusBulletPattern = new(@"^(\*|\+)\s+(.*)$", RegexOptions.Compiled);
    private static readonly Regex NumberedPattern = new(@"^[0-9]{1,9}[.)]\s", RegexOptions.Compiled);

    /// <summary>A numbered item that may interrupt a paragraph: CommonMark only lets a list starting at one.</summary>
    private static readonly Regex InterruptingNumberedPattern = new(@"^0{0,8}1[.)]\s", RegexOptions.Compiled);

    private static readonly Regex ThematicBreakPattern = new(@"^([-*_])(\s*\1){2,}\s*$", RegexOptions.Compiled);
    private static readonly Regex SetextH1UnderlinePattern = new(@"^=+$", RegexOptions.Compiled);

    private static readonly Regex HeadingStartPattern = new(@"^#{1,6}(\s|$)", RegexOptions.Compiled);

    /// <summary>The HTML block starts CommonMark lets interrupt a paragraph; an inline tag does not.</summary>
    private const string HtmlBlockStart =
        @"<(?:(?:script|pre|style|textarea)\b|!--|\?|![A-Za-z]|!\[CDATA\[|/?(?:address|article|aside|blockquote|body|center|details|dialog|dir|div|dl|dd|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|html|iframe|legend|li|main|menu|nav|ol|p|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)(?:\s|/?>|$))";

    private static readonly Regex HtmlBlockStartPattern = new("^" + HtmlBlockStart, RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>
    /// A trimmed line Markdig would start a block with, were it handed to it at a line start: a
    /// heading, a setext underline, a rule, a list item, a quote, a fence, an HTML block, a math
    /// block, a definition, a footnote, an abbreviation, a custom container or a figure.
    /// </summary>
    private static readonly Regex MarkdigBlockStartPattern = new(
        @"^(#{1,6}(\s|$)|=+\s*$|-+\s*$|([-*_])(\s*\3){2,}\s*$|[-+*](\s|$)|[0-9]{1,9}[.)](\s|$)|>|```|~~~|\$\$|[:~]\s|\[\^|\*\[|:::|\^\^|" + HtmlBlockStart + ")",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static bool IsListItem(BlockType type) =>
        type is BlockType.BulletList or BlockType.NumberedList or BlockType.Checklist;

    /// <summary>
    /// Blocks in reading order, joined the CommonMark way: a blank line between blocks, and a
    /// single newline only between list items, which keeps a list tight. Columns flatten into
    /// the run, since markdown has no column syntax.
    /// </summary>
    private static string JoinBlocks(IEnumerable<Block> blocks)
    {
        var sb = new StringBuilder();
        Block? previous = null;
        var run = new ListRun();
        foreach (var block in Flatten(blocks))
        {
            var text = SerializeBlock(block, run.Next(block));
            if (text.Length == 0)
                continue;
            if (previous is not null)
            {
                sb.AppendLine();
                if (!(IsListItem(previous.Type) && IsListItem(block.Type)))
                    sb.AppendLine();
            }

            sb.Append(text);
            previous = block;
        }

        return sb.ToString();
    }

    /// <summary>
    /// The editor's numbering: a run of numbered items counts from 1, and any other block ends it.
    /// </summary>
    private sealed class ListRun
    {
        private int _count;

        /// <summary>The number <paramref name="block"/> shows, 1 for anything not numbered.</summary>
        public int Next(Block block)
        {
            _count = block.Type == BlockType.NumberedList ? _count + 1 : 0;
            return System.Math.Max(_count, 1);
        }
    }

    /// <summary>
    /// Column rows replaced by their cells' blocks, left column first. A cell is a ColumnGroup;
    /// older or malformed data may hold a block directly in the cell slot, which stands for itself.
    /// </summary>
    private static IEnumerable<Block> Flatten(IEnumerable<Block> blocks)
    {
        foreach (var block in blocks.OrderBy(b => b.Order))
        {
            if (block.Type is BlockType.TwoColumn or BlockType.ColumnGroup)
            {
                foreach (var inner in Flatten(block.Children ?? []))
                    yield return inner;
            }
            else
            {
                yield return block;
            }
        }
    }

    /// <summary>
    /// Whether the document has a blank line between two of its lines, outside a fence. Mnemo
    /// used to write one block per line with no blank line between them, and a file in that
    /// shape is read line by line so its paragraphs stay apart.
    /// </summary>
    private static bool SeparatesBlocksWithBlankLines(string[] lines)
    {
        var seenContent = false;
        var pendingBlank = false;
        for (var j = 0; j < lines.Length; j++)
        {
            var bare = lines[j].Trim();
            if (bare.Length == 0)
            {
                pendingBlank = seenContent;
                continue;
            }

            if (pendingBlank)
                return true;
            seenContent = true;

            var fence = CodeFenceOf(lines[j].TrimStart());
            if (fence is not null)
                j = SkipFence(lines, j, l => ClosesFence(l, fence));
            else if (bare == "$$" && HasFenceClose(lines, j + 1))
                j = SkipFence(lines, j, l => l.Trim() == "$$");
        }

        return false;
    }

    /// <summary>The run of three or more backticks or tildes a trimmed line opens a code block with, or null.</summary>
    private static string? CodeFenceOf(string trimmed)
    {
        if (trimmed.Length < 3 || trimmed[0] is not ('`' or '~'))
            return null;
        var run = 0;
        while (run < trimmed.Length && trimmed[run] == trimmed[0])
            run++;
        return run >= 3 ? trimmed[..run] : null;
    }

    /// <summary>True when the line closes the fence: the same character, at least as many, and nothing after.</summary>
    private static bool ClosesFence(string line, string fence)
    {
        var bare = line.Trim();
        return bare.Length >= fence.Length && bare.All(c => c == fence[0]);
    }

    /// <summary>The index of the line that closes the fence opened at <paramref name="open"/>.</summary>
    private static int SkipFence(string[] lines, int open, Func<string, bool> closes)
    {
        for (var j = open + 1; j < lines.Length; j++)
            if (closes(lines[j])) return j;
        return lines.Length;
    }

    /// <summary>
    /// True when the line opens a block of its own rather than continuing a paragraph. After prose
    /// only an item numbered one opens a list, so a wrapped line that starts with a year stays in
    /// its sentence; <paramref name="anyNumberOpens"/> is set for a numbered item's own siblings.
    /// </summary>
    private static bool OpensBlock(string[] lines, int index, bool anyNumberOpens) =>
        OpensBlock(lines[index], () => HasFenceClose(lines, index + 1), anyNumberOpens);

    private static bool OpensBlock(string line, Func<bool> mathFenceCloses, bool anyNumberOpens)
    {
        var trimmed = line.TrimStart();
        var bare = line.Trim();
        if (bare.Length == 0)
            return true;
        if (CodeFenceOf(trimmed) is not null || trimmed.StartsWith('>') || trimmed.StartsWith('|'))
            return true;
        if (trimmed.StartsWith(":::", StringComparison.Ordinal) || trimmed.StartsWith("^^^", StringComparison.Ordinal))
            return true;
        if ((bare == "$$" && mathFenceCloses()) || (bare.StartsWith("$$", StringComparison.Ordinal) && bare.EndsWith("$$", StringComparison.Ordinal) && bare.Length > 2))
            return true;
        if (SetextH1UnderlinePattern.IsMatch(bare) || bare.Trim('-').Length == 0 || ThematicBreakPattern.IsMatch(bare))
            return true;
        if (NumberedPattern.IsMatch(trimmed))
            return anyNumberOpens || InterruptingNumberedPattern.IsMatch(trimmed);
        return trimmed.StartsWith("- ", StringComparison.Ordinal)
            || HeadingStartPattern.IsMatch(trimmed)
            || ChecklistPattern.IsMatch(trimmed)
            || StarOrPlusBulletPattern.IsMatch(trimmed)
            || HtmlBlockStartPattern.IsMatch(trimmed)
            || PageRefPattern.IsMatch(trimmed)
            || ImageRefPattern.IsMatch(trimmed);
    }

    /// <summary>
    /// A line folded into the block above it behind a hard break, escaped where Markdig would
    /// otherwise start a new block there and drop or reinterpret the text. The writer escapes
    /// these itself, so only hand-written markdown ever needs it.
    /// </summary>
    private static string EscapeBlockStart(string line)
    {
        var trimmed = line.TrimStart();
        if (!MarkdigBlockStartPattern.IsMatch(trimmed))
            return line;

        var lead = line[..(line.Length - trimmed.Length)];
        var digits = 0;
        while (digits < trimmed.Length && char.IsAsciiDigit(trimmed[digits]))
            digits++;
        return digits > 0
            ? lead + trimmed[..digits] + "\\" + trimmed[digits..]
            : lead + "\\" + trimmed;
    }

    /// <summary>
    /// A paragraph's next physical line folded onto it. A plain line ending is a CommonMark soft
    /// break, which renders as a space; two trailing spaces are the other hard break form.
    /// </summary>
    private static string JoinSoftBreak(string text, string next)
    {
        var sb = new StringBuilder(text);
        AppendSoftBreak(sb, next);
        return sb.ToString();
    }

    /// <summary><see cref="JoinSoftBreak"/> in place, so a long paragraph is built once.</summary>
    private static void AppendSoftBreak(StringBuilder sb, string next)
    {
        var hard = sb.Length >= 2 && sb[^1] == ' ' && sb[^2] == ' ';
        var end = sb.Length;
        while (end > 0 && sb[end - 1] is ' ' or '\t')
            end--;
        sb.Length = end;

        next = next.TrimStart();
        if (hard)
            sb.Append(MarkdownHardBreak.Marker).Append(EscapeBlockStart(next));
        else
            sb.Append(' ').Append(next);
    }

    /// <summary>True when the text built so far ends in a hard break marker, read as the string form is.</summary>
    private static bool EndsWithMarker(StringBuilder sb)
    {
        var run = 0;
        for (var k = sb.Length - 1; k >= 0 && sb[k] == '\\'; k--)
            run++;
        return run % 2 == 1;
    }

    /// <summary>
    /// The lines of a quote or callout joined into its text. Two lines of prose join the
    /// CommonMark way, as a soft break; anything else (a hard break, an empty line, a list item, a
    /// heading, a callout's title line) keeps its line break and is left to the parser.
    /// </summary>
    private static string JoinQuoteLines(List<string> quoteLines, bool softBreaks, bool keepFirstLineApart)
    {
        var text = new StringBuilder(quoteLines[0]);
        for (var k = 1; k < quoteLines.Count; k++)
        {
            var previous = quoteLines[k - 1];
            var line = quoteLines[k];
            var afterBreak = EndsWithMarker(text);
            var soft = softBreaks
                && !(keepFirstLineApart && k == 1)
                && !afterBreak
                && !OpensBlock(previous, () => true, anyNumberOpens: true)
                && !OpensBlock(line, () => true, anyNumberOpens: false)
                && InlineMarkdownParser.ReadsAsOneParagraph(JoinSoftBreak(previous, line));
            if (soft)
                AppendSoftBreak(text, line);
            else
                text.Append('\n').Append(afterBreak ? EscapeBlockStart(line) : line);
        }

        return text.ToString();
    }
}
