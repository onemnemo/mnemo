using System.Runtime.CompilerServices;
using System.Text;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Csv;

/// <summary>
/// A CSV record with its cells and starting physical line number. Quoted values may span lines.
/// </summary>
internal sealed record CsvRecord(IReadOnlyList<string> Fields, int StartLine);

/// <summary>
/// Reads CSV records with quoted delimiters, newlines, and doubled quotes. Malformed quote
/// sequences are retained as data to avoid discarding card content.
/// </summary>
internal sealed class CsvRecordReader
{
    private const int BufferSize = 4096;

    /// <summary>How many non-blank lines <see cref="SniffDelimiter"/> looks at.</summary>
    public const int SniffLineCount = 20;

    /// <summary>
    /// The delimiters a spreadsheet writes, in the order a tie between them is broken. A comma is
    /// the format's own; a semicolon is what Excel writes wherever the comma is the decimal mark.
    /// </summary>
    private static readonly char[] Delimiters = [',', ';', '\t'];

    private readonly TextReader _reader;
    private readonly char _delimiter;

    public CsvRecordReader(TextReader reader, char delimiter = ',')
    {
        _reader = reader;
        _delimiter = delimiter;
    }

    /// <summary>
    /// The delimiter a sample of a file's lines is most consistently split by: the one that cuts
    /// the most records into the same number of cells, counting only cuts outside quotes. A sample
    /// nothing splits reads as comma separated, which is what a single-column file is.
    /// </summary>
    /// <remarks>
    /// Consistency across records rather than a count on the first line, because a semicolon file
    /// from a locale that writes decimal commas has commas inside its cells on most lines. Records
    /// rather than lines, because a quoted cell may run over several lines and this app's own
    /// export writes one for every card with a line break in it; the quote state has to carry
    /// across the break or the text inside such a cell is counted as if it were outside.
    /// </remarks>
    public static char SniffDelimiter(IReadOnlyList<string> lines)
    {
        var best = Delimiters[0];
        var bestScore = 0;
        foreach (var delimiter in Delimiters)
        {
            var score = ConsistencyOf(delimiter, lines);
            if (score > bestScore)
            {
                best = delimiter;
                bestScore = score;
            }
        }

        return best;
    }

    /// <summary>How many records the delimiter cuts into the same, non-trivial number of cells.</summary>
    /// <remarks>
    /// A quote opens a cell only where the record reader would open one: at the start of a line,
    /// right after a delimiter, or doubling the quote that just closed a cell. Anywhere else the
    /// reader keeps it as text, and so must this, or an inch mark in an unquoted cell would swallow
    /// every delimiter after it. Any candidate delimiter counts as a cell start, so the quote state
    /// is the same for every candidate and the scores compare the same records.
    /// </remarks>
    private static int ConsistencyOf(char delimiter, IReadOnlyList<string> lines)
    {
        var byCount = new Dictionary<int, int>();
        var quoted = false;
        var count = 0;
        foreach (var line in lines)
        {
            var atCellStart = true;
            var justClosed = false;
            foreach (var ch in line)
            {
                if (ch == '"')
                {
                    if (quoted)
                    {
                        quoted = false;
                        justClosed = true;
                    }
                    else if (atCellStart || justClosed)
                    {
                        quoted = true;
                        justClosed = false;
                    }
                    else
                    {
                        justClosed = false;
                    }

                    atCellStart = false;
                    continue;
                }

                justClosed = false;
                atCellStart = !quoted && Array.IndexOf(Delimiters, ch) >= 0;
                if (ch == delimiter && !quoted)
                    count++;
            }

            // A line that ends inside a quoted cell is the middle of a record, not the end of one.
            if (quoted)
                continue;

            if (count > 0)
                byCount[count] = byCount.TryGetValue(count, out var seen) ? seen + 1 : 1;
            count = 0;
        }

        // The sample can stop inside a record; what that record had so far still counts.
        if (count > 0)
            byCount[count] = byCount.TryGetValue(count, out var open) ? open + 1 : 1;

        return byCount.Count == 0 ? 0 : byCount.Values.Max();
    }

    /// <summary>
    /// Whether enumeration ended inside a quoted value. Valid after enumeration completes.
    /// </summary>
    public bool EndedInsideQuotedValue { get; private set; }

    public async IAsyncEnumerable<CsvRecord> ReadAsync([EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var buffer = new char[BufferSize];
        var value = new StringBuilder();
        var fields = new List<string>();
        var state = State.FieldStart;
        var line = 1;
        var recordStartLine = 1;
        var afterCarriageReturn = false;

        int read;
        while ((read = await _reader.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false)) > 0)
        {
            for (var i = 0; i < read; i++)
            {
                var ch = buffer[i];

                if (afterCarriageReturn)
                {
                    afterCarriageReturn = false;
                    if (ch == '\n')
                    {
                        // The second half of one Windows line break, not a break of its own.
                        if (state == State.Quoted)
                            value.Append(ch);
                        continue;
                    }
                }

                if (ch is '\n' or '\r')
                {
                    if (ch == '\r')
                        afterCarriageReturn = true;

                    if (state == State.Quoted)
                    {
                        value.Append(ch);
                        line++;
                        continue;
                    }

                    fields.Add(value.ToString());
                    value.Clear();
                    yield return new CsvRecord(fields, recordStartLine);

                    fields = new List<string>();
                    state = State.FieldStart;
                    line++;
                    recordStartLine = line;
                    continue;
                }

                switch (state)
                {
                    case State.FieldStart:
                        if (ch == '"')
                        {
                            state = State.Quoted;
                        }
                        else if (ch == _delimiter)
                        {
                            fields.Add(value.ToString());
                            value.Clear();
                        }
                        else
                        {
                            value.Append(ch);
                            state = State.Unquoted;
                        }

                        break;

                    case State.Unquoted:
                        if (ch == _delimiter)
                        {
                            fields.Add(value.ToString());
                            value.Clear();
                            state = State.FieldStart;
                        }
                        else
                        {
                            value.Append(ch);
                        }

                        break;

                    case State.Quoted:
                        if (ch == '"')
                            state = State.QuoteInQuoted;
                        else
                            value.Append(ch);

                        break;

                    case State.QuoteInQuoted:
                        if (ch == '"')
                        {
                            // Two quotes inside a quoted value are one literal quote. Reading them
                            // that way anywhere else turns the empty value "" into a stray quote.
                            value.Append('"');
                            state = State.Quoted;
                        }
                        else if (ch == _delimiter)
                        {
                            fields.Add(value.ToString());
                            value.Clear();
                            state = State.FieldStart;
                        }
                        else
                        {
                            value.Append(ch);
                            state = State.Unquoted;
                        }

                        break;
                }
            }
        }

        EndedInsideQuotedValue = state == State.Quoted;

        // Do not emit an extra record for the trailing newline written by the exporter.
        if (state == State.FieldStart && fields.Count == 0 && value.Length == 0)
            yield break;

        fields.Add(value.ToString());
        yield return new CsvRecord(fields, recordStartLine);
    }

    private enum State
    {
        FieldStart,
        Unquoted,
        Quoted,
        QuoteInQuoted,
    }
}
