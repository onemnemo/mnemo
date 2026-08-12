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
