using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Tests;

/// <summary>Pipe tables read back into table blocks, and anything that is not one keeps its text.</summary>
public class NoteBlockMarkdownTableTests
{
    private static Block Cell(string text, int order, TextStyle? style = null) => new()
    {
        Type = BlockType.TableCell,
        Order = order,
        Spans = new List<InlineSpan> { new TextSpan(text, style ?? TextStyle.Default) },
        Payload = new TableCellPayload()
    };

    private static Block Row(int order, params Block[] cells) => new()
    {
        Type = BlockType.TableRow,
        Order = order,
        Payload = new EmptyPayload(),
        Children = cells.ToList()
    };

    private static Block Text(string text, int order) =>
        new() { Type = BlockType.Text, Order = order, Spans = new List<InlineSpan> { InlineSpan.Plain(text) } };

    private static string[][] CellTexts(Block table) =>
        table.Children!.Select(r => r.Children!.Select(c => c.Content).ToArray()).ToArray();

    [Fact]
    public void RoundTrip_OwnTableExport_KeepsRowsCellsAndTheHeaderRow()
    {
        var table = new Block
        {
            Type = BlockType.Table,
            Order = 1,
            Payload = new TablePayload(new List<double> { 120, 120 }, new List<bool> { true, false, false }, new List<bool> { false, false }),
            Children = new List<Block>
            {
                Row(0, Cell("Drug", 0), Cell("Class", 1)),
                Row(1, Cell("Levodopa", 0), Cell("bold", 1, TextStyle.Default with { Bold = true })),
                Row(2, Cell("a|b", 0), Cell("back\\|slash", 1))
            }
        };
        var blocks = new List<Block> { Text("before", 0), table, Text("after", 2) };

        var back = NoteBlockMarkdownConverter.Deserialize(NoteBlockMarkdownConverter.Serialize(blocks));

        Assert.Equal(new[] { BlockType.Text, BlockType.Table, BlockType.Text }, back.Select(b => b.Type));
        var read = back[1];
        Assert.Equal(
            new[] { new[] { "Drug", "Class" }, new[] { "Levodopa", "bold" }, new[] { "a|b", "back\\|slash" } },
            CellTexts(read));
        Assert.All(read.Children!, r => Assert.Equal(BlockType.TableRow, r.Type));
        Assert.All(read.Children!.SelectMany(r => r.Children!), c => Assert.Equal(BlockType.TableCell, c.Type));
        Assert.True(Assert.IsType<TextSpan>(Assert.Single(read.Children![1].Children![1].Spans)).Style.Bold);

        var payload = Assert.IsType<TablePayload>(read.Payload);
        Assert.Equal(new[] { true, false, false }, payload.HeaderRows);
        Assert.Equal(new[] { false, false }, payload.HeaderColumns);
        Assert.Equal(2, payload.ColumnWidths.Count);
        Assert.Equal(new[] { 0, 1, 2 }, read.Children!.Select(r => r.Order));
    }

    [Fact]
    public void Deserialize_AWideBodyRow_WidensTheTableAndPadsTheRest()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("| a |\n| --- |\n| b | extra |\n| c");

        var table = Assert.Single(back);
        Assert.Equal(new[] { new[] { "a", "" }, new[] { "b", "extra" }, new[] { "c", "" } }, CellTexts(table));
        Assert.Equal(new[] { true, false, false }, Assert.IsType<TablePayload>(table.Payload).HeaderRows);
    }

    [Fact]
    public void Deserialize_ReadsATableInTheLinePerBlockDialectToo()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("intro\n| a | b |\n|:---|---:|\n| 1 | 2 |\nend");

        Assert.Equal(new[] { BlockType.Text, BlockType.Table, BlockType.Text }, back.Select(b => b.Type));
        Assert.Equal(new[] { new[] { "a", "b" }, new[] { "1", "2" } }, CellTexts(back[1]));
    }

    [Fact]
    public void RoundTrip_APipeInsideInlineCode_ComesBackAsAPipe()
    {
        var code = TextStyle.Default with { Code = true };
        var table = new Block
        {
            Type = BlockType.Table,
            Payload = new TablePayload(new List<double> { 120, 120 }, new List<bool> { true }, new List<bool> { false, false }),
            Children = new List<Block> { Row(0, Cell("c|d", 0, code), Cell("x", 1)) }
        };

        var md = NoteBlockMarkdownConverter.Serialize(new List<Block> { table });
        var back = Assert.Single(NoteBlockMarkdownConverter.Deserialize(md));

        var span = Assert.IsType<TextSpan>(Assert.Single(back.Children![0].Children![0].Spans));
        Assert.Equal("c|d", span.Text);
        Assert.True(span.Style.Code);
    }

    [Theory]
    [InlineData("| a | b | c |\n|:-:|--:|-|\n| 1 | 2 | 3 |")]
    [InlineData("a | b | c\n--- | :---: | -\n1 | 2 | 3")]
    public void Deserialize_EveryGfmDelimiterAndTablesWithoutOuterPipes(string markdown)
    {
        var table = Assert.Single(NoteBlockMarkdownConverter.Deserialize(markdown));

        Assert.Equal(BlockType.Table, table.Type);
        Assert.Equal(new[] { new[] { "a", "b", "c" }, new[] { "1", "2", "3" } }, CellTexts(table));
    }

    [Fact]
    public void Deserialize_AHeaderlessTableAfterProse_EndsTheParagraph()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("intro\n\nsome text\na | b\n--- | ---\n1 | 2");

        Assert.Equal(new[] { BlockType.Text, BlockType.Text, BlockType.Table }, back.Select(b => b.Type));
        Assert.Equal("some text", back[1].Content);
    }

    [Theory]
    [InlineData("| a | b |\n| --- |\n| 1 | 2 |")]
    [InlineData("| a | b |\n| 1 | 2 |")]
    [InlineData("| not a table")]
    public void Deserialize_ABrokenTable_KeepsEveryLineAsItsOwnBlock(string markdown)
    {
        var back = NoteBlockMarkdownConverter.Deserialize(markdown);

        var lines = markdown.Split('\n');
        Assert.Equal(lines.Length, back.Count);
        Assert.All(back, b => Assert.Equal(BlockType.Text, b.Type));
        for (var k = 0; k < lines.Length; k++)
            Assert.Equal(lines[k].Replace("\\", string.Empty, StringComparison.Ordinal).Replace(" ", string.Empty, StringComparison.Ordinal),
                back[k].Content.Replace(" ", string.Empty, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("# Heading | extra", BlockType.Heading1, "Heading | extra")]
    [InlineData("- item | x", BlockType.BulletList, "item | x")]
    [InlineData("1. item | x", BlockType.NumberedList, "item | x")]
    [InlineData("> quote | x", BlockType.Quote, "quote | x")]
    public void Deserialize_ABlockLineRightAfterATable_EndsTheTableAndKeepsItsStructure(string line, BlockType type, string content)
    {
        var back = NoteBlockMarkdownConverter.Deserialize("| a | b |\n| --- | --- |\n| 1 | 2 |\n" + line);

        Assert.Equal(new[] { BlockType.Table, type }, back.Select(b => b.Type));
        Assert.Equal(new[] { new[] { "a", "b" }, new[] { "1", "2" } }, CellTexts(back[0]));
        Assert.Equal(content, back[1].Content);
    }

    [Fact]
    public void Deserialize_ACodeFenceRightAfterATable_EndsTheTable()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("| a | b |\n| --- | --- |\n| 1 | 2 |\n```c | d\nx\n```");

        Assert.Equal(new[] { BlockType.Table, BlockType.Code }, back.Select(b => b.Type));
        Assert.Equal(2, back[0].Children!.Count);
    }

    [Fact]
    public void Deserialize_ARowWiderThanTheColumnLimit_ReadsTheLinesAsPlainBlocksAndKeepsEveryCell()
    {
        var wide = string.Join(" | ", Enumerable.Range(0, 500).Select(n => "c" + n));
        var lines = new[] { "| h | i |", "| --- | --- |", "| " + wide + " |" }
            .Concat(Enumerable.Repeat("| a | b |", 50))
            .ToArray();

        var back = NoteBlockMarkdownConverter.Deserialize(string.Join("\n", lines));

        Assert.DoesNotContain(back, b => b.Type == BlockType.Table);
        Assert.Equal(lines.Length, back.Count);
        Assert.Contains("c499", back[2].Content, StringComparison.Ordinal);
    }

    [Fact]
    public void Deserialize_ATableOverTheCellLimit_ReadsTheLinesAsPlainBlocks()
    {
        var lines = new[] { "| a | b | c | d |", "| - | - | - | - |" }
            .Concat(Enumerable.Repeat("| 1 | 2 | 3 | 4 |", NoteBlockMarkdownConverter.MaxTableCells / 4))
            .ToArray();

        var back = NoteBlockMarkdownConverter.Deserialize(string.Join("\n", lines));

        Assert.DoesNotContain(back, b => b.Type == BlockType.Table);
        Assert.Equal(lines.Length, back.Count);
    }

    [Theory]
    [InlineData(1, 12_000)]
    [InlineData(65, 600)]
    public void Deserialize_AnOversizedRunOfDelimiterRows_IsReadInLinearWork(int width, int rows)
    {
        // Every line here could open a table. Read again from each, the work grows with the square.
        var row = "|" + string.Concat(Enumerable.Repeat("-|", width));
        long Allocated(int count)
        {
            var markdown = string.Join("\n", Enumerable.Repeat(row, count));
            var before = GC.GetAllocatedBytesForCurrentThread();
            var back = NoteBlockMarkdownConverter.Deserialize(markdown);
            var used = GC.GetAllocatedBytesForCurrentThread() - before;
            Assert.DoesNotContain(back, b => b.Type == BlockType.Table);
            Assert.Equal(count, back.Count);
            return used;
        }

        Allocated(rows);
        var single = Allocated(rows);
        var twice = Allocated(rows * 2);

        Assert.True(twice < single * 3, $"{rows} rows allocated {single} bytes, {rows * 2} rows {twice}.");
    }

    [Theory]
    [InlineData("a | b")]
    [InlineData("plain text with a|pipe")]
    [InlineData("x | y | z and more")]
    public void Deserialize_APipeInOrdinaryText_StaysInTheText(string line)
    {
        var block = Assert.Single(NoteBlockMarkdownConverter.Deserialize("before\n\n" + line).Skip(1));

        Assert.Equal(BlockType.Text, block.Type);
        Assert.Equal(line, block.Content);
    }

    [Fact]
    public void Deserialize_ATableAtTheColumnLimit_StaysATable()
    {
        string Row(string cell) => "| " + string.Join(" | ", Enumerable.Repeat(cell, NoteBlockMarkdownConverter.MaxTableColumns)) + " |";

        var back = NoteBlockMarkdownConverter.Deserialize(Row("a") + "\n" + Row("---") + "\n" + Row("1"));

        var table = Assert.Single(back);
        Assert.Equal(BlockType.Table, table.Type);
        Assert.Equal(NoteBlockMarkdownConverter.MaxTableColumns, table.Children![0].Children!.Count);
    }
}
