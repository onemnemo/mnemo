using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes.Markdown;

/// <summary>
/// Block-model markdown conversion aligned with <c>BlockMarkdownSerializer</c> in the UI (paste semantics).
/// </summary>
public static class NoteBlockMarkdownConverter
{
    public static string Serialize(IReadOnlyList<Block> blocks)
    {
        var ordered = blocks.OrderBy(b => b.Order).ToList();
        var sb = new System.Text.StringBuilder();
        for (var i = 0; i < ordered.Count; i++)
        {
            var b = ordered[i];
            if (i > 0 && b.Type is not BlockType.Code and not BlockType.Equation and not BlockType.Sketch)
                sb.AppendLine();
            sb.Append(SerializeBlock(b));
            if (b.Type is BlockType.Code or BlockType.Equation or BlockType.Sketch)
                sb.AppendLine();
        }

        return sb.ToString().TrimEnd();
    }

    public static string SerializeBlock(Block block)
    {
        block.EnsureSpans();
        var body = block.Type is BlockType.Code or BlockType.Divider or BlockType.Equation or BlockType.Sketch
            ? block.Content
            : InlineMarkdownSerializer.SerializeSpans(block.Spans);
        var listNum = GetListNumber(block);
        var isChecked = GetChecklistChecked(block);
        return block.Type switch
        {
            BlockType.Page => block.Payload is PagePayload pp
                ? "[[" + "page:" + pp.ReferenceNoteId + "]]"
                : "[[page:]]",
            BlockType.Text => body,
            BlockType.Heading1 => $"# {body}",
            BlockType.Heading2 => $"## {body}",
            BlockType.Heading3 => $"### {body}",
            BlockType.Heading4 => $"#### {body}",
            BlockType.BulletList => $"- {body}",
            BlockType.NumberedList => $"{listNum}. {body}",
            BlockType.Checklist => isChecked ? $"- [x] {body}" : $"- [ ] {body}",
            BlockType.Quote => "> " + body.Replace("\n", "\n> ", StringComparison.Ordinal),
            BlockType.Callout => SerializeCallout(block, body),
            BlockType.Code => SerializeCodeFence(block),
            BlockType.Sketch => SerializeSketchFence(block),
            BlockType.Divider => "---",
            BlockType.Equation => "$$\n" + GetEquationLatex(block) + "\n$$",
            BlockType.TwoColumn => SerializeColumns(block),
            BlockType.ColumnGroup => SerializeColumnGroup(block),
            BlockType.Table => SerializeTable(block),
            _ => body
        };
    }

    /// <summary>
    /// A table as a GitHub-flavoured pipe table.
    /// </summary>
    /// <remarks>
    /// The format has one header row and nothing else, so a table with no header row still gets the
    /// delimiter under its first row: the alternative is markdown no reader will parse as a table at
    /// all, which loses the structure rather than a display flag. Cell fills, widths and the header
    /// column have no representation here and do not survive the trip.
    /// </remarks>
    private static string SerializeTable(Block table)
    {
        if (table.Children is not { Count: > 0 } rows)
            return string.Empty;

        var ordered = rows.OrderBy(r => r.Order).ToList();
        var width = ordered.Max(r => r.Children?.Count ?? 0);
        if (width == 0)
            return string.Empty;

        var sb = new System.Text.StringBuilder();
        for (var i = 0; i < ordered.Count; i++)
        {
            sb.Append(SerializeTableRow(ordered[i], width));
            sb.Append('\n');
            if (i == 0)
                sb.Append("| ").Append(string.Join(" | ", Enumerable.Repeat("---", width))).Append(" |\n");
        }

        return sb.ToString().TrimEnd('\n');
    }

    private static string SerializeTableRow(Block row, int width)
    {
        var cells = (row.Children ?? []).OrderBy(c => c.Order).ToList();
        var texts = new List<string>(width);
        for (var i = 0; i < width; i++)
        {
            var cell = i < cells.Count ? cells[i] : null;
            var text = cell == null ? string.Empty : InlineMarkdownSerializer.SerializeSpans(cell.Spans);
            // A pipe would end the cell, and a newline would end the table.
            texts.Add(text.Replace("|", "\\|", StringComparison.Ordinal)
                          .Replace("\n", " ", StringComparison.Ordinal)
                          .Trim());
        }

        return "| " + string.Join(" | ", texts) + " |";
    }

    /// <summary>The "&gt; [!tone glyph]" head that distinguishes a callout from a plain quote.</summary>
    private static readonly Regex CalloutHeadPattern = new(@"^>\s*\[!([A-Za-z]+)(?:\s+([^\]]+))?\]\s?(.*)$");

    /// <summary>True when the line opens a new callout, which ends whatever quoted run precedes it.</summary>
    private static bool StartsCallout(string trimmed) => CalloutHeadPattern.IsMatch(trimmed);

    public static List<Block> Deserialize(string markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown))
            return [];

        var lines = markdown.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.None);
        var result = new List<Block>();
        var order = 0;
        var i = 0;

        while (i < lines.Length)
        {
            var line = lines[i];
            var trimmed = line.TrimStart();

            if (trimmed == "---" || line.Trim() == "---")
            {
                result.Add(CreateDivider(order++));
                i++;
                continue;
            }

            if (trimmed == "$$" || (trimmed.StartsWith("$$") && trimmed.EndsWith("$$") && trimmed.Length > 2))
            {
                if (trimmed == "$$")
                {
                    var eqContent = new System.Text.StringBuilder();
                    i++;
                    while (i < lines.Length)
                    {
                        if (lines[i].TrimStart() == "$$") { i++; break; }
                        if (eqContent.Length > 0) eqContent.AppendLine();
                        eqContent.Append(lines[i]);
                        i++;
                    }
                    var eqBlock = new Block
                    {
                        Id = Guid.NewGuid().ToString(),
                        Type = BlockType.Equation,
                        Order = order++
                    };
                    var latex = eqContent.ToString().Trim();
                    eqBlock.Payload = new EquationPayload(latex);
                    eqBlock.Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };
                    result.Add(eqBlock);
                }
                else
                {
                    var inner = trimmed[2..^2].Trim();
                    var eqBlock = new Block
                    {
                        Id = Guid.NewGuid().ToString(),
                        Type = BlockType.Equation,
                        Order = order++
                    };
                    eqBlock.Payload = new EquationPayload(inner);
                    eqBlock.Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };
                    result.Add(eqBlock);
                    i++;
                }
                continue;
            }

            if (trimmed.StartsWith("```", StringComparison.Ordinal))
            {
                var fenceLang = trimmed.Length > 3 ? trimmed[3..].Trim() : string.Empty;
                var isSketch = string.Equals(fenceLang, "sketch", StringComparison.OrdinalIgnoreCase);
                var language = string.IsNullOrEmpty(fenceLang) ? "csharp" : fenceLang;
                var codeContent = new System.Text.StringBuilder();
                i++;
                while (i < lines.Length)
                {
                    var codeLine = lines[i];
                    if (codeLine.TrimStart().StartsWith("```", StringComparison.Ordinal))
                    {
                        i++;
                        break;
                    }

                    if (codeContent.Length > 0) codeContent.AppendLine();
                    codeContent.Append(codeLine);
                    i++;
                }

                var source = codeContent.ToString();
                var codeBlock = new Block
                {
                    Id = Guid.NewGuid().ToString(),
                    Type = isSketch ? BlockType.Sketch : BlockType.Code,
                    Order = order++,
                    Spans = new List<InlineSpan> { new TextSpan(source, TextStyle.Default) },
                    Payload = isSketch ? new EmptyPayload() : new CodePayload(language, source),
                    Meta = new Dictionary<string, object>()
                };
                result.Add(codeBlock);
                continue;
            }

            var pageRef = Regex.Match(trimmed, @"^\[\[page:([^\]]*)\]\]\s*$");
            if (pageRef.Success)
            {
                var refId = pageRef.Groups[1].Value.Trim();
                var pageBlock = new Block
                {
                    Id = Guid.NewGuid().ToString(),
                    Type = BlockType.Page,
                    Order = order++,
                    Payload = new PagePayload(refId),
                    Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) }
                };
                result.Add(pageBlock);
                i++;
                continue;
            }

            if (trimmed.StartsWith("#### ", StringComparison.Ordinal))
            {
                result.Add(CreateRichBlock(BlockType.Heading4, trimmed["#### ".Length..].Trim(), order++));
                i++;
                continue;
            }

            if (trimmed.StartsWith("### ", StringComparison.Ordinal))
            {
                result.Add(CreateRichBlock(BlockType.Heading3, trimmed["### ".Length..].Trim(), order++));
                i++;
                continue;
            }

            if (trimmed.StartsWith("## ", StringComparison.Ordinal))
            {
                result.Add(CreateRichBlock(BlockType.Heading2, trimmed["## ".Length..].Trim(), order++));
                i++;
                continue;
            }

            if (trimmed.StartsWith("# ", StringComparison.Ordinal))
            {
                result.Add(CreateRichBlock(BlockType.Heading1, trimmed["# ".Length..].Trim(), order++));
                i++;
                continue;
            }

            if (Regex.IsMatch(trimmed, @"^-\s*\[\s*[xX]\s*\]"))
            {
                var content = Regex.Replace(trimmed, @"^-\s*\[\s*[xX]\s*\]\s*", "", RegexOptions.None).Trim();
                var b = CreateRichBlock(BlockType.Checklist, content, order++);
                b.Payload = new ChecklistPayload(true);
                result.Add(b);
                i++;
                continue;
            }

            if (Regex.IsMatch(trimmed, @"^-\s*\[\s*\]"))
            {
                var content = Regex.Replace(trimmed, @"^-\s*\[\s*\]\s*", "", RegexOptions.None).Trim();
                var b = CreateRichBlock(BlockType.Checklist, content, order++);
                b.Payload = new ChecklistPayload(false);
                result.Add(b);
                i++;
                continue;
            }

            if (trimmed.StartsWith("- ", StringComparison.Ordinal))
            {
                result.Add(CreateRichBlock(BlockType.BulletList, trimmed["- ".Length..].Trim(), order++));
                i++;
                continue;
            }

            var starOrPlusBullet = Regex.Match(trimmed, @"^(\*|\+)\s+(.*)$");
            if (starOrPlusBullet.Success)
            {
                result.Add(CreateRichBlock(BlockType.BulletList, starOrPlusBullet.Groups[2].Value.Trim(), order++));
                i++;
                continue;
            }

            // Probed ahead of the quote branch: a callout is a quote line whose first token is the
            // "[!tone emoji]" head, so quote would otherwise swallow it.
            var calloutHead = CalloutHeadPattern.Match(trimmed);
            if (calloutHead.Success)
            {
                var calloutLines = new List<string> { calloutHead.Groups[3].Value.Trim() };
                i++;
                while (i < lines.Length)
                {
                    var nextTrimmed = lines[i].TrimStart();
                    // A second head starts its own callout; without this the run below
                    // absorbs it and two callouts come back as one.
                    if (StartsCallout(nextTrimmed))
                        break;
                    if (nextTrimmed.StartsWith("> ", StringComparison.Ordinal))
                    {
                        calloutLines.Add(nextTrimmed["> ".Length..].Trim());
                        i++;
                    }
                    else if (nextTrimmed == ">")
                    {
                        calloutLines.Add(string.Empty);
                        i++;
                    }
                    else
                    {
                        break;
                    }
                }

                var callout = CreateRichBlock(BlockType.Callout, string.Join("\n", calloutLines), order++);
                callout.Payload = new CalloutPayload(
                    calloutHead.Groups[2].Value.Trim(),
                    calloutHead.Groups[1].Value.Trim().ToLowerInvariant());
                result.Add(callout);
                continue;
            }

            if (trimmed.StartsWith("> ", StringComparison.Ordinal) || trimmed == ">")
            {
                var firstLine = trimmed == ">" ? string.Empty : trimmed["> ".Length..].Trim();
                var quoteLines = new List<string> { firstLine };
                i++;
                while (i < lines.Length)
                {
                    var nextTrimmed = lines[i].TrimStart();
                    // Same reason as above: a callout head following a quote is a new
                    // block, not another line of the quotation.
                    if (StartsCallout(nextTrimmed))
                        break;
                    if (nextTrimmed.StartsWith("> ", StringComparison.Ordinal))
                    {
                        quoteLines.Add(nextTrimmed["> ".Length..].Trim());
                        i++;
                    }
                    else if (nextTrimmed == ">")
                    {
                        quoteLines.Add(string.Empty);
                        i++;
                    }
                    else
                    {
                        break;
                    }
                }

                result.Add(CreateRichBlock(BlockType.Quote, string.Join("\n", quoteLines), order++));
                continue;
            }

            if (Regex.IsMatch(trimmed, @"^\d+\.\s"))
            {
                var content = Regex.Replace(trimmed, @"^\d+\.\s*", "", RegexOptions.None).Trim();
                var m = Regex.Match(trimmed, @"^(\d+)\.\s");
                var n = m.Success && int.TryParse(m.Groups[1].Value, out var num) ? num : 1;
                var nb = CreateRichBlock(BlockType.NumberedList, content, order++);
                // Written under the canonical key the editor and PDF composer read. The legacy
                // "listNumber" key nothing else looks at is never emitted again, so a numbered
                // list imported from markdown keeps its start value instead of silently
                // renumbering from 1 the moment it opens.
                nb.Meta["listNumberIndex"] = n;
                result.Add(nb);
                i++;
                continue;
            }

            result.Add(CreateRichBlock(BlockType.Text, line, order++));
            i++;
        }

        return result;
    }

    private static Block CreateDivider(int order) =>
        new() { Id = Guid.NewGuid().ToString(), Type = BlockType.Divider, Order = order };

    private static Block CreateRichBlock(BlockType type, string content, int order)
    {
        var b = new Block
        {
            Id = Guid.NewGuid().ToString(),
            Type = type,
            Order = order
        };
        if (type == BlockType.Divider)
            return b;
        b.Spans = InlineMarkdownParser.ToSpans(content ?? string.Empty);
        if (type is BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4)
            EnsureHeadingBold(b);
        return b;
    }

    private static void EnsureHeadingBold(Block b)
    {
        b.EnsureSpans();
        var list = new List<InlineSpan>();
        foreach (var s in b.Spans)
        {
            if (s is TextSpan t)
                list.Add(t with { Style = t.Style.WithSet(InlineFormatKind.Bold) });
            else
                list.Add(s);
        }

        b.Spans = InlineSpanFormatApplier.Normalize(list);
    }

    private static int GetListNumber(Block block)
    {
        // listNumberIndex is the key the editor and PDF composer read; listNumber is the legacy
        // key markdown used to write. Read either, preferring the canonical one, defaulting to 1.
        return ReadMetaInt(block, "listNumberIndex") ?? ReadMetaInt(block, "listNumber") ?? 1;
    }

    private static int? ReadMetaInt(Block block, string key)
    {
        if (!block.Meta.TryGetValue(key, out var v) || v is null)
            return null;
        return v switch
        {
            int i => i,
            long l => (int)l,
            JsonElement je when je.TryGetInt32(out var n) => n,
            string s when int.TryParse(s, out var n) => n,
            _ => null
        };
    }

    private static bool GetChecklistChecked(Block block)
    {
        if (block.Payload is ChecklistPayload cp)
            return cp.Checked;
        if (!block.Meta.TryGetValue("checked", out var v))
            return false;
        return v switch
        {
            bool b => b,
            JsonElement je when je.ValueKind is JsonValueKind.True => true,
            JsonElement je when je.ValueKind is JsonValueKind.False => false,
            _ => false
        };
    }

    private static string SerializeCodeFence(Block block)
    {
        string source;
        string lang;
        if (block.Payload is CodePayload cp)
        {
            lang = (cp.Language ?? string.Empty).Trim();
            source = cp.Source ?? string.Empty;
        }
        else
        {
            lang = string.Empty;
            source = block.Content ?? string.Empty;
        }

        return string.IsNullOrEmpty(lang)
            ? "```\n" + source + "\n```"
            : "```" + lang + "\n" + source + "\n```";
    }

    /// <summary>
    /// Flattens a two-column row to its cells' blocks in reading order (left column, then right).
    /// Markdown has no column syntax, so this matches the editor's own markdown flattening. It
    /// deliberately emits no "---" between the columns: that separator reads back as a
    /// <see cref="BlockType.Divider"/>, which both corrupts the round trip and is beside the point,
    /// since the old code serialized only the empty cell lines and lost every block inside them.
    /// The <c>.mnemo</c> package is the format that preserves column structure.
    /// </summary>
    private static string SerializeColumns(Block twoColumn)
    {
        if (twoColumn.Children is not { Count: > 0 } columns)
            return string.Empty;

        var parts = new List<string>();
        foreach (var column in columns)
        {
            var content = SerializeColumnGroup(column);
            if (!string.IsNullOrEmpty(content))
                parts.Add(content);
        }

        // One newline between cells, matching how the top-level serializer separates blocks: this
        // converter is line-oriented, so a blank line would deserialize into a stray empty block.
        return string.Join("\n", parts);
    }

    private static string SerializeColumnGroup(Block group)
    {
        // A cell is a ColumnGroup whose children are the real blocks. Older or malformed data may
        // hold a block directly in the cell slot, so fall back to serializing that block.
        var children = group.Type == BlockType.ColumnGroup ? group.Children : null;
        if (children is not { Count: > 0 })
            return group.Type == BlockType.ColumnGroup ? string.Empty : SerializeBlock(group);

        var sb = new System.Text.StringBuilder();
        var ordered = children.OrderBy(c => c.Order).ToList();
        for (var i = 0; i < ordered.Count; i++)
        {
            if (i > 0)
                sb.Append('\n');
            sb.Append(SerializeBlock(ordered[i]));
        }

        return sb.ToString();
    }

    private static string SerializeCallout(Block block, string body)
    {
        var payload = block.Payload as CalloutPayload;
        var tone = string.IsNullOrWhiteSpace(payload?.Tone) ? "note" : payload!.Tone.Trim();
        var emoji = (payload?.Emoji ?? string.Empty).Trim();
        var head = "> [!" + tone + (emoji.Length == 0 ? "]" : " " + emoji + "]");
        return body.Length == 0 ? head : head + " " + body.Replace("\n", "\n> ", StringComparison.Ordinal);
    }

    private static string SerializeSketchFence(Block block) =>
        "```sketch\n" + (block.Content ?? string.Empty) + "\n```";

    private static string GetEquationLatex(Block block)
    {
        if (block.Payload is EquationPayload ep)
            return ep.Latex;
        if (!block.Meta.TryGetValue("equationLatex", out var v) || v == null)
            return string.Empty;
        return v switch
        {
            string s => s,
            JsonElement je when je.ValueKind == JsonValueKind.String => je.GetString() ?? string.Empty,
            _ => v.ToString() ?? string.Empty
        };
    }
}

