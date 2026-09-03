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
}
