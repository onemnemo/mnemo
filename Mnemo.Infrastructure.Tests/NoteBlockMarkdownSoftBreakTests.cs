using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// A newline inside a block goes out as a CommonMark hard break and comes back into the same
/// block, in the same form the editor's markdown writer and paste reader use.
/// </summary>
public class NoteBlockMarkdownSoftBreakTests
{
    private static Block Block(BlockType type, string text, BlockPayload? payload = null)
    {
        var block = new Block { Type = type, Order = 0, Spans = new List<InlineSpan> { InlineSpan.Plain(text) } };
        if (payload is not null)
            block.Payload = payload;
        return block;
    }

    private static string Normalized(string markdown) => markdown.Replace("\r\n", "\n", StringComparison.Ordinal);

    [Fact]
    public void Serialize_WritesANewlineInsideASpanAsAHardBreak()
    {
        Assert.Equal("one\\\ntwo", InlineMarkdownSerializer.SerializeSpans(new[] { InlineSpan.Plain("one\ntwo") }));
        // A literal backslash before the break escapes to two, which keeps the run odd.
        Assert.Equal("end\\\\\\\nnext", InlineMarkdownSerializer.SerializeSpans(new[] { InlineSpan.Plain("end\\\nnext") }));
        // Older content may carry Windows line endings; they are one break, not two.
        Assert.Equal("a\\\nb", InlineMarkdownSerializer.SerializeSpans(new[] { InlineSpan.Plain("a\r\nb") }));
    }

    [Fact]
    public void RoundTrip_SoftBreak_SurvivesInEveryBlockThatCanHoldOne()
    {
        var blocks = new List<Block>
        {
            Block(BlockType.Text, "one\ntwo"),
            Block(BlockType.Heading2, "a\nb"),
            Block(BlockType.BulletList, "x\ny"),
            Block(BlockType.NumberedList, "n\nm"),
            Block(BlockType.Checklist, "c\nd", new ChecklistPayload(true)),
            Block(BlockType.Quote, "q\nr"),
            Block(BlockType.Callout, "s\nt", new CalloutPayload("", "note")),
        };
        for (var i = 0; i < blocks.Count; i++) blocks[i].Order = i;

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(blocks));
        Assert.Equal(
            string.Join("\n", "one\\", "two", "## a\\", "b", "- x\\", "y", "1. n\\", "m", "- [x] c\\", "d", "> q\\", "> r", "> [!note] s\\", "> t"),
            md);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.Equal(
            new[] { BlockType.Text, BlockType.Heading2, BlockType.BulletList, BlockType.NumberedList, BlockType.Checklist, BlockType.Quote, BlockType.Callout },
            back.Select(b => b.Type));
        Assert.Equal(new[] { "one\ntwo", "a\nb", "x\ny", "n\nm", "c\nd", "q\nr", "s\nt" }, back.Select(b => b.Content));
    }

    [Fact]
    public void RoundTrip_SoftBreak_AtTheEndOfABlockAndAnEmptyLineInsideOne()
    {
        var blocks = new List<Block> { Block(BlockType.Text, "tail\n"), Block(BlockType.Quote, "a\n\nb"), Block(BlockType.Text, "after") };
        for (var i = 0; i < blocks.Count; i++) blocks[i].Order = i;

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(blocks));
        Assert.Equal(string.Join("\n", "tail\\", "", "> a\\", "> \\", "> b", "after"), md);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.Equal(new[] { BlockType.Text, BlockType.Quote, BlockType.Text }, back.Select(b => b.Type));
        Assert.Equal(new[] { "tail\n", "a\n\nb", "after" }, back.Select(b => b.Content));
    }

    [Fact]
    public void RoundTrip_SoftBreak_AsTheLastThingInTheDocument()
    {
        // The writer trims nothing off the end, so the last block's marker keeps its newline and
        // reads back as a break rather than a literal backslash.
        var md = Normalized(NoteBlockMarkdownConverter.Serialize(new List<Block> { Block(BlockType.Text, "tail\n") }));
        Assert.Equal("tail\\\n", md);
        Assert.Equal("tail\n", Assert.Single(NoteBlockMarkdownConverter.Deserialize(md)).Content);

        md = Normalized(NoteBlockMarkdownConverter.Serialize(new List<Block> { Block(BlockType.Text, "tail\n\n") }));
        Assert.Equal("tail\\\n\\\n", md);
        Assert.Equal("tail\n\n", Assert.Single(NoteBlockMarkdownConverter.Deserialize(md)).Content);

        md = Normalized(NoteBlockMarkdownConverter.Serialize(new List<Block> { Block(BlockType.Heading1, "tail\n") }));
        Assert.Equal("# tail\\\n", md);
        Assert.Equal("tail\n", Assert.Single(NoteBlockMarkdownConverter.Deserialize(md)).Content);
    }

    [Fact]
    public void RoundTrip_AContinuationLineThatLooksLikeABlock_StaysInsideItsBlock()
    {
        // The folded text is handed to a document parser, so a line-leading marker is escaped or
        // it would end the paragraph and start a list, a heading, a quote or a rule.
        var texts = new[] { "Hello\n- item", "Hello\n# Title", "Hello\n> quoted", "Hello\n1. first", "Hello\n---", "Hello\n<div>", "Hello\n$$" };
        var blocks = texts.Select((text, i) => { var b = Block(BlockType.Text, text); b.Order = i; return b; }).ToList();

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(blocks));
        var lines = md.Split('\n');
        Assert.Equal("\\- item", lines[1]);
        Assert.Equal("1\\. first", lines[7]);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.All(back, b => Assert.Equal(BlockType.Text, b.Type));
        Assert.Equal(texts, back.Select(b => b.Content));
    }

    [Fact]
    public void RoundTrip_AMarkerBehindLeadingBlanks_StaysInsideItsBlock()
    {
        // A reader trims a line before it looks for a marker, so the escape lands on the first
        // non-blank character, on a folded line and on the first line of a block alike.
        var texts = new[] { "Hello\n - item", "Hello\n   # Title", "Hello\n ---", "Hello\n\t> quoted", " - item", "  1) first" };
        var blocks = texts.Select((text, i) => { var b = Block(BlockType.Text, text); b.Order = i; return b; }).ToList();

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(blocks));
        var lines = md.Split('\n');
        Assert.Equal(" \\- item", lines[1]);
        Assert.Equal(" \\- item", lines[8]);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.All(back, b => Assert.Equal(BlockType.Text, b.Type));
        Assert.Equal(
            new[] { "Hello\n- item", "Hello\n# Title", "Hello\n---", "Hello\n> quoted", "- item", "1) first" },
            back.Select(b => b.Content));
    }

    [Fact]
    public void RoundTrip_ATenDigitNumberAndADot_IsNotAList()
    {
        // CommonMark bounds an ordered marker at nine digits; the reader agrees with the writer.
        var md = Normalized(NoteBlockMarkdownConverter.Serialize(new List<Block> { Block(BlockType.Text, "1234567890. first") }));
        Assert.Equal("1234567890. first", md);

        var back = Assert.Single(NoteBlockMarkdownConverter.Deserialize(md));
        Assert.Equal(BlockType.Text, back.Type);
        Assert.Equal("1234567890. first", back.Content);
    }

    [Fact]
    public void Serialize_ATableCellPipe_IsEscapedOnce()
    {
        // The inline writer escapes a pipe at a line start already, and a literal backslash
        // ahead of a pipe is escaped on its own; the cell writer must not double either.
        var first = Block(BlockType.TableCell, "|first", new TableCellPayload(string.Empty));
        var second = Block(BlockType.TableCell, "a\\|b", new TableCellPayload(string.Empty));
        second.Order = 1;
        var row = new Block { Type = BlockType.TableRow, Order = 0, Children = new List<Block> { first, second } };
        var table = new Block
        {
            Type = BlockType.Table,
            Order = 0,
            Payload = new TablePayload(new List<double> { 120, 120 }, new List<bool> { true }, new List<bool> { false, false }, false),
            Children = new List<Block> { row }
        };

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(new List<Block> { table }));

        Assert.Contains("| \\|first | a\\\\\\|b |", md, StringComparison.Ordinal);
    }

    [Fact]
    public void RoundTrip_BoldAcrossABreakFollowedByAMarker_KeepsTheBold()
    {
        var bold = new Block { Type = BlockType.Text, Order = 0, Spans = new List<InlineSpan> { new TextSpan("a\n- b", TextStyle.Default with { Bold = true }) } };

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(new List<Block> { bold }));
        Assert.Equal("**a\\\n\\- b**", md);

        var span = Assert.IsType<TextSpan>(Assert.Single(Assert.Single(NoteBlockMarkdownConverter.Deserialize(md)).Spans!));
        Assert.Equal("a\n- b", span.Text);
        Assert.True(span.Style.Bold);
    }

    [Fact]
    public void RoundTrip_ATextBlockThatStartsLikeABlock_StaysAText()
    {
        var blocks = new List<Block> { Block(BlockType.Text, "- not a bullet"), Block(BlockType.Text, "# not a heading") };
        blocks[1].Order = 1;

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(blocks));
        Assert.Equal("\\- not a bullet\n\\# not a heading", md);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.Equal(new[] { BlockType.Text, BlockType.Text }, back.Select(b => b.Type));
        Assert.Equal(new[] { "- not a bullet", "# not a heading" }, back.Select(b => b.Content));
    }

    [Fact]
    public void RoundTrip_SoftBreakInsideInlineCode_IsABreakBetweenTwoSpans()
    {
        // A backslash is literal inside backticks, so the span is closed around the break; the
        // newline itself comes back unstyled, which is the one thing markdown cannot say.
        var code = new Block { Type = BlockType.Text, Order = 0, Spans = new List<InlineSpan> { new TextSpan("a\nb", TextStyle.Default with { Code = true }) } };

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(new List<Block> { code }));
        Assert.Equal("`a`\\\n`b`", md);

        var back = Assert.Single(NoteBlockMarkdownConverter.Deserialize(md));
        Assert.Equal("a\nb", back.Content);
        Assert.Equal(new[] { true, false, true }, back.Spans!.Select(s => ((TextSpan)s).Style.Code));
    }

    [Fact]
    public void Serialize_ACodeBlockAfterAText_StartsOnItsOwnLine()
    {
        var blocks = new List<Block> { Block(BlockType.Text, "before"), new Block { Type = BlockType.Code, Order = 1, Payload = new CodePayload("", "x") }, Block(BlockType.Text, "after") };
        blocks[2].Order = 2;

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(blocks));

        Assert.Equal("before\n```\nx\n```\nafter", md);
    }

    [Fact]
    public void RoundTrip_ABlockEndingInALiteralBackslash_StaysApartFromTheNext()
    {
        var blocks = new List<Block> { Block(BlockType.Text, "path\\"), Block(BlockType.Text, "next") };
        blocks[1].Order = 1;

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(blocks));
        Assert.Equal("path\\\\\nnext", md);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.Equal(new[] { "path\\", "next" }, back.Select(b => b.Content));
    }

    [Fact]
    public void RoundTrip_SoftBreak_SurvivesInsideANestedListItem()
    {
        var parent = Block(BlockType.BulletList, "outer");
        parent.Children = new List<Block> { Block(BlockType.BulletList, "in\nner") };

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(new List<Block> { parent }));
        Assert.Equal("- outer\n  - in\\\n  ner", md);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.Equal("in\nner", Assert.Single(Assert.Single(back).Children!).Content);
    }

    [Fact]
    public void Deserialize_LeavesABackslashAtTheEndOfACodeOrEquationLineAlone()
    {
        var code = Assert.Single(NoteBlockMarkdownConverter.Deserialize("```\nline\\\n```"));
        Assert.Equal(BlockType.Code, code.Type);
        Assert.Equal("line\\", code.Content);

        var back = NoteBlockMarkdownConverter.Deserialize("$$\na \\\\\\\n$$\nafter");
        Assert.Equal(new[] { BlockType.Equation, BlockType.Text }, back.Select(b => b.Type));
        Assert.Equal("a \\\\\\", (back[0].Payload as EquationPayload)?.Latex);
    }

    [Fact]
    public void Serialize_TableCell_FoldsASoftBreakToASpace()
    {
        var cell = Block(BlockType.TableCell, "top\nbottom", new TableCellPayload(string.Empty));
        var row = new Block { Type = BlockType.TableRow, Order = 0, Children = new List<Block> { cell } };
        var table = new Block
        {
            Type = BlockType.Table,
            Order = 0,
            Payload = new TablePayload(new List<double> { 120 }, new List<bool> { true }, new List<bool> { false }, false),
            Children = new List<Block> { row }
        };

        var md = Normalized(NoteBlockMarkdownConverter.Serialize(new List<Block> { table }));

        Assert.Equal("| top bottom |\n| --- |", md);
    }
}
