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
