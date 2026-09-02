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
    public void PageBlock_PrintsResolvedTitle_NotItsOwnSpans()
    {
        var options = new NotePdfExportOptions
        {
            SubpageTitlesById = new Dictionary<string, string> { ["ref"] = "Chapter two" }
        };
        var typ = Compose(NoteWith(
            Leaf(BlockType.Page, "stale label", new PagePayload("ref")),
            Leaf(BlockType.Text, "after")), options);
        Assert.Contains("Chapter two", typ);
        Assert.Contains("after", typ);
        // The block's own spans are a cache of the title; the looked-up one wins.
        Assert.DoesNotContain("stale label", typ);
    }

    [Fact]
    public void PageBlock_UnresolvedReference_PrintsTheStandIn()
    {
        var options = new NotePdfExportOptions { MissingSubpageTitle = "Uten tittel" };
        var typ = Compose(NoteWith(Leaf(BlockType.Page, "x", new PagePayload("gone"))), options);
        Assert.Contains("Uten tittel", typ);
    }

    [Fact]
    public void RenderSubpageLinksFalse_DropsThePageRow()
    {
        var options = new NotePdfExportOptions
        {
            RenderSubpageLinks = false,
            SubpageTitlesById = new Dictionary<string, string> { ["ref"] = "Chapter two" }
        };
        var typ = Compose(NoteWith(
            Leaf(BlockType.Page, "x", new PagePayload("ref")),
            Leaf(BlockType.Text, "after")), options);
        Assert.DoesNotContain("Chapter two", typ);
        Assert.Contains("after", typ);
    }

    // === Page setup ===

    [Fact]
    public void Paper_MapsEveryKindToItsTypstName()
    {
        Assert.Contains("paper: \"a4\"", Compose(NoteWith(), new NotePdfExportOptions { Paper = NotePdfPaperKind.A4 }));
        Assert.Contains("paper: \"us-letter\"", Compose(NoteWith(), new NotePdfExportOptions { Paper = NotePdfPaperKind.Letter }));
        Assert.Contains("paper: \"us-legal\"", Compose(NoteWith(), new NotePdfExportOptions { Paper = NotePdfPaperKind.Legal }));
        Assert.Contains("paper: \"a5\"", Compose(NoteWith(), new NotePdfExportOptions { Paper = NotePdfPaperKind.A5 }));
    }

    [Fact]
    public void Landscape_FlipsTheSheetOnly()
    {
        Assert.Contains("flipped: true", Compose(NoteWith(), new NotePdfExportOptions { Landscape = true }));
        Assert.DoesNotContain("flipped:", Compose(NoteWith(), new NotePdfExportOptions { Landscape = false }));
    }

    [Fact]
    public void Margins_MatchThePresetsTheDialogAdvertises()
    {
        Assert.Contains("margin: 2cm", Compose(NoteWith(), new NotePdfExportOptions { Margin = NotePdfMarginPreset.Normal }));
        Assert.Contains("margin: 1.27cm", Compose(NoteWith(), new NotePdfExportOptions { Margin = NotePdfMarginPreset.Narrow }));
        Assert.Contains("margin: 3.18cm", Compose(NoteWith(), new NotePdfExportOptions { Margin = NotePdfMarginPreset.Wide }));
    }

    [Fact]
    public void PageNumbers_Off_EmitsNoNumbering()
    {
        var typ = Compose(NoteWith(), new NotePdfExportOptions { PageNumberAlignment = NotePdfPageNumberAlignment.None });
        Assert.DoesNotContain("numbering:", typ);
        Assert.DoesNotContain("number-align:", typ);
    }

    [Fact]
    public void PageNumbers_CountingFormsArePatterns()
    {
        var one = Compose(NoteWith(), new NotePdfExportOptions
        {
            PageNumberFormat = NotePdfPageNumberFormat.CurrentPage,
            PageNumberAlignment = NotePdfPageNumberAlignment.Left
        });
        Assert.Contains("numbering: \"1\", number-align: left", one);

        var both = Compose(NoteWith(), new NotePdfExportOptions
        {
            PageNumberFormat = NotePdfPageNumberFormat.CurrentAndTotalPages,
            PageNumberAlignment = NotePdfPageNumberAlignment.Right
        });
        Assert.Contains("numbering: \"1 / 1\", number-align: right", both);
    }

    [Fact]
    public void PageNumbers_WordedFormIsAFunction_SoLettersStayLetters()
    {
        var typ = Compose(NoteWith(), new NotePdfExportOptions
        {
            PageNumberFormat = NotePdfPageNumberFormat.PageOfTotal,
            PageNumberWordedFormat = "Side {0} av {1}"
        });
        // A pattern would count the "a" in "av" and print "Side 1 bv 2".
        Assert.Contains("numbering: (..n) => [Side #n.pos().at(0) av #n.pos().at(1)], number-align: center", typ);
    }

    [Fact]
    public void PageNumbers_WordedFormWithoutBothSlots_FallsBackToTheDefaultWording()
    {
        var typ = Compose(NoteWith(), new NotePdfExportOptions
        {
            PageNumberFormat = NotePdfPageNumberFormat.PageOfTotal,
            PageNumberWordedFormat = "page {0}"
        });
        Assert.Contains("(..n) => [Page #n.pos().at(0) of #n.pos().at(1)]", typ);
    }

    // === Masthead ===

    [Fact]
    public void Tags_RenderAsPillsTintedByLabel()
    {
        var note = new Note { Title = "T", Tags = ["physics", "physics"] };
        var typ = Compose(note);
        // Same label, same hue: the tint is derived, not assigned in order.
        var hue = typ.Split("oklch(93%, 0.055, ")[1].Split("deg")[0];
        Assert.Equal(2, typ.Split($"oklch(93%, 0.055, {hue}deg)").Length - 1);
        Assert.Contains("radius: 999pt", typ);
    }

    [Fact]
    public void Tags_GoGreyWhenColoursAreOff()
    {
        var note = new Note { Title = "T", Tags = ["physics"] };
        var typ = Compose(note, new NotePdfExportOptions { RenderColors = false });
        Assert.DoesNotContain("oklch(", typ);
        Assert.Contains("#box(fill: rgb(\"#f2f2f3\")", typ);
    }

    [Fact]
    public void Tags_AreOmittedWhenExcludedOrBlank()
    {
        var note = new Note { Title = "T", Tags = ["physics"] };
        Assert.DoesNotContain("radius: 999pt", Compose(note, new NotePdfExportOptions { IncludeTags = false }));

        var blank = new Note { Title = "T", Tags = ["   "] };
        Assert.DoesNotContain("radius: 999pt", Compose(blank));
    }

    [Fact]
    public void MastheadRule_OnlyAppearsWhenThereIsAMasthead()
    {
        const string Rule = "#line(length: 100%";
        var titled = new Note { Title = "T", Blocks = [Leaf(BlockType.Text, "body")] };
        Assert.Contains(Rule, Compose(titled));

        var tagsOnly = new Note { Title = "T", Tags = ["physics"], Blocks = [Leaf(BlockType.Text, "body")] };
        Assert.Contains(Rule, Compose(tagsOnly, new NotePdfExportOptions { IncludeNoteTitle = false }));

        var bare = new Note { Title = "T", Blocks = [Leaf(BlockType.Text, "body")] };
        Assert.DoesNotContain(Rule, Compose(bare, new NotePdfExportOptions { IncludeNoteTitle = false }));
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
    public void CroppedImage_WithAStoredWidth_EmitsAClippedFrameAtThatWidth()
    {
        var block = Leaf(BlockType.Image, "", new ImagePayload(
            "attachment:x", "", 200, "center", new ImageCrop(0.25, 0.5, 0.5, 0.25, 2)));
        var typ = Compose(NoteWith(block), assets: new FakeAssetResolver("/assets/x.png"));
        Assert.Contains(
            "#align(center)[#layout(size => { let fw = 150pt; let fh = fw / 2; "
            + "box(width: fw, height: fh, clip: true, place(top + left, dx: -0.5 * fw, dy: -2 * fh, "
            + "image(\"/assets/x.png\", width: fw / 0.5, height: fh / 0.25, fit: \"stretch\"))) })",
            typ,
            StringComparison.Ordinal);
    }

    [Fact]
    public void CroppedImage_NeverResized_TakesTheAvailableWidth()
    {
        // Typst cannot derive a height from a ratio without an absolute width, and a width of 0 is
        // what an image nobody has dragged carries, so the frame reads what `layout` hands it.
        var block = Leaf(BlockType.Image, "", new ImagePayload(
            "attachment:x", "", 0, "left", new ImageCrop(0, 0, 0.8, 0.6, 1.5)));
        var typ = Compose(NoteWith(block), assets: new FakeAssetResolver("/assets/x.png"));
        Assert.Contains(
            "#align(left)[#layout(size => { let fw = size.width; let fh = fw / 1.5; "
            + "box(width: fw, height: fh, clip: true, place(top + left, dx: -0 * fw, dy: -0 * fh, "
            + "image(\"/assets/x.png\", width: fw / 0.8, height: fh / 0.6, fit: \"stretch\"))) })",
            typ,
            StringComparison.Ordinal);
    }

    [Fact]
    public void CroppedImage_HoldsItsRatiosFinerThanAPointMeasurement()
    {
        // A window pinned to the source's far corner, at thirds. Rounded the way a length is, the
        // placed image lands short of the clip box and a sliver of page shows along two edges.
        var block = Leaf(BlockType.Image, "", new ImagePayload(
            "attachment:x", "", 400, "left", new ImageCrop(2d / 3, 2d / 3, 1d / 3, 1d / 3, 1)));
        var typ = Compose(NoteWith(block), assets: new FakeAssetResolver("/assets/x.png"));
        Assert.Contains("dx: -2 * fw, dy: -2 * fh", typ, StringComparison.Ordinal);
        Assert.Contains("width: fw / 0.333333, height: fh / 0.333333", typ, StringComparison.Ordinal);
    }

    [Fact]
    public void CroppedImage_KeepsItsCaption()
    {
        var block = Leaf(BlockType.Image, "a detail", new ImagePayload(
            "attachment:x", "a detail", 200, "center", new ImageCrop(0, 0, 0.5, 0.5, 1)));
        var typ = Compose(NoteWith(block), assets: new FakeAssetResolver("/assets/x.png"));
        Assert.Contains("fit: \"stretch\"))) })#v(4pt)#text(size: ", typ, StringComparison.Ordinal);
        Assert.Contains("a detail", typ, StringComparison.Ordinal);
    }

    [Fact]
    public void ImageWithoutACrop_EmitsThePlainImageCall()
    {
        // The frame markup is for cropped images only; every other image keeps the bytes it had.
        var block = Leaf(BlockType.Image, "", new ImagePayload("attachment:x", "", 200, "center"));
        var typ = Compose(NoteWith(block), assets: new FakeAssetResolver("/assets/x.png"));
        Assert.Contains(
            "#align(center)[#image(\"/assets/x.png\", width: 150pt)]",
            typ,
            StringComparison.Ordinal);
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

    [TypstFact]
    public void KitchenSink_CompilesWithVendoredTypst()
    {
        var note = BuildKitchenSinkNote();
        var typ = Compose(note, new NotePdfExportOptions(), new FakeAssetResolver("/img.png"));

        var (exit, stderr) = NoteTypstToolchain.Compile(
            typ,
            new Dictionary<string, byte[]> { ["img.png"] = OnePixelPng });

        Assert.True(exit == 0, $"typst compile failed (exit {exit}):\n{stderr}\n\n--- source ---\n{typ}");
    }

    [TypstFact]
    public void NewPageSetup_CompilesWithVendoredTypst()
    {
        var note = new Note
        {
            Title = "Landscape legal",
            Tags = ["physics", "term 2"],
            Blocks = [Leaf(BlockType.Text, "body"), Leaf(BlockType.Page, "x", new PagePayload("ref"))]
        };
        var typ = Compose(note, new NotePdfExportOptions
        {
            Paper = NotePdfPaperKind.Legal,
            Landscape = true,
            Margin = NotePdfMarginPreset.Wide,
            PageNumberFormat = NotePdfPageNumberFormat.PageOfTotal,
            PageNumberWordedFormat = "Side {0} av {1}",
            SubpageTitlesById = new Dictionary<string, string> { ["ref"] = "Chapter two" }
        });

        var (exit, stderr) = NoteTypstToolchain.Compile(typ);
        Assert.True(exit == 0, $"typst compile failed (exit {exit}):\n{stderr}\n\n--- source ---\n{typ}");
    }

    [TypstFact]
    public void CroppedImages_CompileWithVendoredTypst()
    {
        // The clipped frame is the one piece of markup here that nests a closure, a layout query
        // and a placement, so a string assertion proves the shape and this proves it parses.
        var note = NoteWith(
            Leaf(BlockType.Image, "sized", new ImagePayload(
                "attachment:x", "sized", 200, "center", new ImageCrop(0.25, 0.5, 0.5, 0.25, 2))),
            Leaf(BlockType.Image, "unsized", new ImagePayload(
                "attachment:x", "unsized", 0, "left", new ImageCrop(0, 0, 0.8, 0.6, 1.5))));
        var typ = Compose(note, new NotePdfExportOptions(), new FakeAssetResolver("/img.png"));

        var (exit, stderr) = NoteTypstToolchain.Compile(
            typ,
            new Dictionary<string, byte[]> { ["img.png"] = OnePixelPng });

        Assert.True(exit == 0, $"typst compile failed (exit {exit}):\n{stderr}\n\n--- source ---\n{typ}");
    }

    [TypstFact]
    public void BacktickEquation_CompilesWithVendoredTypst()
    {
        var note = NoteWith(Leaf(BlockType.Equation, "ignored", new EquationPayload("\\text{a `b` c} + x")));
        var typ = Compose(note);

        var (exit, stderr) = NoteTypstToolchain.Compile(typ);
        Assert.True(exit == 0, $"typst compile failed (exit {exit}):\n{stderr}\n\n--- source ---\n{typ}");
    }

    [Fact]
    public void NestedList_EmitsChildrenInsideTheItemWithDepthMarkers()
    {
        var parent = Leaf(BlockType.BulletList, "parent");
        var child = Leaf(BlockType.NumberedList, "child");
        var deep = Leaf(BlockType.BulletList, "deep");
        child.Children = [deep];
        parent.Children = [child];

        var typ = Compose(NoteWith(parent));

        // The sub-list sits inside its parent's content block; the marker and numbering style
        // follow the depth the editor draws: dot, then letters, then a square.
        Assert.Contains(
            "#list(marker: box(baseline: -0.05em, circle(radius: 0.11em, fill: black)))[parent\n" +
            "#enum(start: 1, numbering: \"a.\")[child\n" +
            "#list(marker: box(baseline: -0.05em, rect(width: 0.2em, height: 0.2em, fill: black)))[deep]\n\n" +
            "]\n\n" +
            "]\n\n",
            typ);
    }

    [Fact]
    public void NestedChecklist_IndentsItsChildrenByHand()
    {
        var todo = Leaf(BlockType.Checklist, "todo", new ChecklistPayload(false));
        todo.Children = [Leaf(BlockType.BulletList, "step")];

        var typ = Compose(NoteWith(todo));

        Assert.Contains(
            "\\[ \\] todo\n\n#pad(left: 1.5em)[\n\n" +
            "#list(marker: box(baseline: -0.05em, circle(radius: 0.11em, stroke: 0.6pt + black)))[step]\n\n" +
            "]\n\n",
            typ);
    }

    [Fact]
    public void FlatList_OutputIsUnchangedByNesting()
    {
        // No children, no extra bytes: every existing note's list renders as before.
        var typ = Compose(NoteWith(Leaf(BlockType.BulletList, "point"), Leaf(BlockType.NumberedList, "one")));
        Assert.Contains("#list(marker: box(baseline: -0.05em, circle(radius: 0.11em, fill: black)))[point]\n\n", typ);
        Assert.Contains("#enum(start: 1)[one]\n\n", typ);
    }

    [TypstFact]
    public void NestedLists_CompileWithVendoredTypst()
    {
        var bullet = Leaf(BlockType.BulletList, "bullet");
        var numbered = Leaf(BlockType.NumberedList, "numbered");
        var deeper = Leaf(BlockType.NumberedList, "deeper");
        var deepest = Leaf(BlockType.BulletList, "deepest");
        var todo = Leaf(BlockType.Checklist, "todo", new ChecklistPayload(true));
        deeper.Children = [deepest, Leaf(BlockType.Text, "a nested paragraph")];
        numbered.Children = [deeper];
        todo.Children = [Leaf(BlockType.Checklist, "sub-task", new ChecklistPayload(false))];
        bullet.Children = [numbered, todo];

        var typ = Compose(NoteWith(bullet, Leaf(BlockType.Text, "after")));

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
