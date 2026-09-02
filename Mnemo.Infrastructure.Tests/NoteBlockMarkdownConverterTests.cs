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
        Assert.Equal("- parent\n  1. child\n     - [x] deep\n  - second\nafter", md.Replace("\r\n", "\n"));
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
