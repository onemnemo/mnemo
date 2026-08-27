using Mnemo.Infrastructure.Services.ImportExport.Adapters.Csv;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Checks quoted newlines, escaped quotes, trailing newlines, and incomplete CSV values.
/// </summary>
public sealed class CsvRecordReaderTests
{
    [Fact]
    public async Task QuotedNewline_StaysOneRecord()
    {
        var records = await ReadAllAsync("\"Q\",\"- a\n- b\"\n");

        var record = Assert.Single(records);
        Assert.Equal(2, record.Fields.Count);
        Assert.Equal("Q", record.Fields[0]);
        Assert.Equal("- a\n- b", record.Fields[1]);
    }

    [Fact]
    public async Task EmptyQuotedField_ReadsAsEmptyText()
    {
        var records = await ReadAllAsync("\"Q\",\"\"\n");

        var record = Assert.Single(records);
        Assert.Equal(2, record.Fields.Count);
        Assert.Equal("Q", record.Fields[0]);
        Assert.Equal(string.Empty, record.Fields[1]);
    }

    [Fact]
    public async Task DoubledQuoteInsideAValue_ReadsAsOneQuote()
    {
        var records = await ReadAllAsync("\"a\"\"b\",\"c\"\n");

        var record = Assert.Single(records);
        Assert.Equal("a\"b", record.Fields[0]);
        Assert.Equal("c", record.Fields[1]);
    }

    [Fact]
    public async Task FileEndingInsideQuotedValue_FlushesWhatItReadAndSaysSo()
    {
        var reader = new CsvRecordReader(new StringReader("\"Q\",\"A"));

        var records = new List<CsvRecord>();
        await foreach (var record in reader.ReadAsync())
            records.Add(record);

        var only = Assert.Single(records);
        Assert.Equal(new[] { "Q", "A" }, only.Fields);
        Assert.True(reader.EndedInsideQuotedValue);
    }

    [Fact]
    public async Task TrailingNewlineDoesNotAddAnEmptyRecord()
    {
        var records = await ReadAllAsync("\"Q\",\"A\"\n");

        Assert.Single(records);
    }

    [Fact]
    public async Task CarriageReturnAndLineFeedEndOneRecordBetweenThem()
    {
        // Treat CRLF as one record boundary.
        var records = await ReadAllAsync("\"Q1\",\"A1\"\r\n\"Q2\",\"A2\"\r\n");

        Assert.Equal(2, records.Count);
        Assert.Equal(new[] { "Q1", "A1" }, records[0].Fields);
        Assert.Equal(new[] { "Q2", "A2" }, records[1].Fields);
        Assert.Equal(1, records[0].StartLine);
        Assert.Equal(2, records[1].StartLine);
    }

    [Fact]
    public async Task RecordAfterAQuotedLineBreak_StartsOnItsOwnPhysicalLine()
    {
        var records = await ReadAllAsync("\"Q1\",\"one\ntwo\"\n\"Q2\",\"A2\"\n");

        Assert.Equal(2, records.Count);
        Assert.Equal(1, records[0].StartLine);
        Assert.Equal(3, records[1].StartLine);
    }

    private static async Task<List<CsvRecord>> ReadAllAsync(string text)
    {
        var reader = new CsvRecordReader(new StringReader(text));
        var records = new List<CsvRecord>();
        await foreach (var record in reader.ReadAsync())
            records.Add(record);

        return records;
    }
}
