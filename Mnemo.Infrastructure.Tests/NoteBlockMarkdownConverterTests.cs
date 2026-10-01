using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Tests;

public class NoteBlockMarkdownConverterTests
{
    [Fact]
    public void RoundTrip_PreservesMultipleBlockTypes()
    {
        var blocks = new List<Block>
        {
            new()
            {
                Type = BlockType.Heading1,
                Order = 0,
                Spans = new List<InlineSpan> { new TextSpan("Title", new TextStyle(Bold: true)) }
            },
            new() { Type = BlockType.BulletList, Order = 1, Spans = new List<InlineSpan> { InlineSpan.Plain("Item") } },
            new() { Type = BlockType.Text, Order = 2, Spans = new List<InlineSpan> { InlineSpan.Plain("Para") } }
        };
        foreach (var b in blocks) b.EnsureSpans();

        var md = NoteBlockMarkdownConverter.Serialize(blocks);
        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.True(back.Count >= 3);
        Assert.Contains(back, b => b.Type == BlockType.Heading1);
        Assert.Contains(back, b => b.Type == BlockType.BulletList);
    }

    [Fact]
    public void Serialize_EquationBlock_EmitsDoubleDollar()
    {
        var block = new Block
        {
            Type = BlockType.Equation,
            Order = 0,
            Payload = new EquationPayload(@"\frac{1}{2}")
        };
        block.EnsureSpans();

        var md = NoteBlockMarkdownConverter.Serialize(new List<Block> { block });
        Assert.Contains("$$", md);
        Assert.Contains(@"\frac{1}{2}", md);
    }

    [Fact]
    public void RoundTrip_EquationBlock_PreservesLatex()
    {
        var blocks = new List<Block>
        {
            new()
            {
                Type = BlockType.Equation,
                Order = 0,
                Payload = new EquationPayload(@"x^2 + y^2 = z^2")
            }
        };
        foreach (var b in blocks) b.EnsureSpans();

        var md = NoteBlockMarkdownConverter.Serialize(blocks);
        var back = NoteBlockMarkdownConverter.Deserialize(md);

        Assert.Single(back);
        Assert.Equal(BlockType.Equation, back[0].Type);
        Assert.Equal("x^2 + y^2 = z^2", (back[0].Payload as EquationPayload)?.Latex);
    }

    [Fact]
    public void Deserialize_SingleLineEquation_Parses()
    {
        var md = "$$E=mc^2$$";
        var blocks = NoteBlockMarkdownConverter.Deserialize(md);

        Assert.Single(blocks);
        Assert.Equal(BlockType.Equation, blocks[0].Type);
        Assert.Equal("E=mc^2", (blocks[0].Payload as EquationPayload)?.Latex);
    }

    [Fact]
    public void Deserialize_EquationOpenerWithNoCloser_IsText()
    {
        var blocks = NoteBlockMarkdownConverter.Deserialize("before\n$$\nafter\n# Title");

        Assert.Equal(new[] { BlockType.Text, BlockType.Text, BlockType.Text, BlockType.Heading1 }, blocks.Select(b => b.Type));
        // The opener itself reads as an empty inline equation, which is what two dollars are to the
        // inline parser; what matters is that the lines after it are still their own blocks.
        Assert.Equal("after", blocks[2].Content);
    }

    [Fact]
    public void InlineMarkdownSerializer_EmptyEquationSpan_EmitsNothing()
    {
        var md = InlineMarkdownSerializer.SerializeSpans(new List<InlineSpan> { InlineSpan.Plain("a"), new EquationSpan(""), InlineSpan.Plain("b") });

        Assert.Equal("ab", md);
    }

    [Fact]
    public void InlineMarkdownSerializer_EquationSpan_EmitsDollar()
    {
        var spans = new List<InlineSpan>
        {
            InlineSpan.Plain("Energy is "),
            new EquationSpan("E=mc^2"),
            InlineSpan.Plain(" (Einstein)")
        };

        var md = InlineMarkdownSerializer.SerializeSpans(spans);
        Assert.Equal("Energy is $E=mc^2$ (Einstein)", md);
    }

    [Fact]
    public void RoundTrip_Checklist_PreservesChecked()
    {
        var blocks = new List<Block>
        {
            new()
            {
                Type = BlockType.Checklist,
                Order = 0,
                Payload = new ChecklistPayload(true),
                Spans = new List<InlineSpan> { InlineSpan.Plain("Done") }
            },
            new()
            {
                Type = BlockType.Checklist,
                Order = 1,
                Payload = new ChecklistPayload(false),
                Spans = new List<InlineSpan> { InlineSpan.Plain("Todo") }
            }
        };
        foreach (var b in blocks) b.EnsureSpans();

        var md = NoteBlockMarkdownConverter.Serialize(blocks);
        var back = NoteBlockMarkdownConverter.Deserialize(md);

        Assert.Equal(2, back.Count);
        Assert.Equal(BlockType.Checklist, back[0].Type);
        Assert.Equal(BlockType.Checklist, back[1].Type);
        Assert.True((back[0].Payload as ChecklistPayload)?.Checked);
        Assert.False((back[1].Payload as ChecklistPayload)?.Checked);
        Assert.Equal("Done", back[0].Content);
        Assert.Equal("Todo", back[1].Content);
    }

    [Fact]
    public void RoundTrip_Callout_PreservesToneAndEmoji()
    {
        var blocks = new List<Block>
        {
            new()
            {
                Type = BlockType.Callout,
                Order = 0,
                Payload = new CalloutPayload("💡", "note"),
                Spans = new List<InlineSpan> { InlineSpan.Plain("Remember this") }
            },
            new()
            {
                Type = BlockType.Callout,
                Order = 1,
                Payload = new CalloutPayload("", "warn"),
                Spans = new List<InlineSpan> { InlineSpan.Plain("Careful") }
            }
        };
        foreach (var b in blocks) b.EnsureSpans();

        var md = NoteBlockMarkdownConverter.Serialize(blocks);
        var back = NoteBlockMarkdownConverter.Deserialize(md);

        Assert.Equal(2, back.Count);
        Assert.All(back, b => Assert.Equal(BlockType.Callout, b.Type));
        Assert.Equal("💡", (back[0].Payload as CalloutPayload)?.Emoji);
        Assert.Equal("note", (back[0].Payload as CalloutPayload)?.Tone);
        Assert.Equal("Remember this", back[0].Content);
        Assert.Equal(string.Empty, (back[1].Payload as CalloutPayload)?.Emoji);
        Assert.Equal("warn", (back[1].Payload as CalloutPayload)?.Tone);
        Assert.Equal("Careful", back[1].Content);
    }

    [Fact]
    public void Deserialize_Callout_IsProbedBeforeQuote()
    {
        // A callout head is a quote line, so the quote branch would swallow it and
        // the tone would come back as literal text inside a Quote block.
        var back = NoteBlockMarkdownConverter.Deserialize("> [!note 💡] Heads up\n> and more\n> [!warn] Careful");

        Assert.Equal(2, back.Count);
        Assert.Equal(BlockType.Callout, back[0].Type);
        Assert.Equal("Heads up\nand more", back[0].Content);
        Assert.Equal("warn", (back[1].Payload as CalloutPayload)?.Tone);
        Assert.Equal("Careful", back[1].Content);
    }

    [Fact]
    public void Deserialize_QuoteFollowedByCallout_StaysTwoBlocks()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("> Just a quote\n> [!note] Heads up");

        Assert.Equal(2, back.Count);
        Assert.Equal(BlockType.Quote, back[0].Type);
        Assert.Equal("Just a quote", back[0].Content);
        Assert.Equal(BlockType.Callout, back[1].Type);
    }

    [Fact]
    public void EquationLatexNormalizer_StripsDollarDelimiters()
    {
        Assert.Equal("x^2", EquationLatexNormalizer.Normalize("$x^2$"));
        Assert.Equal("x^2", EquationLatexNormalizer.Normalize("$$x^2$$"));
        Assert.Equal(@"\frac{1}{2}", EquationLatexNormalizer.Normalize(@"\frac{1}{2}"));
        Assert.Equal(string.Empty, EquationLatexNormalizer.Normalize(""));
        Assert.Equal(string.Empty, EquationLatexNormalizer.Normalize(null));
    }

    [Fact]
    public void TwoColumn_Serialize_FlattensCellsWithoutDivider()
    {
        var twoColumn = new Block
        {
            Type = BlockType.TwoColumn,
            Order = 0,
            Children = new List<Block>
            {
                Column(0, Text("Left A", 0), Text("Left B", 1)),
                Column(1, Text("Right A", 0))
            }
        };

        var md = NoteBlockMarkdownConverter.Serialize(new List<Block> { twoColumn });

        // The old code emitted "col\n\n---\n\ncol", which lost every cell block and reimported the
        // separator as a Divider. The cells now flatten into the document with no separator.
        Assert.DoesNotContain("---", md);
        Assert.Contains("Left A", md);
        Assert.Contains("Left B", md);
        Assert.Contains("Right A", md);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.DoesNotContain(back, b => b.Type == BlockType.Divider);
        Assert.Equal(3, back.Count);
        Assert.All(back, b => Assert.Equal(BlockType.Text, b.Type));
    }

    [Fact]
    public void Deserialize_NumberedList_WritesCanonicalIndexKeyNotLegacy()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("3. First\n4. Second");

        Assert.Equal(2, back.Count);
        Assert.All(back, b => Assert.Equal(BlockType.NumberedList, b.Type));
        // The canonical key the editor and PDF composer read, never the legacy key nothing reads.
        Assert.Equal(3, Assert.IsType<int>(back[0].Meta["listNumberIndex"]));
        Assert.Equal(4, Assert.IsType<int>(back[1].Meta["listNumberIndex"]));
        Assert.DoesNotContain("listNumber", back[0].Meta.Keys);
    }

    [Fact]
    public void Serialize_NumberedList_ReadsCanonicalIndex()
    {
        var block = new Block
        {
            Type = BlockType.NumberedList,
            Order = 0,
            Spans = new List<InlineSpan> { InlineSpan.Plain("Item") },
            Meta = new Dictionary<string, object> { ["listNumberIndex"] = 5 }
        };

        Assert.Contains("5. Item", NoteBlockMarkdownConverter.Serialize(new List<Block> { block }));
    }

    [Fact]
    public void Serialize_NumberedList_FallsBackToLegacyKey()
    {
        // Old data on disk carries only "listNumber"; its start value must still survive export.
        var block = new Block
        {
            Type = BlockType.NumberedList,
            Order = 0,
            Spans = new List<InlineSpan> { InlineSpan.Plain("Item") },
            Meta = new Dictionary<string, object> { ["listNumber"] = 7 }
        };

        Assert.Contains("7. Item", NoteBlockMarkdownConverter.Serialize(new List<Block> { block }));
    }

    [Fact]
    public void RoundTrip_NumberedList_PreservesStartValue()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("5. First\n6. Second");
        var md = NoteBlockMarkdownConverter.Serialize(back);

        Assert.Contains("5. First", md);
        Assert.Contains("6. Second", md);
    }

    [Fact]
    public void RoundTrip_ImageBlock_PreservesPathAndAlt()
    {
        var blocks = new List<Block>
        {
            new()
            {
                Type = BlockType.Heading1,
                Order = 0,
                Spans = new List<InlineSpan> { InlineSpan.Plain("Cells") }
            },
            new()
            {
                Type = BlockType.Image,
                Order = 1,
                Payload = new ImagePayload("abc123.png", "A diagram", 320, "center")
            },
            Text("After", 2)
        };

        var md = NoteBlockMarkdownConverter.Serialize(blocks);
        Assert.Contains("![A diagram](abc123.png)", md);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        var image = Assert.Single(back, b => b.Type == BlockType.Image);
        var payload = Assert.IsType<ImagePayload>(image.Payload);
        Assert.Equal("abc123.png", payload.Path);
        Assert.Equal("A diagram", payload.Alt);
        Assert.Equal("A diagram", image.Content);

        // Markdown image references do not preserve display width or alignment.
        Assert.Equal(0, payload.Width);
        Assert.Equal("left", payload.Align);
    }

    [Fact]
    public void RoundTrip_ImageAlt_SurvivesABackslash()
    {
        var block = new Block { Type = BlockType.Image, Order = 0, Payload = new ImagePayload("p.png", @"a\b") };

        var back = NoteBlockMarkdownConverter.Deserialize(
            NoteBlockMarkdownConverter.Serialize(new List<Block> { block }));

        var payload = Assert.IsType<ImagePayload>(Assert.Single(back).Payload);
        Assert.Equal(@"a\b", payload.Alt);
        Assert.Equal("p.png", payload.Path);
    }

    [Fact]
    public void RoundTrip_ImageAlt_WithALineBreak_KeepsThePicture()
    {
        var block = new Block { Type = BlockType.Image, Order = 0, Payload = new ImagePayload("p.png", "top\nbottom") };

        var back = NoteBlockMarkdownConverter.Deserialize(
            NoteBlockMarkdownConverter.Serialize(new List<Block> { block }));

        // Normalize alt-text line breaks to keep the Markdown image on one line.
        var payload = Assert.IsType<ImagePayload>(Assert.Single(back).Payload);
        Assert.Equal("top bottom", payload.Alt);
        Assert.Equal("p.png", payload.Path);
    }

    [Fact]
    public void Serialize_LegacyImageBlock_ReadsTheMetaKeys()
    {
        // Rows written before the typed payload carry the same two values under meta keys.
        var block = new Block
        {
            Type = BlockType.Image,
            Order = 0,
            Meta = new Dictionary<string, object> { ["imagePath"] = "old.png", ["imageAlt"] = "A chart" }
        };

        Assert.Contains("![A chart](old.png)", NoteBlockMarkdownConverter.Serialize(new List<Block> { block }));
    }

    [Fact]
    public void Serialize_NestedList_IndentsChildrenUnderTheirParent()
    {
        var parent = new Block
        {
            Type = BlockType.BulletList,
            Order = 0,
            Spans = new List<InlineSpan> { InlineSpan.Plain("parent") },
            Children =
            [
                new Block
                {
                    Type = BlockType.NumberedList,
                    Order = 0,
                    Spans = new List<InlineSpan> { InlineSpan.Plain("child") },
                    Children =
                    [
                        new Block
                        {
                            Type = BlockType.Checklist,
                            Order = 0,
                            Spans = new List<InlineSpan> { InlineSpan.Plain("deep") },
                            Payload = new ChecklistPayload(true)
                        }
                    ]
                },
                new Block { Type = BlockType.BulletList, Order = 1, Spans = new List<InlineSpan> { InlineSpan.Plain("second") } }
            ]
        };

        var md = NoteBlockMarkdownConverter.Serialize(new List<Block> { parent, Text("after", 1) });

        // Two spaces under a bullet, three under a numbered item: each child sits at its
        // parent's content column. Line endings are the platform's, as they are between
        // top-level blocks.
        Assert.Equal("- parent\n  1. child\n     - [x] deep\n  - second\n\nafter", md.Replace("\r\n", "\n"));
    }

    [Fact]
    public void Deserialize_IndentedListLines_NestUnderTheItemAbove()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("- a\n  - b\n    1. c\n\t- tabbed\n- d\nplain\n  - e");

        Assert.Equal(4, back.Count);
        Assert.Equal(new[] { 0, 1, 2, 3 }, back.Select(b => b.Order));
        var a = back[0];
        Assert.Equal(BlockType.BulletList, a.Type);
        Assert.NotNull(a.Children);
        Assert.Equal(1, a.Children!.Count);
        Assert.Equal("b", a.Children[0].Content);
        Assert.Equal(0, a.Children[0].Order);
        Assert.Equal(2, a.Children[0].Children!.Count);
        var c = a.Children[0].Children![0];
        Assert.Equal(BlockType.NumberedList, c.Type);
        Assert.Equal("c", c.Content);
        // A tab reads as four columns: as deep as "c", not deeper, so it closes "c" and lands
        // beside it under "b".
        Assert.Equal("tabbed", a.Children[0].Children![1].Content);
        Assert.Equal(1, a.Children[0].Children![1].Order);
        Assert.Equal("d", back[1].Content);
        Assert.Null(back[1].Children);
        Assert.Equal(BlockType.Text, back[2].Type);
        // A non-list line ends the nesting, so the indented item after it is top-level.
        Assert.Equal(BlockType.BulletList, back[3].Type);
        Assert.Equal("e", back[3].Content);
    }

    [Fact]
    public void RoundTrip_NestedList_KeepsTheTree()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("- a\n  1. b\n     - [ ] c\n  - d\n- e");
        var md = NoteBlockMarkdownConverter.Serialize(back);
        Assert.Equal("- a\n  1. b\n     - [ ] c\n  - d\n- e", md.Replace("\r\n", "\n"));

        var again = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.Equal(2, again.Count);
        Assert.Equal(BlockType.BulletList, again[0].Type);
        Assert.Equal(2, again[0].Children!.Count);
        Assert.Equal(BlockType.NumberedList, again[0].Children![0].Type);
        Assert.Equal(BlockType.Checklist, Assert.Single(again[0].Children![0].Children!).Type);
        Assert.Equal("e", again[^1].Content);
        Assert.Null(again[^1].Children);
    }

    [Fact]
    public void Deserialize_BlankLineSeparatedParagraphs_HaveNoEmptyBlockBetweenThem()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("First paragraph.\n\nSecond paragraph.\n\n- item one\n");

        Assert.Equal(new[] { BlockType.Text, BlockType.Text, BlockType.BulletList }, back.Select(b => b.Type));
        Assert.Equal(new[] { "First paragraph.", "Second paragraph.", "item one" }, back.Select(b => b.Content));
        Assert.Equal(new[] { 0, 1, 2 }, back.Select(b => b.Order));
    }

    [Fact]
    public void Deserialize_HardWrappedParagraph_JoinsItsLinesWithASpace()
    {
        var back = NoteBlockMarkdownConverter.Deserialize(
            "A paragraph wrapped\nover three\n   lines.\n\nTwo trailing spaces  \nare a line break.\r\n\r\nNext.");

        Assert.Equal(new[] { "A paragraph wrapped over three lines.", "Two trailing spaces\nare a line break.", "Next." }, back.Select(b => b.Content));
        Assert.All(back, b => Assert.Equal(BlockType.Text, b.Type));
    }

    [Fact]
    public void Deserialize_ObsidianStyleFile_ReadsEachBlockOnce()
    {
        const string md = """
            # Cell biology

            The cell is the basic unit of life,
            and **every** organism is made of cells.

            - Nucleus holds the genome and is
              wrapped by a double membrane
              - Nucleolus
            - Mitochondria
            Loose line after the list.

            1. First
            2. Second

            - [x] Read chapter
            - [ ] Take notes

            > A quote that is
            > wrapped over two lines.

            > [!tip 💡] Remember
            > the membrane.

            ```python
            def f():

                return 1
            ```

            $$
            E = mc^2
            $$

            ---

            ![Diagram](cell.png)

            [[page:abc]]

            """;

        var back = NoteBlockMarkdownConverter.Deserialize(md);

        Assert.Equal(
            new[]
            {
                BlockType.Heading1, BlockType.Text, BlockType.BulletList, BlockType.BulletList,
                BlockType.NumberedList, BlockType.NumberedList, BlockType.Checklist, BlockType.Checklist,
                BlockType.Quote, BlockType.Callout, BlockType.Code, BlockType.Equation, BlockType.Divider,
                BlockType.Image, BlockType.Page
            },
            back.Select(b => b.Type));
        Assert.Equal("The cell is the basic unit of life, and every organism is made of cells.", back[1].Content);
        Assert.Equal("Nucleus holds the genome and is wrapped by a double membrane", back[2].Content);
        Assert.Equal("Nucleolus", Assert.Single(back[2].Children!).Content);
        // An unindented line right under an item is a lazy continuation of it.
        Assert.Equal("Mitochondria Loose line after the list.", back[3].Content);
        Assert.Equal("A quote that is wrapped over two lines.", back[8].Content);
        // A callout's title line stays apart from its body, as Obsidian shows it.
        Assert.Equal("Remember\nthe membrane.", back[9].Content);
        Assert.Equal("def f():\n\n    return 1", Assert.IsType<CodePayload>(back[10].Payload).Source.Replace("\r\n", "\n"));
        Assert.Equal("E = mc^2", Assert.IsType<EquationPayload>(back[11].Payload).Latex);
    }

    [Fact]
    public void Serialize_TwoParagraphs_AreSeparatedByABlankLine()
    {
        var md = NoteBlockMarkdownConverter.Serialize(new List<Block> { Text("A", 0), Text("B", 1) });

        Assert.Equal("A\n\nB", md.Replace("\r\n", "\n"));
    }

    [Fact]
    public void RoundTrip_EmptyParagraph_IsWrittenAsANonBreakingSpaceEntity()
    {
        var blocks = new List<Block> { Text("", 0), Text("A", 1), Text("", 2), Text("", 3), Text("&nbsp;", 4), Text("", 5) };

        var md = NoteBlockMarkdownConverter.Serialize(blocks).Replace("\r\n", "\n");
        Assert.Equal("&nbsp;\n\nA\n\n&nbsp;\n\n&nbsp;\n\n\\&nbsp;\n\n&nbsp;", md);

        var back = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.All(back, b => Assert.Equal(BlockType.Text, b.Type));
        Assert.Equal(new[] { "", "A", "", "", "&nbsp;", "" }, back.Select(b => b.Content));
        Assert.Equal("", Assert.Single(NoteBlockMarkdownConverter.Deserialize("&nbsp;")).Content);
    }

    [Fact]
    public void Deserialize_OldSingleNewlineExport_KeepsEachLineItsOwnBlock()
    {
        // Older builds wrote no blank line between blocks. A blank line inside a fence does not
        // make the file CommonMark.
        var back = NoteBlockMarkdownConverter.Deserialize(
            "# Title\r\nPara one\r\nPara two\r\n- a\r\n- b\r\nPara three\r\n```\r\ncode\r\n\r\nmore\r\n```\r\n~~~\r\n\r\n~~~\r\n$$ \r\n\r\nx\r\n$$ \r\nlast");

        Assert.Equal(
            new[] { BlockType.Heading1, BlockType.Text, BlockType.Text, BlockType.BulletList, BlockType.BulletList, BlockType.Text, BlockType.Code, BlockType.Code, BlockType.Equation, BlockType.Text },
            back.Select(b => b.Type));
        Assert.Equal(new[] { "Para one", "Para two" }, back.Skip(1).Take(2).Select(b => b.Content));
        Assert.Equal("x", Assert.IsType<EquationPayload>(back[8].Payload).Latex);
    }

    [Fact]
    public void Deserialize_OldExportWithAnEmptyLine_IsReadAsCommonMark_TheAcceptedCostForOldExports()
    {
        // An old export holding an empty paragraph has a blank line, so the whole file reads as
        // CommonMark and its back to back paragraphs merge. No text is lost.
        var back = NoteBlockMarkdownConverter.Deserialize("# Shopping\nMilk\nEggs\n\nBread");

        Assert.Equal(new[] { BlockType.Heading1, BlockType.Text, BlockType.Text }, back.Select(b => b.Type));
        Assert.Equal(new[] { "Shopping", "Milk Eggs", "Bread" }, back.Select(b => b.Content));

        var whitespaceLine = NoteBlockMarkdownConverter.Deserialize("Milk\nEggs\n   \nBread");
        Assert.Equal(new[] { "Milk Eggs", "Bread" }, whitespaceLine.Select(b => b.Content));

        // A blank line behind a trailing hard break is a blank line too.
        var afterBreak = NoteBlockMarkdownConverter.Deserialize("Intro\\\n\nsecond\nwrapped");
        Assert.Equal(new[] { "Intro\n", "second wrapped" }, afterBreak.Select(b => b.Content));
    }

    [Fact]
    public void Deserialize_DetectsBlankLinesThroughCrlf()
    {
        Assert.Equal(new[] { "A", "B C" }, NoteBlockMarkdownConverter.Deserialize("A\r\n\r\nB\r\nC").Select(b => b.Content));
        Assert.Equal(new[] { "A", "B" }, NoteBlockMarkdownConverter.Deserialize("A\r\nB").Select(b => b.Content));
    }

    [Fact]
    public void Deserialize_TwoTrailingSpaces_AreAHardBreakInListItemsAndQuotes()
    {
        var item = Assert.Single(NoteBlockMarkdownConverter.Deserialize("Intro\n\n- a  \n  b"), b => b.Type == BlockType.BulletList);
        Assert.Equal("a\nb", item.Content);

        var quote = Assert.Single(NoteBlockMarkdownConverter.Deserialize("Intro\n\n> a  \n> b"), b => b.Type == BlockType.Quote);
        Assert.Equal("a\nb", quote.Content);
    }

    [Fact]
    public void Deserialize_AHardBreakBeforeABlockStart_KeepsEveryCharacter()
    {
        // Two trailing spaces before a line that opens a block: the paragraph ends there and the
        // next line is read as the block it is, a setext underline making the paragraph a heading.
        var setext = NoteBlockMarkdownConverter.Deserialize("Intro\n\nfoo  \n===");
        Assert.Equal(BlockType.Heading1, setext[1].Type);
        Assert.Equal("foo", setext[1].Content);

        var steps = NoteBlockMarkdownConverter.Deserialize("Intro\n\nSteps:  \n1) open the lid");
        Assert.Equal(new[] { BlockType.Text, BlockType.Text, BlockType.NumberedList }, steps.Select(b => b.Type));
        Assert.Equal(new[] { "Intro", "Steps:", "open the lid" }, steps.Select(b => b.Content));

        // A backslash break folds the next line in whatever it looks like, so it is kept as text.
        var folded = NoteBlockMarkdownConverter.Deserialize("Intro\n\nfoo\\\n===\n\nSteps:\\\n1) open\\\n<div>\\\n***\\\n~~~");
        Assert.Equal(new[] { "Intro", "foo\n===", "Steps:\n1) open\n<div>\n***\n~~~" }, folded.Select(b => b.Content));
    }

    [Fact]
    public void Deserialize_ParagraphInterruptions_FollowCommonMark()
    {
        var back = NoteBlockMarkdownConverter.Deserialize(
            "Intro\n\nI was born in\n1999. It was cold.\n\nList:\n1. one\n2. two\n\nRule\n***\n\nFence\n~~~\ncode\n~~~\n\nMarkup\n<div>\n\nUnder\n---");

        Assert.Equal(
            new[]
            {
                BlockType.Text, BlockType.Text, BlockType.Text, BlockType.NumberedList, BlockType.NumberedList,
                BlockType.Text, BlockType.Divider, BlockType.Text, BlockType.Code, BlockType.Text, BlockType.Text,
                BlockType.Text, BlockType.Divider
            },
            back.Select(b => b.Type));
        Assert.Equal("I was born in 1999. It was cold.", back[1].Content);
        Assert.Equal("code", back[8].Content);
    }

    [Fact]
    public void Deserialize_SetextUnderlineOfEquals_MakesAHeading_AndDashesStayADivider()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("Title\nwrapped\n=====\n\nPara\n---");

        Assert.Equal(new[] { BlockType.Heading1, BlockType.Text, BlockType.Divider }, back.Select(b => b.Type));
        Assert.Equal("Title wrapped", back[0].Content);
    }

    [Fact]
    public void Deserialize_LazyContinuation_StaysInTheItemItFollows()
    {
        var nested = NoteBlockMarkdownConverter.Deserialize("Intro\n\n- a\n  - b\n  wrapped\n  - c");
        var a = nested[1];
        Assert.Equal(new[] { "b wrapped", "c" }, a.Children!.Select(c => c.Content));

        var lazy = NoteBlockMarkdownConverter.Deserialize("Intro\n\n- a\nlazy");
        Assert.Equal("a lazy", lazy[1].Content);
    }

    [Fact]
    public void Deserialize_CalloutBody_JoinsWrappedLinesAndKeepsHardBreaks()
    {
        var wrapped = NoteBlockMarkdownConverter.Deserialize("Intro\n\n> [!note]\n> wrapped body\n> second line");
        Assert.Equal("wrapped body second line", wrapped[1].Content);

        var broken = NoteBlockMarkdownConverter.Deserialize("Intro\n\n> [!note] one\\\n> two\n> three");
        Assert.Equal("one\ntwo three", broken[1].Content);
    }

    [Fact]
    public void DeserializeStoredContent_ReadsABlankLineAsAnEmptyParagraph()
    {
        var back = NoteBlockMarkdownConverter.DeserializeStoredContent("A\nB\n\nC");

        Assert.Equal(new[] { "A", "B", "", "C" }, back.Select(b => b.Content));
    }

    [Fact]
    public void RoundTrip_EveryBlockType_KeepsTypeAndContent()
    {
        var nested = Rich(BlockType.BulletList, "outer", 4);
        nested.Children = [Rich(BlockType.Checklist, "inner", 0, new ChecklistPayload(true))];
        var blocks = new List<Block>
        {
            Rich(BlockType.Heading1, "One", 0),
            Rich(BlockType.Heading2, "Two", 1),
            Text("First paragraph", 2),
            Text("Second paragraph\nwith a break", 3),
            nested,
            Rich(BlockType.BulletList, "sibling", 5),
            Rich(BlockType.NumberedList, "first", 6),
            Rich(BlockType.NumberedList, "second", 7),
            Rich(BlockType.Checklist, "open", 8, new ChecklistPayload(false)),
            Rich(BlockType.Quote, "quote one\nline two", 9),
            Rich(BlockType.Quote, "quote two", 10),
            Rich(BlockType.Callout, "callout one", 11, new CalloutPayload("💡", "tip")),
            Rich(BlockType.Callout, "callout two", 12, new CalloutPayload("", "warn")),
            new() { Type = BlockType.Code, Order = 13, Payload = new CodePayload("python", "a = 1\n\nb = 2") },
            new() { Type = BlockType.Sketch, Order = 14, Spans = [InlineSpan.Plain("A -> B")] },
            new() { Type = BlockType.Divider, Order = 15 },
            new() { Type = BlockType.Equation, Order = 16, Payload = new EquationPayload("x^2") },
            new() { Type = BlockType.Equation, Order = 17, Payload = new EquationPayload("y^2") },
            new() { Type = BlockType.Image, Order = 18, Payload = new ImagePayload("p.png", "Alt") },
            new() { Type = BlockType.Page, Order = 19, Payload = new PagePayload("note-1") },
            Text("", 20),
            new()
            {
                Type = BlockType.TwoColumn,
                Order = 21,
                Children = [Column(0, Text("Left", 0)), Column(1, Rich(BlockType.Heading3, "Right", 0), Text("Under", 1))]
            },
            Rich(BlockType.Heading4, "Four", 22),
        };

        var md = NoteBlockMarkdownConverter.Serialize(blocks);
        var back = NoteBlockMarkdownConverter.Deserialize(md);

        Assert.Equal(
            new[]
            {
                BlockType.Heading1, BlockType.Heading2, BlockType.Text, BlockType.Text, BlockType.BulletList,
                BlockType.BulletList, BlockType.NumberedList, BlockType.NumberedList, BlockType.Checklist,
                BlockType.Quote, BlockType.Quote, BlockType.Callout, BlockType.Callout, BlockType.Code,
                BlockType.Sketch, BlockType.Divider, BlockType.Equation, BlockType.Equation, BlockType.Image,
                BlockType.Page, BlockType.Text, BlockType.Text, BlockType.Heading3, BlockType.Text, BlockType.Heading4
            },
            back.Select(b => b.Type));
        Assert.Equal(
            new[]
            {
                "One", "Two", "First paragraph", "Second paragraph\nwith a break", "outer", "sibling", "first",
                "second", "open", "quote one\nline two", "quote two", "callout one", "callout two"
            },
            back.Take(13).Select(b => b.Content));
        Assert.Equal("inner", Assert.Single(back[4].Children!).Content);
        Assert.True(Assert.IsType<ChecklistPayload>(back[4].Children![0].Payload).Checked);
        Assert.Equal("a = 1\n\nb = 2", Assert.IsType<CodePayload>(back[13].Payload).Source.Replace("\r\n", "\n"));
        Assert.Equal("A -> B", back[14].Content);
        Assert.Equal(new[] { "x^2", "y^2" }, back.Skip(16).Take(2).Select(b => Assert.IsType<EquationPayload>(b.Payload).Latex));
        Assert.Equal("note-1", Assert.IsType<PagePayload>(back[19].Payload).ReferenceNoteId);
        Assert.Equal(new[] { "", "Left", "Right", "Under", "Four" }, back.Skip(20).Select(b => b.Content));

        // Written again, the markdown is the same: nothing drifts on a second trip. Line endings
        // are the platform's, which the code reader also uses between source lines.
        Assert.Equal(md.Replace("\r\n", "\n"), NoteBlockMarkdownConverter.Serialize(back).Replace("\r\n", "\n"));
    }

    [Theory]
    [InlineData("intro\n\n<div>\nsome text\n</div>\n\nafter", "some text")]
    [InlineData("intro\n\n<!-- comment -->\nParagraph right under a comment.\n\nafter", "Paragraph right under a comment.")]
    [InlineData("intro\n\n<details>\n<summary>Click</summary>\nHidden text here\n</details>", "Hidden text here")]
    [InlineData("z\n\nPara\n<div>block</div>\ntail text", "tail text")]
    [InlineData("z\n\nPara\n<div>block</div>\ntail text", "block")]
    [InlineData("z\n\n- a\n<!-- c -->\nafter", "after")]
    [InlineData("z\n\n:::\nwarn text\n:::", "warn text")]
    [InlineData("z\n\n::: tip\nwarn text\n:::", "warn text")]
    [InlineData("z\n\n^^^\nfig text\n^^^", "fig text")]
    [InlineData("z\n\n<details>\n<summary>Click</summary>\n</details>", "Click")]
    [InlineData("z\n\n[^1]: foot text\ncontinued", "continued")]
    public void Deserialize_TextBesideRawHtmlOrAContainer_IsNeverDropped(string markdown, string kept)
    {
        var back = NoteBlockMarkdownConverter.Deserialize(markdown);

        Assert.Contains(back, b => b.Content == kept);
    }

    [Fact]
    public void Deserialize_ALineThatIsNotProse_TakesNoWrappedLines()
    {
        // Indented code, raw HTML and a link definition each stay on their own line, as a line by
        // line reading has them; a definition shows no text.
        var code = NoteBlockMarkdownConverter.Deserialize("a\n\n    code one\n    code two\n\nb");
        Assert.Equal(new[] { "a", "code one", "code two", "b" }, code.Select(b => b.Content));

        var link = NoteBlockMarkdownConverter.Deserialize("a\n\n[ref]: https://example.com\n[other]: https://example.org\n\nb");
        Assert.Equal(new[] { "a", "", "", "b" }, link.Select(b => b.Content));
    }

    [Fact]
    public void Deserialize_QuoteHoldingAListOrAHeading_KeepsItsLineBreaks()
    {
        var list = NoteBlockMarkdownConverter.Deserialize("a\n\n> - one\n> - two");
        Assert.Equal("one\ntwo", list[1].Content);

        var heading = NoteBlockMarkdownConverter.Deserialize("a\n\n> # Title\n> body");
        Assert.Equal("Title\nbody", heading[1].Content);
    }

    [Theory]
    [InlineData("x  \n[^1]: foot text", "x\n[^1]: foot text")]
    [InlineData("x  \n*[HTML]: Hyper Text", "x\n*[HTML]: Hyper Text")]
    [InlineData("x  \n^^ footer text", "x\n^^ footer text")]
    [InlineData("x  \n~ term", "x\n~ term")]
    [InlineData("x\\\n::: tip", "x\n::: tip")]
    public void Deserialize_AHardBreakBeforeAnExtensionBlockStart_KeepsTheLineAsText(string paragraph, string expected)
    {
        var back = NoteBlockMarkdownConverter.Deserialize("intro\n\n" + paragraph);

        Assert.Equal(expected, back[1].Content);
    }

    [Fact]
    public void Deserialize_AContainerFenceUnderAParagraph_EndsIt()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("intro\n\nx  \n::: tip\nwarn text\n:::");

        Assert.Equal(new[] { "intro", "x", "", "warn text", "" }, back.Select(b => b.Content));
    }

    [Fact]
    public void RoundTrip_ACodeBlockHoldingAFence_KeepsItWhole()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("~~~\na\n```\nb\n~~~\n\nz");
        Assert.Equal(new[] { BlockType.Code, BlockType.Text }, back.Select(b => b.Type));
        Assert.Equal("a\n```\nb", Assert.IsType<CodePayload>(back[0].Payload).Source.Replace("\r\n", "\n"));

        var md = NoteBlockMarkdownConverter.Serialize(back).Replace("\r\n", "\n");
        // A fence without a language reads as the editor's default one.
        Assert.Equal("````csharp\na\n```\nb\n````\n\nz", md);

        var again = NoteBlockMarkdownConverter.Deserialize(md);
        Assert.Equal(new[] { BlockType.Code, BlockType.Text }, again.Select(b => b.Type));
        Assert.Equal("a\n```\nb", Assert.IsType<CodePayload>(again[0].Payload).Source.Replace("\r\n", "\n"));
    }

    [Fact]
    public void Deserialize_AYearUnderABullet_ContinuesTheItem()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("z\n\n- a\n1999. b");

        Assert.Equal(new[] { BlockType.Text, BlockType.BulletList }, back.Select(b => b.Type));
        Assert.Equal("a 1999. b", back[1].Content);
    }

    [Theory]
    [InlineData("<script>\nalert('hi')\n</script>", "")]
    [InlineData("<style>\nbody { color: red }\n</style>", "")]
    [InlineData("<script>\nunclosed()", "")]
    [InlineData("<div data-x=\"1 > 0\">inside</div>", "inside")]
    [InlineData("<div title=\"a > b\">x</div>", "x")]
    [InlineData("<div title='a > b'>x <!-- note --></div>", "x")]
    public void ToSpans_RawHtml_KeepsOnlyTheTextARenderedPageShows(string html, string expected)
    {
        var text = string.Concat(InlineMarkdownParser.ToSpans(html).OfType<TextSpan>().Select(s => s.Text));

        Assert.Equal(expected, text);
    }

    [Fact]
    public void RoundTrip_TextHoldingAnAngleBracket_KeepsIt()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("intro\n\n<div>A &amp; B &lt;tag&gt;</div>");
        Assert.Equal("A & B <tag>", back[1].Content);

        var md = NoteBlockMarkdownConverter.Serialize(back);
        Assert.Contains("A & B \\<tag>", md, StringComparison.Ordinal);
        Assert.Equal("A & B <tag>", NoteBlockMarkdownConverter.Deserialize(md)[1].Content);
    }

    [Fact]
    public void Deserialize_AVeryLongWrappedParagraph_JoinsInLinearTime()
    {
        // A join that rebuilt the paragraph per line took seconds here; built once it is well
        // under a second, so the bound only catches the quadratic shape.
        const int count = 40_000;
        var md = "intro\n\n" + string.Join("\n", Enumerable.Range(0, count).Select(n => "w" + n)) + "\n\nend";

        var watch = System.Diagnostics.Stopwatch.StartNew();
        var back = NoteBlockMarkdownConverter.Deserialize(md);
        watch.Stop();

        Assert.Equal(new[] { BlockType.Text, BlockType.Text, BlockType.Text }, back.Select(b => b.Type));
        Assert.Equal(string.Join(" ", Enumerable.Range(0, count).Select(n => "w" + n)), back[1].Content);
        Assert.True(watch.ElapsedMilliseconds < 5_000, $"took {watch.ElapsedMilliseconds} ms");
    }

    private static Block Rich(BlockType type, string text, int order, BlockPayload? payload = null)
    {
        // A heading reads back bold, so one is built bold to keep the second trip comparable.
        var bold = type is BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4;
        var block = new Block { Type = type, Order = order, Spans = new List<InlineSpan> { new TextSpan(text, new TextStyle(Bold: bold)) } };
        if (payload is not null)
            block.Payload = payload;
        return block;
    }

    private static Block Text(string text, int order) => new()
    {
        Type = BlockType.Text,
        Order = order,
        Spans = new List<InlineSpan> { InlineSpan.Plain(text) }
    };

    private static Block Column(int order, params Block[] children) => new()
    {
        Type = BlockType.ColumnGroup,
        Order = order,
        Children = children.ToList()
    };
}
