using System.Runtime.CompilerServices;
using System.Text;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Csv;

/// <summary>
/// A CSV record with its cells and starting physical line number. Quoted values may span lines.
/// </summary>
internal sealed record CsvRecord(IReadOnlyList<string> Fields, int StartLine);

/// <summary>
/// Reads CSV records with quoted commas, newlines, and doubled quotes. Malformed quote sequences
/// are retained as data to avoid discarding card content.
/// </summary>
internal sealed class CsvRecordReader
{
    private const int BufferSize = 4096;

    private readonly TextReader _reader;

    public CsvRecordReader(TextReader reader) => _reader = reader;

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
                        else if (ch == ',')
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
                        if (ch == ',')
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
                        else if (ch == ',')
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
