using System.Text;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

public sealed class FlashcardsCsvFormatAdapter : IContentFormatAdapter
{
    private const int CardPageSize = 200;

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

    public Task<ImportExportPreview> PreviewImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new ImportExportPreview
        {
            CanImport = true,
            ContentType = ContentType,
            FormatId = FormatId,
            DiscoveredCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["flashcards"] = 1 }
        });
    }

    public async Task<ImportExportResult> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var lines = await File.ReadAllLinesAsync(request.FilePath, cancellationToken).ConfigureAwait(false);
        if (lines.Length == 0)
        {
            return new ImportExportResult
            {
                Success = false,
                ContentType = ContentType,
                FormatId = FormatId,
                ErrorMessage = "CSV file is empty."
            };
        }

        // New cards created via the store arrive FSRS-new and due now; the CSV carries content only.
        var drafts = new List<FlashcardCardDraft>();
        for (var i = 1; i < lines.Length; i++)
        {
            if (string.IsNullOrWhiteSpace(lines[i]))
                continue;
            var parts = ParseCsvLine(lines[i]);
            if (parts.Count < 2)
                continue;

            drafts.Add(new FlashcardCardDraft(
                DeckId: string.Empty,
                Type: FlashcardType.Classic,
                Front: parts[0],
                Back: parts[1],
                Tags: Array.Empty<string>(),
                Attachments: Array.Empty<FlashcardAttachment>()));
        }

        var preset = await _presets.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(false);
        var deck = await _library.CreateDeckAsync(
            Path.GetFileNameWithoutExtension(request.FilePath),
            folderId: null,
            presetId: preset.Id,
            cancellationToken).ConfigureAwait(false);

        var created = drafts.Count > 0
            ? await _cards.CreateCardsAsync(deck.Id, drafts, cancellationToken).ConfigureAwait(false)
            : Array.Empty<Flashcard>();

        return new ImportExportResult
        {
            Success = true,
            ContentType = ContentType,
            FormatId = FormatId,
            ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
            {
                ["decks"] = 1,
                ["flashcards"] = created.Count
            }
        };
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

    private static List<string> ParseCsvLine(string line)
    {
        var values = new List<string>();
        var sb = new StringBuilder();
        var inQuotes = false;
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (ch == '"' && i + 1 < line.Length && line[i + 1] == '"')
            {
                sb.Append('"');
                i++;
                continue;
            }

            if (ch == '"')
            {
                inQuotes = !inQuotes;
                continue;
            }

            if (ch == ',' && !inQuotes)
            {
                values.Add(sb.ToString());
                sb.Clear();
                continue;
            }

            sb.Append(ch);
        }

        values.Add(sb.ToString());
        return values;
    }
}
