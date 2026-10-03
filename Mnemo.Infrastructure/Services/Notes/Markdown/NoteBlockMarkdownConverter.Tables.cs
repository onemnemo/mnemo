using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes.Markdown;

public static partial class NoteBlockMarkdownConverter
{
    /// <summary>The editor's default column width; markdown carries none.</summary>
    private const double ImportedColumnWidth = 180;

    /// <summary>The most columns an imported table gets; the paste reader's limit is the same.</summary>
    internal const int MaxTableColumns = 64;

    /// <summary>The most cells (width times rows) an imported table gets, before it is read as plain lines.</summary>
    internal const int MaxTableCells = 10_000;

    /// <summary>One delimiter cell: dashes, with the colons that mark alignment, which are dropped.</summary>
    private static readonly Regex DelimiterCellPattern = new(@"^:?-+:?$", RegexOptions.Compiled);

    /// <summary>
    /// Reads the GFM pipe tables of one document: a header row holding a pipe, a delimiter row with
    /// as many cells, then body rows while lines keep holding a pipe and do not open another block.
    /// The outer pipes are optional. <see cref="Read"/> returns null, taking nothing, for anything
    /// else, so the lines are read one block each and no text is lost.
    /// </summary>
    /// <remarks>
    /// A body row wider than the header widens the table rather than dropping its extra cells, and
    /// a shorter one is padded. The first row is the header row, as the writer marks it. A table
    /// past <see cref="MaxTableColumns"/> or <see cref="MaxTableCells"/> is not built at all, since
    /// one wide row would pad every other, and its whole span stays plain lines: any later line of
    /// it would otherwise be read again as the start of a table, which is quadratic.
    /// </remarks>
    private sealed class PipeTableReader(string[] lines)
    {
        private int _plainUntil;

        public Block? Read(int index, out int next)
        {
            next = index;
            if (index < _plainUntil || index + 1 >= lines.Length
                || !HasCellPipe(lines[index]) || !HasCellPipe(lines[index + 1]))
                return null;

            var delimiterCells = SplitPipeRow(lines[index + 1].Trim());
            if (!delimiterCells.All(c => DelimiterCellPattern.IsMatch(c)))
                return null;
            var headerCells = SplitPipeRow(lines[index].Trim());
            if (headerCells.Count != delimiterCells.Count)
                return null;

            var end = index + 2;
            while (end < lines.Length && lines[end].Trim().Length > 0 && HasCellPipe(lines[end]) && !OpensBlockAfterTable(lines[end]))
                end++;

            var rowCount = end - index - 1;
            var rows = new List<List<string>>(Math.Min(rowCount, MaxTableCells)) { headerCells };
            var width = headerCells.Count;
            for (var j = index + 2; j < end && Fits(width, rowCount); j++)
            {
                var cells = SplitPipeRow(lines[j].Trim());
                width = Math.Max(width, cells.Count);
                rows.Add(cells);
            }

            if (!Fits(width, rowCount))
            {
                _plainUntil = end;
                return null;
            }

            next = end;
            return CreateTable(rows);
        }

        private static bool Fits(int width, int rowCount) =>
            width <= MaxTableColumns && (long)width * rowCount <= MaxTableCells;
    }

    /// <summary>A heading, list item, quote or code fence ends a table, as it ends a paragraph, even when it holds a pipe.</summary>
    private static bool OpensBlockAfterTable(string line)
    {
        var trimmed = line.TrimStart();
        return CodeFenceOf(trimmed) is not null
            || trimmed.StartsWith('>')
            || HeadingStartPattern.IsMatch(trimmed)
            || NumberedPattern.IsMatch(trimmed)
            || trimmed.StartsWith("- ", StringComparison.Ordinal)
            || ChecklistPattern.IsMatch(trimmed)
            || StarOrPlusBulletPattern.IsMatch(trimmed);
    }

    /// <summary>Whether the line holds a pipe no backslash escapes.</summary>
    private static bool HasCellPipe(string line)
    {
        for (var k = 0; k < line.Length; k++)
        {
            if (line[k] == '\\')
                k++;
            else if (line[k] == '|')
                return true;
        }

        return false;
    }

    /// <summary>
    /// The cells of one trimmed pipe row. A backslash escapes the character after it, so only an
    /// unescaped pipe ends a cell. The escapes stay for the inline parser, which reads an escaped
    /// pipe as a literal one rather than as another table.
    /// </summary>
    private static List<string> SplitPipeRow(string row)
    {
        var cells = new List<string>();
        var current = new StringBuilder();
        var endsWithSeparator = false;
        for (var k = 0; k < row.Length; k++)
        {
            var ch = row[k];
            endsWithSeparator = false;
            if (ch == '\\' && k + 1 < row.Length)
            {
                current.Append(ch).Append(row[k + 1]);
                k++;
            }
            else if (ch == '|')
            {
                cells.Add(current.ToString().Trim());
                current.Clear();
                endsWithSeparator = true;
            }
            else
            {
                current.Append(ch);
            }
        }

        if (!endsWithSeparator)
            cells.Add(current.ToString().Trim());
        if (row.StartsWith('|') && cells.Count > 0)
            cells.RemoveAt(0);
        return cells.Select(UnescapeCodePipes).ToList();
    }

    /// <summary>A pipe and the run of backslashes before it.</summary>
    private static readonly Regex EscapedPipePattern = new(@"(\\+)\|", RegexOptions.Compiled);

    /// <summary>
    /// A cell's escaped pipes inside code spans made literal. GFM unescapes them in the whole cell
    /// before inline parsing; outside code the inline parser does that itself, but a code span
    /// keeps its backslashes, so a copied <c>c|d</c> would read back as <c>c\|d</c>.
    /// </summary>
    private static string UnescapeCodePipes(string cell)
    {
        var sb = new StringBuilder(cell.Length);
        var k = 0;
        while (k < cell.Length)
        {
            if (cell[k] == '\\')
            {
                sb.Append(cell, k, Math.Min(2, cell.Length - k));
                k += 2;
                continue;
            }

            if (cell[k] != '`')
            {
                sb.Append(cell[k]);
                k++;
                continue;
            }

            var end = k;
            while (end < cell.Length && cell[end] == '`')
                end++;
            var ticks = end - k;
            var close = ClosingTicks(cell, ticks, end);
            if (close < 0)
            {
                sb.Append('`', ticks);
                k = end;
                continue;
            }

            var code = EscapedPipePattern.Replace(
                cell[end..close],
                m => m.Groups[1].Length % 2 == 1 ? m.Groups[1].Value[1..] + "|" : m.Value);
            sb.Append('`', ticks).Append(code).Append('`', ticks);
            k = close + ticks;
        }

        return sb.ToString();
    }

    /// <summary>Where a run of exactly <paramref name="length"/> backticks starts at or after <paramref name="from"/>, or -1.</summary>
    private static int ClosingTicks(string text, int length, int from)
    {
        var k = from;
        while (k < text.Length)
        {
            if (text[k] != '`')
            {
                k++;
                continue;
            }

            var end = k;
            while (end < text.Length && text[end] == '`')
                end++;
            if (end - k == length)
                return k;
            k = end;
        }

        return -1;
    }

    private static Block CreateTable(List<List<string>> rows)
    {
        var width = rows.Max(r => r.Count);
        var table = new Block
        {
            Type = BlockType.Table,
            Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) },
            Payload = new TablePayload(
                Enumerable.Repeat(ImportedColumnWidth, width).ToList(),
                rows.Select((_, r) => r == 0).ToList(),
                Enumerable.Repeat(false, width).ToList()),
            Children = new List<Block>()
        };

        foreach (var cells in rows)
        {
            var row = new Block
            {
                Type = BlockType.TableRow,
                Order = table.Children.Count,
                Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) },
                Payload = new EmptyPayload(),
                Children = new List<Block>()
            };
            for (var c = 0; c < width; c++)
            {
                row.Children.Add(new Block
                {
                    Type = BlockType.TableCell,
                    Order = c,
                    Spans = InlineMarkdownParser.ToSpans(c < cells.Count ? cells[c] : string.Empty),
                    Payload = new TableCellPayload()
                });
            }

            table.Children.Add(row);
        }

        return table;
    }
}
