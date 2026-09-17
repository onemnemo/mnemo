using Mnemo.Infrastructure.Services.ImportExport.Adapters.Csv;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Checks quoted newlines, escaped quotes, trailing newlines, incomplete CSV values, and which
/// delimiter a file is read on.
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

    [Fact]
    public async Task SemicolonDelimiter_SplitsOnSemicolonsAndKeepsCommas()
    {
        var records = await ReadAllAsync("Hva er 2,5 + 1;3,5\n", ';');

        var record = Assert.Single(records);
        Assert.Equal(new[] { "Hva er 2,5 + 1", "3,5" }, record.Fields);
    }

    [Fact]
    public void SniffDelimiter_SemicolonFileWithDecimalCommasInCells_PicksSemicolon()
    {
        // Every line has a semicolon between its two cells; the commas are the locale's decimal
        // mark and fall on different lines in different numbers.
        var delimiter = CsvRecordReader.SniffDelimiter(["front;back", "Hva er 2,5 + 1;3,5", "Hva er 1,5 + 1,5;3"]);

        Assert.Equal(';', delimiter);
    }

    [Fact]
    public void SniffDelimiter_CommaFileWithSemicolonsInText_PicksComma()
    {
        var delimiter = CsvRecordReader.SniffDelimiter(["front,back", "one; two,three", "four,five"]);

        Assert.Equal(',', delimiter);
    }

    [Fact]
    public void SniffDelimiter_TabSeparatedFile_PicksTab()
    {
        var delimiter = CsvRecordReader.SniffDelimiter(["front\tback", "Q1\tA1", "Q2\tA2"]);

        Assert.Equal('\t', delimiter);
    }

    [Fact]
    public void SniffDelimiter_StrayQuoteInsideAnUnquotedCell_IsText()
    {
        // A tab file nothing quotes, with an inch mark in its first term. The record reader keeps
        // such a quote as text, so the sniff must not open a cell on it.
        var delimiter = CsvRecordReader.SniffDelimiter(
            ["5\" floppy\tA disk, 5.25 inches", "Hello, world\tHola, mundo", "Coffee\tKaffe", "Tea\tTe"]);

        Assert.Equal('\t', delimiter);
    }

    [Fact]
    public void SniffDelimiter_DelimiterInsideQuotes_DoesNotCount()
    {
        var delimiter = CsvRecordReader.SniffDelimiter(["\"a;b;c\",d", "\"e;f\",g"]);

        Assert.Equal(',', delimiter);
    }

    [Fact]
    public void SniffDelimiter_QuotedCellSpanningLines_KeepsTheComma()
    {
        // The bullet lines sit inside a quoted back cell; their semicolons are text.
        var delimiter = CsvRecordReader.SniffDelimiter(
            ["front,back", "\"Q1\",\"Points:", "- a; b", "- c; d\"", "\"Q2\",\"Points:", "- a; b", "- c; d\""]);

        Assert.Equal(',', delimiter);
    }

    [Fact]
    public void SniffDelimiter_SemicolonFileWithMultiLineFronts_PicksSemicolon()
    {
        // The mirror image: an Excel file whose quoted fronts span lines and hold commas.
        var delimiter = CsvRecordReader.SniffDelimiter(
            ["front;back", "\"Hva, er", "2,5 + 1\";3,5", "\"Hva, er", "1,5 + 1,5\";3"]);

        Assert.Equal(';', delimiter);
    }

    [Fact]
    public void SniffDelimiter_NothingSplitsTheLines_ReadsAsComma()
    {
        var delimiter = CsvRecordReader.SniffDelimiter(["only one column", "still one"]);

        Assert.Equal(',', delimiter);
    }

    private static async Task<List<CsvRecord>> ReadAllAsync(string text, char delimiter = ',')
    {
        var reader = new CsvRecordReader(new StringReader(text), delimiter);
        var records = new List<CsvRecord>();
        await foreach (var record in reader.ReadAsync())
            records.Add(record);

        return records;
    }
}
