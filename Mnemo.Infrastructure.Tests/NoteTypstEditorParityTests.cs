using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Pdf;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// The composer against the shapes the editor actually saves, rather than one plain span per
/// block, and against the editor's own layout where the page is meant to read like the screen.
/// </summary>
public sealed class NoteTypstEditorParityTests
{
    private static string Compose(Note note, NotePdfExportOptions? options = null) =>
        NoteTypstDocumentComposer.Compose(note, options ?? new NotePdfExportOptions(), null);

    private static Note NoteWith(params Block[] blocks) => new() { Title = "T", Blocks = blocks.ToList() };

    private static Block Paragraph(params InlineSpan[] spans) => new() { Type = BlockType.Text, Spans = spans.ToList() };

    private static Block Leaf(BlockType type, params InlineSpan[] spans) => new() { Type = type, Spans = spans.ToList() };

    private static Block Row(params string[] cells) => new()
    {
        Type = BlockType.TableRow,
        Children = cells.Select((text, i) => new Block { Type = BlockType.TableCell, Order = i, Spans = [InlineSpan.Plain(text)] }).ToList()
    };

    private static Block Table(params Block[] rows) => new()
    {
        Type = BlockType.Table,
        Children = rows.Select((row, i) => { row.Order = i; return row; }).ToList()
    };

    private static int Occurrences(string text, string needle) =>
        (text.Length - text.Replace(needle, string.Empty, StringComparison.Ordinal).Length) / needle.Length;

    // === A table's children are its own structure ===

    [Fact]
    public void Table_cells_print_once()
    {
        var typ = Compose(NoteWith(
            Table(Row("Type of substance", "Dissolves in"), Row("Polar substances", "Water")),
            Paragraph(InlineSpan.Plain("after"))));

        foreach (var cell in new[] { "Type of substance", "Dissolves in", "Polar substances", "Water" })
            Assert.Equal(1, Occurrences(typ, cell));
        Assert.True(typ.IndexOf("#table(", StringComparison.Ordinal) < typ.IndexOf("after", StringComparison.Ordinal));
    }

    // === An embedded expression ends before the next span ===

    [Fact]
    public void Bold_run_before_a_parenthesis_is_terminated()
    {
        var typ = Compose(NoteWith(Paragraph(
            new TextSpan("Uønskede produkter: ", new TextStyle(Bold: true)),
            InlineSpan.Plain("(fra side-reaksjoner)"))));
        Assert.Contains("#strong[Uønskede produkter: ];(fra side\\-reaksjoner)", typ);
    }

    [Fact]
    public void Link_before_a_bracket_is_terminated()
    {
        var typ = Compose(NoteWith(Paragraph(
            new TextSpan("source", new TextStyle(LinkUrl: "https://example.com")),
            InlineSpan.Plain("[1]"))));
        Assert.Contains("#link(\"https://example.com\")[#text(fill: rgb(\"#1d4ed8\"))[#underline[source]]];\\[1\\]", typ);
    }

    [Fact]
    public void Equation_before_a_parenthesis_is_terminated()
    {
        var typ = Compose(NoteWith(Paragraph(new EquationSpan("K_c"), InlineSpan.Plain("(at 25 °C)"))));
        Assert.Contains("#mi(`K_c`);(at 25 °C)", typ);
    }

    [Fact]
    public void Code_run_before_a_full_stop_is_terminated()
    {
        var typ = Compose(NoteWith(Paragraph(new TextSpan("main()", new TextStyle(Code: true)), InlineSpan.Plain("."))));
        Assert.Contains("[#raw(\"main()\")];\\.", typ);
    }

    [Fact]
    public void Plain_text_is_not_terminated()
    {
        var typ = Compose(NoteWith(Paragraph(
            InlineSpan.Plain("a "),
            new TextSpan("b", new TextStyle(Italic: true)),
            InlineSpan.Plain(" c"))));
        Assert.Contains("a #emph[b]; c\n\n", typ);
    }

    // === A newline inside a line is the soft break the editor shows ===

    [Fact]
    public void Newline_before_an_inline_equation_breaks_the_line()
    {
        var typ = Compose(NoteWith(Paragraph(
            InlineSpan.Plain("For a reaction of the form:\n"),
            new EquationSpan("aA + bB \\rightleftharpoons cC + dD"))));
        Assert.Contains("For a reaction of the form:\\\n#mi(`aA + bB \\rightleftharpoons cC + dD`);\n\n", typ);
    }

    [Fact]
    public void Newline_after_an_inline_equation_breaks_the_line()
    {
        var typ = Compose(NoteWith(Leaf(BlockType.BulletList,
            InlineSpan.Plain("In pure water:\n"),
            new EquationSpan("Ksp = x^2"),
            InlineSpan.Plain("\nHere, x is the solubility."))));
        Assert.Contains("[In pure water:\\\n#mi(`Ksp = x^2`);\\\nHere, x is the solubility\\.]", typ);
    }

    [Fact]
    public void Trailing_newline_at_the_end_of_a_block_is_not_a_break()
    {
        var typ = Compose(NoteWith(Paragraph(InlineSpan.Plain("Then we get:\n"))));
        Assert.Contains("Then we get:\n\n", typ);
        Assert.DoesNotContain("\\\n", typ);
    }

    [Fact]
    public void Either_line_ending_breaks_once()
    {
        var typ = Compose(NoteWith(Paragraph(InlineSpan.Plain("first\r\nsecond\rthird\n"))));
        Assert.Contains("first\\\nsecond\\\nthird\n\n", typ);
        Assert.DoesNotContain("\r", typ);
    }

    // === The page's rhythm is the editor's ===

    [Fact]
    public void Preamble_sets_the_editor_rhythm()
    {
        var typ = Compose(NoteWith(), new NotePdfExportOptions { BaseFontSizePt = 11f });
        // A 1.65 line height over a 0.71em cap height, and a 6px gap between blocks on a 16px body.
        Assert.Contains("#set par(leading: 0.94em, spacing: 14.465pt)\n#set block(spacing: 14.465pt)\n", typ);
        Assert.Contains("#show heading: set strong(delta: 0)\n", typ);
    }

    [Theory]
    [InlineData(1, "size: 19.25pt, weight: 700, tracking: -0.02em", "0.54em", "32.368pt", "13.118pt")]
    [InlineData(2, "size: 15.125pt, weight: 600, tracking: -0.015em", "0.59em", "28.882pt", "11.007pt")]
    [InlineData(3, "size: 12.375pt, weight: 600, tracking: -0.01em", "0.64em", "22.88pt", "10.505pt")]
    [InlineData(4, "size: 11pt, weight: 600", "0.69em", "19.965pt", "10.34pt")]
    public void Headings_take_the_editor_scale(int level, string text, string leading, string above, string below)
    {
        var typ = Compose(NoteWith(), new NotePdfExportOptions { BaseFontSizePt = 11f });
        Assert.Contains($"#show heading.where(level: {level}): set text({text})\n", typ);
        Assert.Contains($"#show heading.where(level: {level}): set par(leading: {leading})\n", typ);
        Assert.Contains($"#show heading.where(level: {level}): set block(above: {above}, below: {below})\n", typ);
    }

    [Fact]
    public void Rhythm_scales_with_the_base_size()
    {
        var typ = Compose(NoteWith(), new NotePdfExportOptions { BaseFontSizePt = 12f });
        Assert.Contains("#set par(leading: 0.94em, spacing: 15.78pt)\n", typ);
        Assert.Contains("#show heading.where(level: 1): set text(size: 21pt, weight: 700, tracking: -0.02em)\n", typ);
    }

    [Fact]
    public void Heading_blocks_are_real_headings()
    {
        var typ = Compose(NoteWith(Leaf(BlockType.Heading2, InlineSpan.Plain("The reaction quotient (Q)"))));
        Assert.Contains("#heading(level: 2)[The reaction quotient (Q)]\n\n", typ);
    }

    [Fact]
    public void Paragraph_nested_under_a_list_item_starts_its_own_paragraph()
    {
        var item = Leaf(BlockType.BulletList, InlineSpan.Plain("If Q = K"));
        item.Children = [Paragraph(InlineSpan.Plain("The system is at equilibrium."))];
        var typ = Compose(NoteWith(item));
        Assert.Contains("[If Q \\= K\n\nThe system is at equilibrium\\.\n\n]\n\n", typ);
    }

    [Fact]
    public void Quote_and_callout_stand_off_their_neighbours_as_on_screen()
    {
        // A 10px margin and the padding the editor gives each, with the line box's slack inside.
        var typ = Compose(NoteWith(
            Leaf(BlockType.Quote, InlineSpan.Plain("a voice")),
            Leaf(BlockType.Callout, InlineSpan.Plain("an aside"))), new NotePdfExportOptions { BaseFontSizePt = 11f });
        Assert.Contains("#block(above: 12.045pt, below: 12.045pt, inset: (top: 6.545pt, bottom: 6.545pt, left: 11pt), stroke: (left: 3pt + rgb(\"#9e9e9e\")))[#emph[a voice]]", typ);
        Assert.Contains("#block(width: 100%, above: 12.045pt, below: 12.045pt, inset: (top: 13.42pt, bottom: 13.42pt, x: 11pt), radius: 3pt, fill: rgb(\"#f2f2f3\"))[an aside]", typ);
    }

    // === The composer's own output parses ===

    [TypstFact]
    public void Editor_shapes_compile_with_vendored_typst()
    {
        var withChildren = Paragraph(new EquationSpan("aA + bB"));
        withChildren.Children = [Paragraph(new EquationSpan("K = 1")), Leaf(BlockType.Heading4, InlineSpan.Plain("nested"))];

        var note = new Note
        {
            Title = "Chemistry",
            Blocks =
            [
                Leaf(BlockType.Heading1, new TextSpan("Equilibria", new TextStyle(Bold: true))),
                Paragraph(new TextSpan("Uønskede produkter: ", new TextStyle(Bold: true)), InlineSpan.Plain("(fra side-reaksjoner)")),
                Paragraph(new TextSpan("source", new TextStyle(LinkUrl: "https://example.com")), InlineSpan.Plain("[1]")),
                Paragraph(new EquationSpan("K_c"), InlineSpan.Plain("(at 25 °C)")),
                Paragraph(new TextSpan("main()", new TextStyle(Code: true)), InlineSpan.Plain(".")),
                Paragraph(new TextSpan("all", new TextStyle(Bold: true, Italic: true, Underline: true, Highlight: true, Strikethrough: true)), InlineSpan.Plain(";[x](y).z")),
                Leaf(BlockType.Heading2, new EquationSpan("Q"), InlineSpan.Plain(" (Q)")),
                Leaf(BlockType.Heading3, InlineSpan.Plain("General formula\n")),
                Paragraph(InlineSpan.Plain("For a reaction of the form:\n"), new EquationSpan("aA + bB \\rightleftharpoons cC + dD")),
                Leaf(BlockType.BulletList, InlineSpan.Plain("In pure water:\n"), new EquationSpan("Ksp = x^2"), InlineSpan.Plain("\nHere, x is the solubility.")),
                Leaf(BlockType.Checklist, new TextSpan("done", new TextStyle(Bold: true)), InlineSpan.Plain("(really)")),
                Leaf(BlockType.Quote, InlineSpan.Plain("first line\r\nsecond line")),
                Leaf(BlockType.Callout, new TextSpan("Note", new TextStyle(Bold: true)), InlineSpan.Plain(": read this")),
                Table(Row("Type of substance", "Dissolves in"), Row("Polar substances", "Water")),
                new Block
                {
                    Type = BlockType.TwoColumn,
                    Payload = new TwoColumnPayload(0.5),
                    Children =
                    [
                        new Block { Type = BlockType.ColumnGroup, Order = 0, Children = [Leaf(BlockType.Heading3, InlineSpan.Plain("Left")), withChildren] },
                        new Block { Type = BlockType.ColumnGroup, Order = 1, Children = [Paragraph(InlineSpan.Plain("right"))] }
                    ]
                },
                Leaf(BlockType.Heading4, InlineSpan.Plain("Trailing")),
                Paragraph(InlineSpan.Plain("last"))
            ]
        };
        var typ = Compose(note);

        var (exit, stderr) = NoteTypstToolchain.Compile(typ);
        Assert.True(exit == 0, $"typst compile failed (exit {exit}):\n{stderr}\n\n--- source ---\n{typ}");
    }
}
