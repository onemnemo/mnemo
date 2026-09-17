using System.Globalization;
using System.Text;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Csv;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

public sealed class FlashcardsCsvFormatAdapter : IContentFormatAdapter
{
    private const int CardPageSize = 200;

    /// <summary>
    /// Limits individual skipped-row warnings so a malformed file cannot produce an unreadable
    /// notification.
    /// </summary>
    private const int MaxSkippedRowWarnings = 5;

    private const string DeckColumn = "deck";
    private const string FrontColumn = "front";
    private const string BackColumn = "back";

    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardCardService _cards;
    private readonly IFlashcardPresetService _presets;

    public FlashcardsCsvFormatAdapter(
        IFlashcardLibraryService library,
        IFlashcardCardService cards,
        IFlashcardPresetService presets)
    {
        _library = library;
        _cards = cards;
        _presets = presets;
    }

    public string ContentType => "flashcards";
    public string FormatId => "flashcards.csv";
    public string DisplayName => "CSV (.csv)";
    public IReadOnlyList<string> Extensions => [".csv"];
    public bool SupportsImport => true;
    public bool SupportsExport => true;

    /// <summary>A row carries no id, so nothing in a file can collide with anything already saved.</summary>
    public bool SupportsConflictPolicy => false;

    /// <summary>
    /// Reads the file the way the import will, so the two agree on what it holds: a file with no
    /// record in it cannot be imported, and the counts name every deck the import would create,
    /// including the one deck a header-only file makes.
    /// </summary>
    public async Task<ImportExportPreview> PreviewImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var read = await ReadRowsAsync(request.FilePath, cancellationToken).ConfigureAwait(false);
        var deckCount = read.SawRecord ? DeckNamesOf(read.Rows, FileDeckNameOf(request.FilePath)).Count : 0;

        var preview = new ImportExportPreview
        {
            CanImport = read.SawRecord,
            ContentType = ContentType,
            FormatId = FormatId,
            DiscoveredCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
            {
                ["decks"] = deckCount,
                ["flashcards"] = read.Rows.Count
            }
        };

        if (!read.SawRecord)
            preview.Warnings.Add(TransferWarning.Of("CsvEmpty"));

        return preview;
    }

    public async Task<ImportExportResult> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var read = await ReadRowsAsync(request.FilePath, cancellationToken).ConfigureAwait(false);
        var warnings = new List<TransferWarning>();

        foreach (var line in read.SkippedLines)
        {
            warnings.Add(TransferWarning.Of(
                "CsvRowSkipped",
                ("row", line.ToString(CultureInfo.InvariantCulture))));
        }

        if (read.SkippedRows > read.SkippedLines.Count)
        {
            warnings.Add(TransferWarning.Of(
                "CsvRowsSkippedMore",
                ("count", (read.SkippedRows - read.SkippedLines.Count).ToString(CultureInfo.InvariantCulture))));
        }

        if (read.EndedInsideQuotedValue)
            warnings.Add(TransferWarning.Of("CsvUnterminatedQuote"));

        if (!read.SawRecord)
        {
            return new ImportExportResult
            {
                Success = false,
                ContentType = ContentType,
                FormatId = FormatId,
                ErrorMessage = "CSV file is empty."
            };
        }

        var preset = await _presets.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(false);
        var fileDeckName = FileDeckNameOf(request.FilePath);
        var deckNames = DeckNamesOf(read.Rows, fileDeckName);
        var byDeck = deckNames.ToDictionary(name => name, _ => new List<FlashcardCardDraft>(), StringComparer.Ordinal);
        foreach (var row in read.Rows)
        {
            // New cards created via the store arrive FSRS-new and due now; the CSV carries content only.
            byDeck[DeckNameOf(row, fileDeckName)].Add(new FlashcardCardDraft(
                DeckId: string.Empty,
                Type: FlashcardType.Classic,
                Front: row.Front,
                Back: row.Back,
                Tags: Array.Empty<string>(),
                Attachments: Array.Empty<FlashcardAttachment>()));
        }

        var createdCards = 0;
        foreach (var deckName in deckNames)
        {
            var deck = await _library.CreateDeckAsync(
                deckName,
                folderId: null,
                presetId: preset.Id,
                cancellationToken).ConfigureAwait(false);

            var deckDrafts = byDeck[deckName];
            if (deckDrafts.Count > 0)
            {
                var created = await _cards.CreateCardsAsync(deck.Id, deckDrafts, cancellationToken).ConfigureAwait(false);
                createdCards += created.Count;
            }
        }

        return new ImportExportResult
        {
            Success = true,
            ContentType = ContentType,
            FormatId = FormatId,
            ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
            {
                ["decks"] = deckNames.Count,
                ["flashcards"] = createdCards
            },
            Warnings = warnings
        };
    }

    /// <summary>
    /// Every row the file would turn into a card: each non-blank record after an optional header,
    /// minus the rows whose mapped front cell is empty. The preview and the import both read
    /// through here, and each opens its own pass, because <see cref="CsvRecordReader"/> is
    /// forward-only.
    /// </summary>
    private static async Task<CsvReadResult> ReadRowsAsync(string filePath, CancellationToken cancellationToken)
    {
        var rows = new List<CsvCardRow>();
        var skippedLines = new List<int>();
        var sawRecord = false;
        var skippedRows = 0;

        using var text = new StreamReader(filePath, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var reader = new CsvRecordReader(text);
        var deckColumn = -1;
        var frontColumn = 0;
        var backColumn = 1;
        var atFirstRecord = true;

        await foreach (var record in reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            if (record.Fields.All(string.IsNullOrWhiteSpace))
                continue;

            sawRecord = true;
            if (atFirstRecord)
            {
                atFirstRecord = false;
                if (TryReadHeader(record.Fields, out deckColumn, out frontColumn, out backColumn))
                    continue;

                deckColumn = -1;
                frontColumn = 0;
                backColumn = 1;
            }

            var front = Cell(record.Fields, frontColumn);
            if (string.IsNullOrWhiteSpace(front))
            {
                skippedRows++;
                if (skippedLines.Count < MaxSkippedRowWarnings)
                    skippedLines.Add(record.StartLine);
                continue;
            }

            rows.Add(new CsvCardRow(
                Cell(record.Fields, deckColumn),
                front,
                Cell(record.Fields, backColumn)));
        }

        return new CsvReadResult(rows, sawRecord, skippedRows, skippedLines, reader.EndedInsideQuotedValue);
    }

    private static string FileDeckNameOf(string filePath) =>
        Path.GetFileNameWithoutExtension(filePath) ?? string.Empty;

    /// <summary>A row with no deck cell goes to the deck named after the file.</summary>
    private static string DeckNameOf(CsvCardRow row, string fileDeckName) =>
        string.IsNullOrWhiteSpace(row.Deck) ? fileDeckName : row.Deck;

    /// <summary>
    /// The decks an import creates, in the order the file first names them. Exact spellings from
    /// the export are kept, so two spellings stay two decks, and a file with a header and no rows
    /// still makes the one deck the file names.
    /// </summary>
    private static List<string> DeckNamesOf(IReadOnlyList<CsvCardRow> rows, string fileDeckName)
    {
        var names = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            var name = DeckNameOf(row, fileDeckName);
            if (seen.Add(name))
                names.Add(name);
        }

        if (names.Count == 0)
            names.Add(fileDeckName);

        return names;
    }

    public async Task<ImportExportResult> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var summaries = await _library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        var selectedIds = ResolveSelectedDeckIds(request.Payload);

        var sb = new StringBuilder();
        int exportedCards;
        if (selectedIds is { Count: 1 })
        {
            // Single-deck export: two-column front/back layout (matches the historical single-deck shape).
            var deckId = selectedIds.First();
            sb.AppendLine("front,back");
            exportedCards = await AppendCardsAsync(
                deckId,
                (front, back) => sb.AppendLine($"{EscapeCsv(front)},{EscapeCsv(back)}"),
                cancellationToken).ConfigureAwait(false);
        }
        else
        {
            sb.AppendLine("deck,front,back");
            var decks = selectedIds is { Count: > 0 }
                ? summaries.Where(d => selectedIds.Contains(d.Id))
                : summaries;

            exportedCards = 0;
            foreach (var deck in decks)
            {
                exportedCards += await AppendCardsAsync(
                    deck.Id,
                    (front, back) => sb.AppendLine($"{EscapeCsv(deck.Name)},{EscapeCsv(front)},{EscapeCsv(back)}"),
                    cancellationToken).ConfigureAwait(false);
            }
        }

        await File.WriteAllTextAsync(request.FilePath, sb.ToString(), Encoding.UTF8, cancellationToken).ConfigureAwait(false);
        return new ImportExportResult
        {
            Success = true,
            ContentType = ContentType,
            FormatId = FormatId,
            ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["flashcards"] = exportedCards }
        };
    }

    private async Task<int> AppendCardsAsync(string deckId, Action<string, string> append, CancellationToken cancellationToken)
    {
        var offset = 0;
        var written = 0;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var page = await _cards.ListCardsAsync(
                new FlashcardCardQuery(deckId, Offset: offset, Limit: CardPageSize),
                cancellationToken).ConfigureAwait(false);
            foreach (var view in page.Items)
            {
                append(view.Card.Front, view.Card.Back);
                written++;
            }

            offset += page.Items.Count;
            if (page.Items.Count == 0 || offset >= page.TotalCount)
                break;
        }

        return written;
    }

    private static HashSet<string>? ResolveSelectedDeckIds(object? payload)
    {
        switch (payload)
        {
            case FlashcardDeckSummary summary when !string.IsNullOrWhiteSpace(summary.Id):
                return new HashSet<string>(new[] { summary.Id }, StringComparer.Ordinal);
            case FlashcardDeckHeader header when !string.IsNullOrWhiteSpace(header.Id):
                return new HashSet<string>(new[] { header.Id }, StringComparer.Ordinal);
            case string id when !string.IsNullOrWhiteSpace(id):
                return new HashSet<string>(new[] { id }, StringComparer.Ordinal);
            case IEnumerable<string> ids:
                var set = new HashSet<string>(ids.Where(v => !string.IsNullOrWhiteSpace(v)), StringComparer.Ordinal);
                return set.Count > 0 ? set : null;
            default:
                return null;
        }
    }

    private static string EscapeCsv(string value)
    {
        var escaped = value.Replace("\"", "\"\"", StringComparison.Ordinal);
        return $"\"{escaped}\"";
    }

    /// <summary>
    /// Recognizes a header containing both front and back, using the leftmost duplicate. Other
    /// records are read as cards by column position.
    /// </summary>
    private static bool TryReadHeader(IReadOnlyList<string> cells, out int deck, out int front, out int back)
    {
        deck = -1;
        front = -1;
        back = -1;

        for (var index = 0; index < cells.Count; index++)
        {
            // Remove the byte order mark before matching the first header name.
            var name = (index == 0 ? cells[index].TrimStart('\uFEFF') : cells[index]).Trim();
            if (deck < 0 && string.Equals(name, DeckColumn, StringComparison.OrdinalIgnoreCase))
                deck = index;
            else if (front < 0 && string.Equals(name, FrontColumn, StringComparison.OrdinalIgnoreCase))
                front = index;
            else if (back < 0 && string.Equals(name, BackColumn, StringComparison.OrdinalIgnoreCase))
                back = index;
        }

        return front >= 0 && back >= 0;
    }

    /// <summary>One mapped cell of a record, empty when the record is shorter than the header.</summary>
    private static string Cell(IReadOnlyList<string> fields, int index) =>
        index >= 0 && index < fields.Count ? fields[index] : string.Empty;

    private sealed record CsvCardRow(string Deck, string Front, string Back);

    /// <summary>
    /// One pass over a file. <paramref name="SkippedLines"/> holds the first few skipped rows'
    /// line numbers, for the warnings that name them; <paramref name="SkippedRows"/> counts all.
    /// </summary>
    private sealed record CsvReadResult(
        IReadOnlyList<CsvCardRow> Rows,
        bool SawRecord,
        int SkippedRows,
        IReadOnlyList<int> SkippedLines,
        bool EndedInsideQuotedValue);
}
