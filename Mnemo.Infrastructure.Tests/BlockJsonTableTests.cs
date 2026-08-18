using System.Collections.Generic;
using System.Text.Json;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// The table's three block types on the wire. A table is three levels deep, so a field dropped on
/// the way out is not one cell's worth of loss, it is the shape of everything under it.
/// </summary>
public class BlockJsonTableTests
{
    private static Block Cell(string text, string fill = "") => new()
    {
        Id = $"cell-{text}",
        Type = BlockType.TableCell,
        Spans = new List<InlineSpan> { InlineSpan.Plain(text) },
        Payload = new TableCellPayload(fill),
        Meta = new Dictionary<string, object>()
    };

    private static Block Row(params Block[] cells) => new()
    {
        Id = "row",
        Type = BlockType.TableRow,
        Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) },
        Payload = new EmptyPayload(),
        Meta = new Dictionary<string, object>(),
        Children = new List<Block>(cells)
    };

    private static Block Table() => new()
    {
        Id = "t1",
        Type = BlockType.Table,
        Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) },
        Payload = new TablePayload(
            new List<double> { 200, 160 },
            HeaderRows: new List<bool> { true, false },
            HeaderColumns: new List<bool> { false, false },
            FullWidth: true),
        Meta = new Dictionary<string, object>(),
        Children = new List<Block>
        {
            Row(Cell("Drug"), Cell("Class")),
            Row(Cell("Levodopa"), Cell("Precursor", "amber"))
        }
    };

    [Fact]
    public void RoundTrip_Table_KeepsStructureWidthsAndFills()
    {
        var options = new JsonSerializerOptions();
        var json = JsonSerializer.Serialize(Table(), options);
        var back = JsonSerializer.Deserialize<Block>(json, options);

        Assert.NotNull(back);
        Assert.Equal(BlockType.Table, back.Type);
        var payload = Assert.IsType<TablePayload>(back.Payload);
        Assert.Equal(new double[] { 200, 160 }, payload.ColumnWidths);
        Assert.Equal(new[] { true, false }, payload.HeaderRows);
        Assert.Equal(new[] { false, false }, payload.HeaderColumns);
        Assert.True(payload.FullWidth);

        Assert.NotNull(back.Children);
        Assert.Equal(2, back.Children.Count);
        var secondRow = back.Children[1];
        Assert.Equal(BlockType.TableRow, secondRow.Type);
        Assert.NotNull(secondRow.Children);
        Assert.Equal("Levodopa", secondRow.Children[0].Content);
        Assert.Equal("amber", Assert.IsType<TableCellPayload>(secondRow.Children[1].Payload).Fill);
    }

    [Fact]
    public void Deserialize_TableWithoutWidths_ReadsAnEmptyList()
    {
        var options = new JsonSerializerOptions();
        var json = """
            {"id":"a","type":"Table","order":0,"payload":{"kind":"table","headerRows":[true,false]},"meta":{}}
            """;

        var back = JsonSerializer.Deserialize<Block>(json, options);

        Assert.NotNull(back);
        var payload = Assert.IsType<TablePayload>(back.Payload);
        Assert.Empty(payload.ColumnWidths);
        Assert.Equal(new[] { true, false }, payload.HeaderRows);
        Assert.False(payload.FullWidth);
    }

    [Fact]
    public void Deserialize_LegacyHeaderBooleans_BecomeTheFirstRowAndColumn()
    {
        // Older notes stored a single headerRow / headerCol that meant "the first
        // one is a header". The reader lifts a true one into position 0 of the
        // matching array, so the table still reads the same after the format change.
        var options = new JsonSerializerOptions();
        var json = """
            {"id":"a","type":"Table","order":0,"payload":{"kind":"table","headerRow":true,"headerCol":false},"meta":{}}
            """;

        var back = JsonSerializer.Deserialize<Block>(json, options);

        Assert.NotNull(back);
        var payload = Assert.IsType<TablePayload>(back.Payload);
        Assert.Equal(new[] { true }, payload.HeaderRows);
        Assert.Empty(payload.HeaderColumns);
    }

    [Fact]
    public void Deserialize_TableWithMistypedWidths_SkipsWhatIsNotANumber()
    {
        var options = new JsonSerializerOptions();
        var json = """
            {"id":"a","type":"Table","order":0,"payload":{"kind":"table","columnWidths":[180,"wide",220]},"meta":{}}
            """;

        var back = JsonSerializer.Deserialize<Block>(json, options);

        Assert.NotNull(back);
        Assert.Equal(new double[] { 180, 220 }, Assert.IsType<TablePayload>(back.Payload).ColumnWidths);
    }

    [Fact]
    public void Deserialize_TableTypeAsOrdinal_StillResolves()
    {
        // The reader falls back to the enum's ordinal, so the declaration order is
        // part of the format and the table types were appended for that reason.
        var options = new JsonSerializerOptions();
        var ordinal = (int)BlockType.Table;
        var json = "{\"id\":\"a\",\"type\":" + ordinal + ",\"order\":0,\"payload\":{\"kind\":\"table\"},\"meta\":{}}";

        var back = JsonSerializer.Deserialize<Block>(json, options);

        Assert.NotNull(back);
        Assert.Equal(BlockType.Table, back.Type);
    }
}
