using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Pdf;

namespace Mnemo.Infrastructure.Tests;

public sealed class NoteTypstDocumentComposerTests
{
    private sealed class FakeAssetResolver(string? result) : INoteTypstAssetResolver
    {
        public string? ResolveImagePath(string reference) => result;
    }

    private static string Compose(Note note, NotePdfExportOptions? options = null, INoteTypstAssetResolver? assets = null) =>
        NoteTypstDocumentComposer.Compose(note, options ?? new NotePdfExportOptions(), assets);

    private static Note NoteWith(params Block[] blocks) => new() { Title = "T", Blocks = blocks.ToList() };

    private static Block Leaf(BlockType type, string text, BlockPayload? payload = null) => new()
    {
        Id = type + "-id",
        Type = type,
        Spans = [InlineSpan.Plain(text)],
        Payload = payload ?? new EmptyPayload()
    };

    // === Golden output per block type ===

    [Fact]
    public void Heading1_EmitsBoldSizedText()
    {
        var typ = Compose(NoteWith(Leaf(BlockType.Heading1, "Chapter")), new NotePdfExportOptions { BaseFontSizePt = 11f });
        Assert.Contains("#text(weight: \"bold\", size: 21pt)[Chapter]", typ);
    }

    [Fact]
    public void BulletList_UsesDrawnDiscMarker()
    {
        var typ = Compose(NoteWith(Leaf(BlockType.BulletList, "point")));
        Assert.Contains("#list(marker: box(baseline: -0.05em, circle(radius: 0.11em, fill: black)))[point]", typ);
    }

    [Fact]
    public void NumberedList_PreservesStartIndex()
    {
        var block = Leaf(BlockType.NumberedList, "third");
        block.Meta["listNumberIndex"] = 3;
        var typ = Compose(NoteWith(block));
        Assert.Contains("#enum(start: 3)[third]", typ);
    }

    [Fact]
    public void Checklist_EmitsAsciiMarker()
    {
        var checked_ = Compose(NoteWith(Leaf(BlockType.Checklist, "done", new ChecklistPayload(true))));
        var unchecked_ = Compose(NoteWith(Leaf(BlockType.Checklist, "todo", new ChecklistPayload(false))));
        Assert.Contains("\\[x\\] done", checked_);
        Assert.Contains("\\[ \\] todo", unchecked_);
    }

    [Fact]
    public void Quote_EmitsLeftBorderedItalicBlock()
    {
        var typ = Compose(NoteWith(Leaf(BlockType.Quote, "wise words")));
        Assert.Contains("#block(inset: (left: 10pt), stroke: (left: 3pt + rgb(\"#9e9e9e\")))[#emph[wise words]]", typ);
    }

    [Fact]
    public void Code_EmitsRawWithLangAndEscapesStringLiteral()
    {
        var block = Leaf(BlockType.Code, "unused", new CodePayload("python", "print(\"a\\tb\")"));
        var typ = Compose(NoteWith(block));
        // Backslash doubled and quote escaped so the source survives as a Typst string literal.
        Assert.Contains("#raw(\"print(\\\"a\\\\tb\\\")\", block: true, lang: \"python\")", typ);
    }

    [Fact]
    public void Equation_UsesDisplayStyleMitex()
    {
        var block = Leaf(BlockType.Equation, "ignored", new EquationPayload("\\sum_{i=1}^{n} i"));
        var typ = Compose(NoteWith(block));
        Assert.Contains("#mitex(`\\displaystyle \\sum_{i=1}^{n} i`)", typ);
    }

    [Fact]
    public void EquationWithBacktick_UsesLeadingNewlineFence()
    {
        var block = Leaf(BlockType.Equation, "ignored", new EquationPayload("x + `a"));
        var typ = Compose(NoteWith(block));
        // A backtick in the LaTeX forces a >=3 backtick block fence with a leading newline.
        Assert.Contains("#mitex(```\n\\displaystyle x + `a\n```)", typ);
    }

    [Fact]
    public void InlineEquationAndFraction_EmitMitex()
    {
        var block = new Block
        {
            Type = BlockType.Text,
            Spans =
            [
                InlineSpan.Plain("a "),
                new EquationSpan("\\alpha"),
                new FractionSpan(1, 2)
            ]
        };
        var typ = Compose(NoteWith(block));
        Assert.Contains("#mitex(`\\alpha`)", typ);
        Assert.Contains("#mitex(`\\frac{1}{2}`)", typ);
    }

    [Fact]
    public void SafeLinkEmitsLink_UnsafeLinkDoesNot()
    {
        var block = new Block
        {
            Type = BlockType.Text,
            Spans =
            [
                new TextSpan("open", new TextStyle(LinkUrl: "https://example.com")),
                new TextSpan("evil", new TextStyle(LinkUrl: "javascript:alert(1)"))
            ]
        };
        var typ = Compose(NoteWith(block));
        Assert.Contains("#link(\"https://example.com\")", typ);
        Assert.DoesNotContain("javascript:", typ);
        Assert.Contains("evil", typ); // still rendered, just not as a link
    }

    [Fact]
    public void EscapesMarkupMetacharacters()
    {
        var typ = Compose(NoteWith(Leaf(BlockType.Text, "a # b * c _ d [e] = f - g")));
        Assert.Contains("a \\# b \\* c \\_ d \\[e\\] \\= f \\- g", typ);
    }

    [Fact]
    public void PageBlock_IsSkipped()
    {
        var typ = Compose(NoteWith(
            Leaf(BlockType.Page, "sub-note", new PagePayload("ref")),
            Leaf(BlockType.Text, "after")));
        Assert.Contains("after", typ);
        Assert.DoesNotContain("sub-note", typ);
    }

    [Fact]
    public void TwoColumn_EmitsGridWithClampedRatio()
    {
        var block = new Block
        {
            Type = BlockType.TwoColumn,
            Payload = new TwoColumnPayload(0.7),
            Children =
            [
                new Block { Type = BlockType.ColumnGroup, Order = 0, Children = [Leaf(BlockType.Text, "L")] },
                new Block { Type = BlockType.ColumnGroup, Order = 1, Children = [Leaf(BlockType.Text, "R")] }
            ]
        };
        var typ = Compose(NoteWith(block));
        Assert.Contains("#grid(columns: (0.7fr, 0.3fr), gutter: 12pt,", typ);
    }

    [Fact]
    public void UnresolvedImage_FallsBackToAltText()
    {
        var block = Leaf(BlockType.Image, "", new ImagePayload("attachment:missing", "a diagram"));
        var typ = Compose(NoteWith(block), assets: new FakeAssetResolver(null));
        Assert.Contains("\\[Image: a diagram\\]", typ);
        Assert.DoesNotContain("#image(", typ);
    }

    [Fact]
    public void ResolvedImage_EmitsRootRelativeImageCall()
    {
        var block = Leaf(BlockType.Image, "", new ImagePayload("attachment:x", "cap", 200, "center"));
        var typ = Compose(NoteWith(block), assets: new FakeAssetResolver("/assets/x.png"));
        Assert.Contains("#align(center)[#image(\"/assets/x.png\", width: 150pt)", typ);
        Assert.Contains("cap", typ);
    }

    [Fact]
    public void RenderImagesFalse_OmitsImageAndSketch()
    {
        var options = new NotePdfExportOptions { RenderImages = false };
        var note = NoteWith(
            Leaf(BlockType.Image, "", new ImagePayload("attachment:x", "cap")),
            Leaf(BlockType.Sketch, "A -> B"));
        var typ = Compose(note, options, new FakeAssetResolver("/assets/x.png"));
        Assert.DoesNotContain("#image(", typ);
    }

    [Fact]
    public void MismatchedPayload_DoesNotRenderWrongKind()
    {
        // Block typed Equation but carrying an ImagePayload: the composer must not read the image
        // path; it falls back to spans as the LaTeX source.
        var block = new Block
        {
            Type = BlockType.Equation,
            Spans = [InlineSpan.Plain("E=mc^2")],
            Payload = new ImagePayload("attachment:should-not-appear")
        };
        var typ = Compose(NoteWith(block));
        Assert.DoesNotContain("should-not-appear", typ);
        Assert.Contains("#mitex(", typ);
    }

    // === Compile-smoke against the vendored typst binary (offline) ===

    // 1x1 RGBA PNG with a valid IDAT CRC (Typst's decoder rejects a bad CRC).
    private static readonly byte[] OnePixelPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4////fwAJ+wP99djxmgAAAABJRU5ErkJggg==");

    [Fact]
    public void KitchenSink_CompilesWithVendoredTypst()
    {
        if (!NoteTypstToolchain.Available)
            return; // Typst binary not restored (run scripts/restore-typst); nothing to compile against.

        var note = BuildKitchenSinkNote();
        var typ = Compose(note, new NotePdfExportOptions(), new FakeAssetResolver("/img.png"));

        var (exit, stderr) = NoteTypstToolchain.Compile(
            typ,
            new Dictionary<string, byte[]> { ["img.png"] = OnePixelPng });

        Assert.True(exit == 0, $"typst compile failed (exit {exit}):\n{stderr}\n\n--- source ---\n{typ}");
    }

    [Fact]
    public void BacktickEquation_CompilesWithVendoredTypst()
    {
        if (!NoteTypstToolchain.Available)
            return; // Typst binary not restored (run scripts/restore-typst); nothing to compile against.

        var note = NoteWith(Leaf(BlockType.Equation, "ignored", new EquationPayload("\\text{a `b` c} + x")));
        var typ = Compose(note);

        var (exit, stderr) = NoteTypstToolchain.Compile(typ);
        Assert.True(exit == 0, $"typst compile failed (exit {exit}):\n{stderr}\n\n--- source ---\n{typ}");
    }

    private static Note BuildKitchenSinkNote()
    {
        var numbered = Leaf(BlockType.NumberedList, "second");
        numbered.Meta["listNumberIndex"] = 2;

        return new Note
        {
            Title = "Kitchen Sink # & <all> blocks",
            Blocks =
            [
                Leaf(BlockType.Heading1, "Heading one"),
                Leaf(BlockType.Heading2, "Heading two"),
                Leaf(BlockType.Heading3, "Heading three"),
                Leaf(BlockType.Heading4, "Heading four"),
                new Block
                {
                    Type = BlockType.Text,
                    Spans =
                    [
                        new TextSpan("Rich ", TextStyle.Default),
                        new TextSpan("bold", new TextStyle(Bold: true)),
                        new TextSpan(" ", TextStyle.Default),
                        new TextSpan("italic", new TextStyle(Italic: true)),
                        new TextSpan(" ", TextStyle.Default),
                        new TextSpan("code()", new TextStyle(Code: true)),
                        new TextSpan(" ", TextStyle.Default),
                        new TextSpan("link", new TextStyle(LinkUrl: "https://example.com")),
                        new TextSpan(" with a fraction ", TextStyle.Default),
                        new FractionSpan(3, 4),
                        new TextSpan(" and inline math ", TextStyle.Default),
                        new EquationSpan("\\alpha^2 + \\beta")
                    ]
                },
                Leaf(BlockType.BulletList, "bullet with special # * chars"),
                numbered,
                Leaf(BlockType.Checklist, "checked", new ChecklistPayload(true)),
                Leaf(BlockType.Quote, "a quotation"),
                Leaf(BlockType.Code, "unused", new CodePayload("python", "def f(x):\n    return \"x\\t\" + x")),
                new Block { Type = BlockType.Divider },
                Leaf(BlockType.Equation, "ignored", new EquationPayload("\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}")),
                Leaf(BlockType.Image, "", new ImagePayload("attachment:x", "an image caption", 120, "center")),
                Leaf(BlockType.Sketch, "A -> B"),
                new Block
                {
                    Type = BlockType.TwoColumn,
                    Payload = new TwoColumnPayload(0.6),
                    Children =
                    [
                        new Block { Type = BlockType.ColumnGroup, Order = 0, Children = [Leaf(BlockType.Text, "left column")] },
                        new Block { Type = BlockType.ColumnGroup, Order = 1, Children = [Leaf(BlockType.Text, "right column")] }
                    ]
                },
                Leaf(BlockType.Page, "should be skipped", new PagePayload("ref"))
            ]
        };
    }
}
