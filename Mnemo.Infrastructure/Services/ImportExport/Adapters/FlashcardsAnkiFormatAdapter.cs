using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

/// <summary>
/// Imports and exports flashcards in Anki package format (.apkg).
/// </summary>
public sealed class FlashcardsAnkiFormatAdapter : IContentFormatAdapter
{
    private const char UnitSeparator = '\u001f';
    private const int CardPageSize = 200;
    private static readonly UTF8Encoding Utf8WithoutBom = new(encoderShouldEmitUTF8Identifier: false);
    private static readonly Regex ClozeRegex = new(@"\{\{c\d+::", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex ImageTagRegex = new(@"<img\s+[^>]*src\s*=\s*['""](?<src>[^'""]+)['""][^>]*>", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex BreakRegex = new(@"<\s*br\s*/?\s*>", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex DivCloseRegex = new(@"<\s*/\s*div\s*>", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex AllTagsRegex = new(@"<[^>]+>", RegexOptions.Compiled);
    private static readonly Regex InlineTagRegex = new(@"</?(b|strong|i|em|u|s|strike)>", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardCardService _cards;
    private readonly IFlashcardPresetService _presets;
    private readonly IImageAssetService _imageAssetService;

    public FlashcardsAnkiFormatAdapter(
        IFlashcardLibraryService library,
        IFlashcardCardService cards,
        IFlashcardPresetService presets,
        IImageAssetService imageAssetService)
    {
        _library = library;
        _cards = cards;
        _presets = presets;
        _imageAssetService = imageAssetService;
    }

    public string ContentType => "flashcards";
    public string FormatId => "flashcards.anki";
    public string DisplayName => "Anki Package (.apkg)";
    public IReadOnlyList<string> Extensions => [".apkg"];
    public bool SupportsImport => true;
    public bool SupportsExport => true;

    public async Task<ImportExportPreview> PreviewImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        try
        {
            await using var opened = await OpenApkgAsync(request.FilePath, cancellationToken).ConfigureAwait(false);
            var cardCount = await CountAsync(opened.Connection, "cards", cancellationToken).ConfigureAwait(false);
            var noteCount = await CountAsync(opened.Connection, "notes", cancellationToken).ConfigureAwait(false);

            return new ImportExportPreview
            {
                CanImport = cardCount > 0,
                ContentType = ContentType,
                FormatId = FormatId,
                DiscoveredCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
                {
                    ["flashcards"] = cardCount,
                    ["notes"] = noteCount
                }
            };
        }
        catch (Exception ex)
        {
            return new ImportExportPreview
            {
                CanImport = false,
                ContentType = ContentType,
                FormatId = FormatId,
                Warnings = { $"Unable to read Anki package: {ex.Message}" }
            };
        }
    }

    public async Task<ImportExportResult> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var warnings = new List<string>();
        var importedDecks = 0;
        var importedCards = 0;

        try
        {
            await using var opened = await OpenApkgAsync(request.FilePath, cancellationToken).ConfigureAwait(false);
            warnings.AddRange(opened.Warnings);
            var collectionInfo = await ReadCollectionInfoAsync(opened.Connection, cancellationToken).ConfigureAwait(false);
            var notes = await ReadNotesAsync(opened.Connection, cancellationToken).ConfigureAwait(false);
            var cards = await ReadCardsAsync(opened.Connection, cancellationToken).ConfigureAwait(false);
            foreach (var note in notes.Values)
            {
                if (collectionInfo.Models.TryGetValue(note.ModelId, out var modelName))
                    note.ModelName = modelName;
            }

            var decksByDid = cards
                .GroupBy(c => c.DeckId)
                .OrderBy(g => g.Key)
                .ToArray();

            var preset = await _presets.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(false);

            foreach (var deckGroup in decksByDid)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var deckName = collectionInfo.Decks.TryGetValue(deckGroup.Key, out var n) && !string.IsNullOrWhiteSpace(n)
                    ? n
                    : $"Imported Deck {deckGroup.Key}";
                var drafts = new List<FlashcardCardDraft>();

                foreach (var cardRow in deckGroup)
                {
                    if (!notes.TryGetValue(cardRow.NoteId, out var note))
                        continue;

                    var fields = note.Fields;
                    var frontHtml = fields.Length > 0 ? fields[0] : string.Empty;
                    var backHtml = fields.Length > 1 ? fields[1] : string.Empty;

                    // Content-only: front/back/tags/type/media. Anki scheduling is intentionally dropped;
                    // imported cards arrive FSRS-new (due now) via the card service. Images become
                    // FlashcardAttachments (up to 3 per side); the block pipeline no longer emits image
                    // blocks — the canonical body is the text field, attachments render as framed figures.
                    var front = await BuildSideAsync(
                        frontHtml, FlashcardAttachment.FrontSide, opened.TempDirectory, opened.Media, warnings, cancellationToken).ConfigureAwait(false);
                    var back = await BuildSideAsync(
                        backHtml, FlashcardAttachment.BackSide, opened.TempDirectory, opened.Media, warnings, cancellationToken).ConfigureAwait(false);

                    var attachments = front.Attachments.Count == 0 && back.Attachments.Count == 0
                        ? (IReadOnlyList<FlashcardAttachment>)Array.Empty<FlashcardAttachment>()
                        : front.Attachments.Concat(back.Attachments).ToArray();

                    drafts.Add(new FlashcardCardDraft(
                        DeckId: string.Empty,
                        Type: DetectType(front.Text, frontHtml, note.ModelName),
                        Front: front.Text,
                        Back: back.Text,
                        Tags: ParseTags(note.Tags),
                        Attachments: attachments,
                        SourceInfo: null,
                        FrontBlocks: front.Blocks,
                        BackBlocks: back.Blocks));
                }

                if (drafts.Count == 0)
                    continue;

                var deck = await _library.CreateDeckAsync(deckName, folderId: null, presetId: preset.Id, cancellationToken).ConfigureAwait(false);
                await _library.SaveDeckAsync(
                    deck with { Description = "Imported from Anki package" },
                    cancellationToken).ConfigureAwait(false);
                var created = await _cards.CreateCardsAsync(deck.Id, drafts, cancellationToken).ConfigureAwait(false);
                importedDecks++;
                importedCards += created.Count;
            }

            return new ImportExportResult
            {
                Success = importedCards > 0,
                ContentType = ContentType,
                FormatId = FormatId,
                ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
                {
                    ["decks"] = importedDecks,
                    ["flashcards"] = importedCards
                },
                Warnings = warnings,
                ErrorMessage = importedCards > 0 ? null : "No importable cards were found in the package."
            };
        }
        catch (Exception ex)
        {
            return new ImportExportResult
            {
                Success = false,
                ContentType = ContentType,
                FormatId = FormatId,
                Warnings = warnings,
                ErrorMessage = $"Failed to import Anki package: {ex.Message}"
            };
        }
    }

    public async Task<ImportExportResult> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var warnings = new List<string>();
        try
        {
            var decksToExport = await ResolveDecksToExportAsync(request, cancellationToken).ConfigureAwait(false);
            if (decksToExport.Count == 0)
            {
                return new ImportExportResult
                {
                    Success = false,
                    ContentType = ContentType,
                    FormatId = FormatId,
                    ErrorMessage = "No flashcard decks available to export."
                };
            }

            var tempRoot = Path.Combine(Path.GetTempPath(), $"mnemo-anki-export-{Guid.NewGuid():N}");
            Directory.CreateDirectory(tempRoot);

            try
            {
                var dbPath = Path.Combine(tempRoot, "collection.anki2");
                var mediaMap = new Dictionary<string, string>(StringComparer.Ordinal);
                var mediaCounter = 0;
                var exportedCards = 0;
                var now = DateTimeOffset.UtcNow;
                var nowMs = now.ToUnixTimeMilliseconds();
                var nowSec = now.ToUnixTimeSeconds();
                var crt = (long)Math.Floor(now.ToUnixTimeSeconds() / 86400d);

                await CreateSchemaAsync(dbPath, cancellationToken).ConfigureAwait(false);
                {
                    await using var connection = new SqliteConnection($"Data Source={dbPath};Pooling=False");
                    await connection.OpenAsync(cancellationToken).ConfigureAwait(false);

                    var deckJson = BuildDeckJson(decksToExport, nowMs);
                    var dconfJson = BuildDeckConfigJson(nowMs);
                    var modelJson = BuildModelJson(nowMs);
                    await InsertColAsync(connection, crt, nowSec, nowSec, deckJson, dconfJson, modelJson, cancellationToken).ConfigureAwait(false);

                    foreach (var deck in decksToExport)
                    {
                        var did = StableAnkiId($"deck:{deck.Id}:{deck.Name}");
                        foreach (var card in deck.Cards)
                        {
                            cancellationToken.ThrowIfCancellationRequested();

                            var nid = StableAnkiId($"note:{card.Id}");
                            var cid = StableAnkiId($"card:{card.Id}");
                            var guid = BuildGuid(card.Id);
                            var modelId = BasicModelId;
                            var mod = nowSec;
                            var tags = card.Tags.Count > 0 ? $" {string.Join(' ', card.Tags)} " : string.Empty;

                            var frontHtml = BuildFieldHtml(card.Front, card.FrontBlocks, tempRoot, mediaMap, ref mediaCounter, warnings);
                            var backHtml = BuildFieldHtml(card.Back, card.BackBlocks, tempRoot, mediaMap, ref mediaCounter, warnings);
                            var flds = $"{frontHtml}{UnitSeparator}{backHtml}";
                            var sfld = card.Front;
                            var csum = ComputeChecksum(card.Front);
                            // Content-only export: no scheduling round-trip. Every card ships as an Anki "new" card.
                            var dueData = NewCardScheduling;

                            await InsertNoteAsync(connection, nid, guid, modelId, mod, tags, flds, sfld, csum, cancellationToken).ConfigureAwait(false);
                            await InsertCardAsync(connection, cid, nid, did, mod, dueData, cancellationToken).ConfigureAwait(false);
                            exportedCards++;
                        }
                    }
                }

                var mediaJsonPath = Path.Combine(tempRoot, "media");
                await File.WriteAllTextAsync(mediaJsonPath, JsonSerializer.Serialize(mediaMap), Utf8WithoutBom, cancellationToken).ConfigureAwait(false);

                if (File.Exists(request.FilePath))
                    File.Delete(request.FilePath);

                ZipFile.CreateFromDirectory(tempRoot, request.FilePath, CompressionLevel.Optimal, includeBaseDirectory: false);

                if (exportedCards == 0)
                {
                    return new ImportExportResult
                    {
                        Success = false,
                        ContentType = ContentType,
                        FormatId = FormatId,
                        ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
                        {
                            ["decks"] = decksToExport.Count,
                            ["flashcards"] = 0
                        },
                        Warnings = warnings,
                        ErrorMessage = "No cards were exported to the Anki package."
                    };
                }

                return new ImportExportResult
                {
                    Success = true,
                    ContentType = ContentType,
                    FormatId = FormatId,
                    ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
                    {
                        ["decks"] = decksToExport.Count,
                        ["flashcards"] = exportedCards
                    },
                    Warnings = warnings
                };
            }
            finally
            {
                await TryDeleteDirectoryWithRetriesAsync(tempRoot).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            return new ImportExportResult
            {
                Success = false,
                ContentType = ContentType,
                FormatId = FormatId,
                Warnings = warnings,
                ErrorMessage = $"Failed to export Anki package: {ex.Message}"
            };
        }
    }

    private static long BasicModelId => 1_608_194_021_001L;

    /// <summary>Anki scheduling for a fresh "new" card — the only state a content-only export emits.</summary>
    private static AnkiDueData NewCardScheduling => new(Type: 0, Queue: 0, Due: 0, Interval: 0, Factor: 2500, Reps: 0, Lapses: 0);

    private static async Task<OpenedApkg> OpenApkgAsync(string apkgPath, CancellationToken cancellationToken)
    {
        var tempDirectory = Path.Combine(Path.GetTempPath(), $"mnemo-anki-import-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDirectory);
        try
        {
            var contents = await AnkiPackageReader.ExtractAsync(apkgPath, tempDirectory, cancellationToken).ConfigureAwait(false);

            var connectionString = new SqliteConnectionStringBuilder
            {
                DataSource = contents.CollectionPath,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false
            }.ToString();
            var connection = new SqliteConnection(connectionString);
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            return new OpenedApkg(
                tempDirectory,
                connection,
                MediaIndex.FromStoredNames(contents.MediaNamesByStoredName),
                contents.Warnings);
        }
        catch
        {
            // The failure happened before the OpenedApkg wrapper exists, so no caller-side
            // "await using" will ever run its cleanup. Delete the extracted files ourselves.
            await TryDeleteDirectoryWithRetriesAsync(tempDirectory).ConfigureAwait(false);
            throw;
        }
    }

    private static async Task<int> CountAsync(SqliteConnection connection, string tableName, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(1) FROM {tableName}";
        var value = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return Convert.ToInt32(value, CultureInfo.InvariantCulture);
    }

    private static async Task<CollectionInfo> ReadCollectionInfoAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT crt, decks, models FROM col LIMIT 1";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            return new CollectionInfo(DateTimeOffset.UtcNow, new Dictionary<long, string>(), new Dictionary<long, string>());

        var crt = reader.IsDBNull(0) ? 0L : reader.GetInt64(0);
        var decksJson = reader.IsDBNull(1) ? "{}" : reader.GetString(1);
        var modelsJson = reader.IsDBNull(2) ? "{}" : reader.GetString(2);

        var createdAt = ParseCollectionCreatedAt(crt);
        var deckNames = ParseNameMap(decksJson);
        var modelNames = ParseNameMap(modelsJson);

        // Newer collections blank these two columns and keep the names in tables of their own.
        // Without the fallback every deck in a modern package would import under a placeholder name.
        await reader.CloseAsync().ConfigureAwait(false);
        if (deckNames.Count == 0)
            deckNames = await ReadNameTableAsync(connection, "decks", cancellationToken).ConfigureAwait(false);
        if (modelNames.Count == 0)
            modelNames = await ReadNameTableAsync(connection, "notetypes", cancellationToken).ConfigureAwait(false);

        return new CollectionInfo(createdAt, deckNames, modelNames);
    }

    /// <summary>
    /// Reads an id-to-name table from a collection that keeps its names relationally. Deck names
    /// there separate the levels of a hierarchy with a unit separator, normalized here to the
    /// spelling every other collection version uses.
    /// </summary>
    private static async Task<Dictionary<long, string>> ReadNameTableAsync(
        SqliteConnection connection,
        string tableName,
        CancellationToken cancellationToken)
    {
        var map = new Dictionary<long, string>();
        if (!await TableExistsAsync(connection, tableName, cancellationToken).ConfigureAwait(false))
            return map;

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $"SELECT id, name FROM {tableName}";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                if (reader.IsDBNull(0) || reader.IsDBNull(1))
                    continue;

                map[reader.GetInt64(0)] = reader.GetString(1).Replace(UnitSeparator.ToString(), "::", StringComparison.Ordinal);
            }
        }
        catch (SqliteException)
        {
            // These tables declare a collation Anki registers at runtime and plain SQLite does not
            // know. Losing the names costs placeholder deck titles; failing here would cost the
            // whole import.
            map.Clear();
        }

        return map;
    }

    private static async Task<bool> TableExistsAsync(SqliteConnection connection, string tableName, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name LIMIT 1";
        command.Parameters.AddWithValue("$name", tableName);
        return await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null;
    }

    private static Dictionary<long, string> ParseNameMap(string json)
    {
        var map = new Dictionary<long, string>();
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
        foreach (var prop in doc.RootElement.EnumerateObject())
        {
            if (!long.TryParse(prop.Name, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
                continue;
            if (prop.Value.TryGetProperty("name", out var nameElement))
                map[id] = nameElement.GetString() ?? string.Empty;
        }

        return map;
    }

    private static async Task<Dictionary<long, NoteRow>> ReadNotesAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        var result = new Dictionary<long, NoteRow>();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, tags, flds, mid FROM notes";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var id = reader.GetInt64(0);
            var tags = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
            var flds = reader.IsDBNull(2) ? string.Empty : reader.GetString(2);
            var modelId = reader.IsDBNull(3) ? 0L : reader.GetInt64(3);
            var fields = flds.Split(UnitSeparator);
            result[id] = new NoteRow(id, tags, fields, modelId);
        }

        return result;
    }

    private static async Task<List<CardRow>> ReadCardsAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        var cards = new List<CardRow>();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, nid, did, type, queue, due, ivl, factor, reps, lapses, mod FROM cards";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            cards.Add(new CardRow(
                reader.GetInt64(0),
                reader.GetInt64(1),
                reader.GetInt64(2),
                reader.IsDBNull(3) ? 0 : reader.GetInt32(3),
                reader.IsDBNull(4) ? 0 : reader.GetInt32(4),
                reader.IsDBNull(5) ? 0 : reader.GetInt64(5),
                reader.IsDBNull(6) ? 0 : reader.GetInt32(6),
                reader.IsDBNull(7) ? 2500 : reader.GetInt32(7),
                reader.IsDBNull(8) ? 0 : reader.GetInt32(8),
                reader.IsDBNull(9) ? 0 : reader.GetInt32(9),
                reader.IsDBNull(10) ? DateTimeOffset.UtcNow : ParseUnixTimestamp(reader.GetInt64(10))));
        }

        return cards;
    }

    /// <summary>
    /// Extracts one side's text, image-free rich blocks, and image attachments from Anki field HTML.
    /// The first <see cref="IFlashcardCardService.MaxAttachmentsPerSide"/> images become
    /// <see cref="FlashcardAttachment"/>s (files copied via <see cref="IImageAssetService"/>); any
    /// overflow images are appended to the text as inline <c>![alt](path)</c> markdown tokens (kept
    /// visible by the persistence-layer converter, never silently dropped) with a logged warning.
    /// The block pipeline no longer emits image blocks — attachments are the model for card media.
    /// </summary>
    private async Task<SideContent> BuildSideAsync(
        string html,
        string side,
        string tempDirectory,
        MediaIndex media,
        ICollection<string> warnings,
        CancellationToken cancellationToken)
    {
        var blocks = new List<Block>();
        var attachments = new List<FlashcardAttachment>();
        var overflowTokens = new List<string>();

        var normalized = NormalizeHtmlLineBreaks(html);
        foreach (var line in normalized.Split('\n'))
        {
            var trimmed = line.Trim();
            if (string.IsNullOrWhiteSpace(trimmed))
                continue;

            var textWithoutImages = ImageTagRegex.Replace(trimmed, string.Empty);
            var spans = ParseInlineSpans(textWithoutImages);
            if (spans.Count > 0)
            {
                blocks.Add(new Block
                {
                    Id = Guid.NewGuid().ToString(),
                    Type = BlockType.Text,
                    Spans = spans,
                    Order = blocks.Count
                });
            }

            foreach (Match match in ImageTagRegex.Matches(trimmed))
            {
                var src = match.Groups["src"].Value.Trim();
                if (string.IsNullOrWhiteSpace(src))
                    continue;

                var resolvedMediaPath = ResolveMediaPath(src, tempDirectory, media);
                if (resolvedMediaPath == null)
                {
                    warnings.Add($"Referenced media '{src}' was not found in package.");
                    continue;
                }

                var attachmentId = Guid.NewGuid().ToString("N");
                var copied = await _imageAssetService.ImportAndCopyAsync(resolvedMediaPath, attachmentId, cancellationToken).ConfigureAwait(false);
                if (!copied.IsSuccess || string.IsNullOrWhiteSpace(copied.Value))
                {
                    warnings.Add($"Failed to import media '{src}': {copied.ErrorMessage ?? "unknown error"}");
                    continue;
                }

                var displayName = Path.GetFileName(WebUtility.HtmlDecode(src));
                if (string.IsNullOrWhiteSpace(displayName))
                    displayName = Path.GetFileName(copied.Value!);

                if (attachments.Count < IFlashcardCardService.MaxAttachmentsPerSide)
                {
                    long sizeBytes = 0;
                    try { sizeBytes = new FileInfo(copied.Value!).Length; } catch (IOException) { }

                    attachments.Add(new FlashcardAttachment(
                        Id: attachmentId,
                        Side: side,
                        FilePath: copied.Value!,
                        DisplayName: displayName,
                        SizeBytes: sizeBytes,
                        Caption: null));
                }
                else
                {
                    // Beyond the 3-per-side cap: keep the image visible as an inline markdown token
                    // rather than dropping it. Warn so the user knows overflow landed in the text.
                    overflowTokens.Add($"![{displayName}]({copied.Value})");
                    warnings.Add($"Card side '{side}' exceeded {IFlashcardCardService.MaxAttachmentsPerSide} images; '{displayName}' was appended to the text as an inline token.");
                }
            }
        }

        if (blocks.Count == 0)
        {
            blocks.Add(new Block
            {
                Id = Guid.NewGuid().ToString(),
                Type = BlockType.Text,
                Spans = new List<InlineSpan> { InlineSpan.Plain(ToPlainText(html)) },
                Order = 0
            });
        }

        var text = ToPlainText(html);
        if (overflowTokens.Count > 0)
        {
            var overflow = string.Join("\n", overflowTokens);
            text = string.IsNullOrEmpty(text) ? overflow : $"{text}\n{overflow}";
        }

        return new SideContent(text, blocks, attachments);
    }

    private static List<InlineSpan> ParseInlineSpans(string htmlText)
    {
        var clean = NormalizeHtmlLineBreaks(htmlText);
        var spans = new List<InlineSpan>();
        var style = TextStyle.Default;
        var index = 0;
        var matches = InlineTagRegex.Matches(clean);
        foreach (Match match in matches)
        {
            if (match.Index > index)
            {
                var plainSegment = clean[index..match.Index];
                var decoded = WebUtility.HtmlDecode(AllTagsRegex.Replace(plainSegment, string.Empty));
                if (!string.IsNullOrEmpty(decoded))
                    spans.Add(new TextSpan(decoded, style));
            }

            var token = match.Value.ToLowerInvariant();
            style = token switch
            {
                "<b>" or "<strong>" => style with { Bold = true },
                "</b>" or "</strong>" => style with { Bold = false },
                "<i>" or "<em>" => style with { Italic = true },
                "</i>" or "</em>" => style with { Italic = false },
                "<u>" => style with { Underline = true },
                "</u>" => style with { Underline = false },
                "<s>" or "<strike>" => style with { Strikethrough = true },
                "</s>" or "</strike>" => style with { Strikethrough = false },
                _ => style
            };

            index = match.Index + match.Length;
        }

        if (index < clean.Length)
        {
            var tail = clean[index..];
            var decodedTail = WebUtility.HtmlDecode(AllTagsRegex.Replace(tail, string.Empty));
            if (!string.IsNullOrEmpty(decodedTail))
                spans.Add(new TextSpan(decodedTail, style));
        }

        if (spans.Count == 0)
            spans.Add(InlineSpan.Plain(string.Empty));

        return spans;
    }

    private static string? ResolveMediaPath(string src, string tempDirectory, MediaIndex media)
    {
        foreach (var name in CandidateMediaNames(src))
        {
            if (ResolveContainedFile(tempDirectory, name) is { } direct)
                return direct;

            if (media.TryGetStoredName(name, out var stored) && ResolveContainedFile(tempDirectory, stored) is { } mapped)
                return mapped;
        }

        return null;
    }

    /// <summary>
    /// Full path of <paramref name="relativeName"/> inside the extracted package, or null when it
    /// does not exist or resolves outside the package directory.
    /// </summary>
    /// <remarks>
    /// The name comes from untrusted note HTML. An absolute path makes <see cref="Path.Combine"/>
    /// discard the package directory outright, and a relative one can climb out with "..", so the
    /// resolved path is checked for containment instead of being trusted.
    /// </remarks>
    private static string? ResolveContainedFile(string tempDirectory, string relativeName)
    {
        if (string.IsNullOrWhiteSpace(relativeName))
            return null;

        string fullPath;
        try
        {
            fullPath = Path.GetFullPath(Path.Combine(tempDirectory, relativeName));
        }
        catch (Exception ex) when (ex is ArgumentException or PathTooLongException or NotSupportedException)
        {
            return null;
        }

        if (!MnemoAppPaths.IsPathUnder(fullPath, tempDirectory))
            return null;

        return File.Exists(fullPath) ? fullPath : null;
    }

    /// <summary>Spellings of one <c>src</c> worth trying, since Anki fields carry both HTML entities and percent escapes.</summary>
    private static IEnumerable<string> CandidateMediaNames(string src)
    {
        yield return src;

        var decoded = WebUtility.HtmlDecode(src);
        if (!string.Equals(decoded, src, StringComparison.Ordinal))
            yield return decoded;

        string? unescaped = null;
        try
        {
            unescaped = Uri.UnescapeDataString(decoded);
        }
        catch (UriFormatException)
        {
        }

        if (unescaped is not null && !string.Equals(unescaped, decoded, StringComparison.Ordinal))
            yield return unescaped;
    }

    private static string NormalizeHtmlLineBreaks(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return string.Empty;
        var normalized = html;
        normalized = BreakRegex.Replace(normalized, "\n");
        normalized = DivCloseRegex.Replace(normalized, "\n");
        return normalized;
    }

    private static string ToPlainText(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return string.Empty;
        var normalized = NormalizeHtmlLineBreaks(html);
        var stripped = AllTagsRegex.Replace(normalized, string.Empty);
        return WebUtility.HtmlDecode(stripped).Trim();
    }

    private static IReadOnlyList<string> ParseTags(string rawTags)
    {
        return rawTags
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static FlashcardType DetectType(string frontText, string frontHtml, string? modelName)
    {
        if (ClozeRegex.IsMatch(frontText) || ClozeRegex.IsMatch(frontHtml))
            return FlashcardType.Cloze;
        if (!string.IsNullOrWhiteSpace(modelName) && modelName.Contains("cloze", StringComparison.OrdinalIgnoreCase))
            return FlashcardType.Cloze;
        return FlashcardType.Classic;
    }

    private async Task<List<AnkiExportDeck>> ResolveDecksToExportAsync(ImportExportRequest request, CancellationToken cancellationToken)
    {
        var summaries = await _library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        var selectedIds = ResolveSelectedDeckIds(request.Payload);
        var selected = selectedIds is { Count: > 0 }
            ? summaries.Where(s => selectedIds.Contains(s.Id))
            : summaries;

        var result = new List<AnkiExportDeck>();
        foreach (var summary in selected)
        {
            var cards = await LoadExportCardsAsync(summary.Id, cancellationToken).ConfigureAwait(false);
            result.Add(new AnkiExportDeck(summary.Id, summary.Name, summary.Header.Description, cards));
        }

        return result;
    }

    private async Task<List<AnkiExportCard>> LoadExportCardsAsync(string deckId, CancellationToken cancellationToken)
    {
        var cards = new List<AnkiExportCard>();
        var offset = 0;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var page = await _cards.ListCardsAsync(
                new FlashcardCardQuery(deckId, Offset: offset, Limit: CardPageSize),
                cancellationToken).ConfigureAwait(false);
            foreach (var view in page.Items)
            {
                var card = view.Card;
                cards.Add(new AnkiExportCard(card.Id, card.Front, card.Back, card.Tags, card.FrontBlocks, card.BackBlocks));
            }

            offset += page.Items.Count;
            if (page.Items.Count == 0 || offset >= page.TotalCount)
                break;
        }

        return cards;
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

    private static async Task CreateSchemaAsync(string dbPath, CancellationToken cancellationToken)
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false
        }.ToString();
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        var schemaSql = """
                        CREATE TABLE col (
                            id INTEGER PRIMARY KEY,
                            crt INTEGER NOT NULL,
                            mod INTEGER NOT NULL,
                            scm INTEGER NOT NULL,
                            ver INTEGER NOT NULL,
                            dty INTEGER NOT NULL,
                            usn INTEGER NOT NULL,
                            ls INTEGER NOT NULL,
                            conf TEXT NOT NULL,
                            models TEXT NOT NULL,
                            decks TEXT NOT NULL,
                            dconf TEXT NOT NULL,
                            tags TEXT NOT NULL
                        );
                        CREATE TABLE notes (
                            id INTEGER PRIMARY KEY,
                            guid TEXT NOT NULL,
                            mid INTEGER NOT NULL,
                            mod INTEGER NOT NULL,
                            usn INTEGER NOT NULL,
                            tags TEXT NOT NULL,
                            flds TEXT NOT NULL,
                            sfld INTEGER NOT NULL,
                            csum INTEGER NOT NULL,
                            flags INTEGER NOT NULL,
                            data TEXT NOT NULL
                        );
                        CREATE TABLE cards (
                            id INTEGER PRIMARY KEY,
                            nid INTEGER NOT NULL,
                            did INTEGER NOT NULL,
                            ord INTEGER NOT NULL,
                            mod INTEGER NOT NULL,
                            usn INTEGER NOT NULL,
                            type INTEGER NOT NULL,
                            queue INTEGER NOT NULL,
                            due INTEGER NOT NULL,
                            ivl INTEGER NOT NULL,
                            factor INTEGER NOT NULL,
                            reps INTEGER NOT NULL,
                            lapses INTEGER NOT NULL,
                            left INTEGER NOT NULL,
                            odue INTEGER NOT NULL,
                            odid INTEGER NOT NULL,
                            flags INTEGER NOT NULL,
                            data TEXT NOT NULL
                        );
                        CREATE TABLE revlog (
                            id INTEGER PRIMARY KEY,
                            cid INTEGER NOT NULL,
                            usn INTEGER NOT NULL,
                            ease INTEGER NOT NULL,
                            ivl INTEGER NOT NULL,
                            lastIvl INTEGER NOT NULL,
                            factor INTEGER NOT NULL,
                            time INTEGER NOT NULL,
                            type INTEGER NOT NULL
                        );
                        CREATE TABLE graves (
                            usn INTEGER NOT NULL,
                            oid INTEGER NOT NULL,
                            type INTEGER NOT NULL
                        );
                        """;
        await using var command = connection.CreateCommand();
        command.CommandText = schemaSql;
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static string BuildDeckJson(IReadOnlyList<AnkiExportDeck> decks, long nowMs)
    {
        var mod = nowMs / 1000;
        var map = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var deck in decks)
        {
            var did = StableAnkiId($"deck:{deck.Id}:{deck.Name}");
            map[did.ToString(CultureInfo.InvariantCulture)] = new Dictionary<string, object?>
            {
                ["id"] = did,
                ["name"] = deck.Name,
                ["mod"] = mod,
                ["usn"] = 0,
                ["desc"] = deck.Description ?? string.Empty,
                ["dyn"] = 0,
                ["conf"] = 1,
                ["extendNew"] = 0,
                ["extendRev"] = 0,
                ["newToday"] = new object[] { 0, 0 },
                ["revToday"] = new object[] { 0, 0 },
                ["lrnToday"] = new object[] { 0, 0 },
                ["timeToday"] = new object[] { 0, 0 },
                ["collapsed"] = false,
                ["browserCollapsed"] = false
            };
        }

        return JsonSerializer.Serialize(map);
    }

    private static string BuildDeckConfigJson(long nowMs)
    {
        var mod = nowMs / 1000;
        var dconf = new Dictionary<string, object?>
        {
            ["1"] = new Dictionary<string, object?>
            {
                ["id"] = 1,
                ["name"] = "Default",
                ["mod"] = mod,
                ["usn"] = 0,
                ["maxTaken"] = 60,
                ["timer"] = 0,
                ["autoplay"] = true,
                ["replayq"] = true,
                ["new"] = new Dictionary<string, object?>
                {
                    ["bury"] = true,
                    ["delays"] = new object[] { 1, 10 },
                    ["initialFactor"] = 2500,
                    ["ints"] = new object[] { 1, 4, 7 },
                    ["order"] = 1,
                    ["perDay"] = 20
                },
                ["rev"] = new Dictionary<string, object?>
                {
                    ["bury"] = true,
                    ["ease4"] = 1.3,
                    ["fuzz"] = 0.05,
                    ["ivlFct"] = 1,
                    ["maxIvl"] = 36500,
                    ["perDay"] = 200
                },
                ["lapse"] = new Dictionary<string, object?>
                {
                    ["delays"] = new object[] { 10 },
                    ["leechAction"] = 0,
                    ["leechFails"] = 8,
                    ["minInt"] = 1,
                    ["mult"] = 0
                }
            }
        };

        return JsonSerializer.Serialize(dconf);
    }

    private static string BuildModelJson(long nowMs)
    {
        var mod = nowMs / 1000;
        var model = new Dictionary<string, object?>
        {
            [BasicModelId.ToString(CultureInfo.InvariantCulture)] = new Dictionary<string, object?>
            {
                ["id"] = BasicModelId,
                ["name"] = "Mnemo Basic",
                ["type"] = 0,
                ["mod"] = mod,
                ["usn"] = 0,
                ["vers"] = Array.Empty<object>(),
                ["tags"] = Array.Empty<object>(),
                ["sortf"] = 0,
                ["did"] = 1,
                ["req"] = new object[]
                {
                    new object[] { 0, "all", new object[] { 0 } }
                },
                ["flds"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Front",
                        ["ord"] = 0,
                        ["media"] = Array.Empty<object>(),
                        ["sticky"] = false,
                        ["rtl"] = false,
                        ["font"] = "Arial",
                        ["size"] = 20,
                        ["description"] = string.Empty
                    },
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Back",
                        ["ord"] = 1,
                        ["media"] = Array.Empty<object>(),
                        ["sticky"] = false,
                        ["rtl"] = false,
                        ["font"] = "Arial",
                        ["size"] = 20,
                        ["description"] = string.Empty
                    }
                },
                ["tmpls"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Card 1",
                        ["ord"] = 0,
                        ["qfmt"] = "{{Front}}",
                        ["afmt"] = "{{FrontSide}}\n<hr id=answer>\n{{Back}}",
                        ["bqfmt"] = string.Empty,
                        ["bafmt"] = string.Empty,
                        ["did"] = null,
                        ["bfont"] = "Arial",
                        ["bsize"] = 20
                    }
                },
                ["css"] = ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
                ["latexPre"] = "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
                ["latexPost"] = "\\end{document}"
            }
        };

        return JsonSerializer.Serialize(model);
    }

    private static async Task InsertColAsync(
        SqliteConnection connection,
        long crt,
        long mod,
        long scm,
        string decks,
        string dconf,
        string models,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
                              INSERT INTO col(id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
                              VALUES(1, @crt, @mod, @scm, 11, 0, 0, 0, '{}', @models, @decks, @dconf, '{}')
                              """;
        command.Parameters.AddWithValue("@crt", crt);
        command.Parameters.AddWithValue("@mod", mod);
        command.Parameters.AddWithValue("@scm", scm);
        command.Parameters.AddWithValue("@models", models);
        command.Parameters.AddWithValue("@decks", decks);
        command.Parameters.AddWithValue("@dconf", dconf);
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task InsertNoteAsync(
        SqliteConnection connection,
        long id,
        string guid,
        long modelId,
        long mod,
        string tags,
        string flds,
        string sfld,
        long csum,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
                              INSERT OR REPLACE INTO notes(id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
                              VALUES(@id, @guid, @mid, @mod, 0, @tags, @flds, @sfld, @csum, 0, '')
                              """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@guid", guid);
        command.Parameters.AddWithValue("@mid", modelId);
        command.Parameters.AddWithValue("@mod", mod);
        command.Parameters.AddWithValue("@tags", tags);
        command.Parameters.AddWithValue("@flds", flds);
        command.Parameters.AddWithValue("@sfld", sfld);
        command.Parameters.AddWithValue("@csum", csum);
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task InsertCardAsync(
        SqliteConnection connection,
        long id,
        long noteId,
        long deckId,
        long mod,
        AnkiDueData dueData,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
                              INSERT INTO cards(id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
                              VALUES(@id, @nid, @did, 0, @mod, 0, @type, @queue, @due, @ivl, @factor, @reps, @lapses, 0, 0, 0, 0, '')
                              """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@nid", noteId);
        command.Parameters.AddWithValue("@did", deckId);
        command.Parameters.AddWithValue("@mod", mod);
        command.Parameters.AddWithValue("@type", dueData.Type);
        command.Parameters.AddWithValue("@queue", dueData.Queue);
        command.Parameters.AddWithValue("@due", dueData.Due);
        command.Parameters.AddWithValue("@ivl", dueData.Interval);
        command.Parameters.AddWithValue("@factor", dueData.Factor);
        command.Parameters.AddWithValue("@reps", dueData.Reps);
        command.Parameters.AddWithValue("@lapses", dueData.Lapses);
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static string BuildFieldHtml(
        string plain,
        IReadOnlyList<Block>? blocks,
        string tempRoot,
        IDictionary<string, string> mediaMap,
        ref int mediaCounter,
        ICollection<string> warnings)
    {
        if (blocks is null || blocks.Count == 0)
            return WebUtility.HtmlEncode(plain ?? string.Empty);

        var fragments = new List<string>(blocks.Count);
        foreach (var block in blocks.OrderBy(b => b.Order))
        {
            if (block.Type == BlockType.Image && block.Payload is ImagePayload imagePayload)
            {
                var copiedFilename = TryCopyMedia(imagePayload.Path, tempRoot, mediaMap, ref mediaCounter, warnings);
                if (copiedFilename != null)
                    fragments.Add($"<img src=\"{WebUtility.HtmlEncode(copiedFilename)}\">");
                continue;
            }

            var text = block.Spans is { Count: > 0 } ? SerializeSpansToHtml(block.Spans) : WebUtility.HtmlEncode(block.Content);
            fragments.Add(text);
        }

        return string.Join("<br>", fragments.Where(f => !string.IsNullOrWhiteSpace(f)));
    }

    private static string? TryCopyMedia(
        string sourcePath,
        string tempRoot,
        IDictionary<string, string> mediaMap,
        ref int mediaCounter,
        ICollection<string> warnings)
    {
        if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath))
        {
            warnings.Add($"Image asset not found for export: {sourcePath}");
            return null;
        }

        var originalName = Path.GetFileName(sourcePath);
        var existing = mediaMap.FirstOrDefault(kv => string.Equals(kv.Value, originalName, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(existing.Key))
            return originalName;

        var slot = mediaCounter.ToString(CultureInfo.InvariantCulture);
        mediaCounter++;
        var dest = Path.Combine(tempRoot, slot);
        File.Copy(sourcePath, dest, overwrite: true);
        mediaMap[slot] = originalName;
        return originalName;
    }

    private static string SerializeSpansToHtml(IReadOnlyList<InlineSpan> spans)
    {
        var sb = new StringBuilder();
        foreach (var span in spans)
        {
            if (span is not TextSpan textSpan)
                continue;
            var segment = WebUtility.HtmlEncode(textSpan.Text);
            if (textSpan.Style.Bold)
                segment = $"<b>{segment}</b>";
            if (textSpan.Style.Italic)
                segment = $"<i>{segment}</i>";
            if (textSpan.Style.Underline)
                segment = $"<u>{segment}</u>";
            if (textSpan.Style.Strikethrough)
                segment = $"<s>{segment}</s>";
            sb.Append(segment);
        }

        return sb.ToString();
    }

    private static long ComputeChecksum(string value)
    {
        var bytes = SHA1.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty));
        return ((long)bytes[0] << 24) | ((long)bytes[1] << 16) | ((long)bytes[2] << 8) | bytes[3];
    }

    private static long StableAnkiId(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        var longBytes = hash[..8];
        var raw = BitConverter.ToInt64(longBytes, 0);
        var positive = Math.Abs(raw);
        return positive < 1_000_000_000_000L ? positive + 1_000_000_000_000L : positive;
    }

    private static string BuildGuid(string source)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(source));
        return Convert.ToBase64String(hash[..10]).Replace('+', 'A').Replace('/', 'B');
    }

    private static DateTimeOffset ParseUnixTimestamp(long value)
    {
        if (value <= 0)
            return DateTimeOffset.UtcNow;

        // Anki datasets in the wild may use either seconds or milliseconds.
        // Values beyond Unix-seconds max range are interpreted as milliseconds.
        const long maxUnixSeconds = 253402300799L; // 9999-12-31T23:59:59Z
        if (value > maxUnixSeconds)
            return DateTimeOffset.FromUnixTimeMilliseconds(value);

        return DateTimeOffset.FromUnixTimeSeconds(value);
    }

    private static DateTimeOffset ParseCollectionCreatedAt(long crtRaw)
    {
        if (crtRaw <= 0)
            return DateTimeOffset.UtcNow.Date;

        // Canonical Anki value: days since Unix epoch.
        // Some packages may contain seconds or milliseconds instead.
        const long maxReasonableAnkiDays = 3_652_059; // up to year 9999
        if (crtRaw <= maxReasonableAnkiDays)
            return DateTimeOffset.FromUnixTimeSeconds(crtRaw * 86400L);

        return ParseUnixTimestamp(crtRaw);
    }

    private sealed record OpenedApkg(
        string TempDirectory,
        SqliteConnection Connection,
        MediaIndex Media,
        IReadOnlyList<string> Warnings) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            await Connection.DisposeAsync().ConfigureAwait(false);
            await TryDeleteDirectoryWithRetriesAsync(TempDirectory).ConfigureAwait(false);
        }
    }

    private static async Task TryDeleteDirectoryWithRetriesAsync(string directoryPath)
    {
        if (!Directory.Exists(directoryPath))
            return;

        // SQLite/file-indexer locks on Windows can lag briefly after disposal.
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                Directory.Delete(directoryPath, recursive: true);
                return;
            }
            catch (IOException) when (attempt < 4)
            {
                await Task.Delay(150).ConfigureAwait(false);
            }
            catch (UnauthorizedAccessException) when (attempt < 4)
            {
                await Task.Delay(150).ConfigureAwait(false);
            }
        }
    }

    /// <summary>One imported card side: canonical text, image-free rich blocks, and image attachments.</summary>
    private sealed record SideContent(
        string Text,
        IReadOnlyList<Block> Blocks,
        IReadOnlyList<FlashcardAttachment> Attachments);

    /// <summary>
    /// The package's media table: which file inside the package backs each referenced filename.
    /// Anki stores media under numbered names with the real names in a side table, so an
    /// <c>&lt;img src="diagram.png"&gt;</c> resolves only through here.
    /// </summary>
    private sealed class MediaIndex
    {
        public static readonly MediaIndex Empty = new(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase));

        private readonly Dictionary<string, string> _storedNameByName;

        private MediaIndex(Dictionary<string, string> storedNameByName) => _storedNameByName = storedNameByName;

        /// <summary>
        /// Inverts a stored-name to original-name table once. Resolving per image against the raw
        /// table is a scan of the whole collection's media for every picture on every card.
        /// </summary>
        public static MediaIndex FromStoredNames(IEnumerable<KeyValuePair<string, string>> namesByStoredName)
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (storedName, originalName) in namesByStoredName)
            {
                if (!string.IsNullOrWhiteSpace(originalName))
                    map.TryAdd(originalName, storedName);
            }

            return new MediaIndex(map);
        }

        public bool TryGetStoredName(string originalName, [MaybeNullWhen(false)] out string storedName) =>
            _storedNameByName.TryGetValue(originalName, out storedName);
    }

    private sealed record CollectionInfo(
        DateTimeOffset CollectionCreatedAt,
        IReadOnlyDictionary<long, string> Decks,
        IReadOnlyDictionary<long, string> Models);

    private sealed record NoteRow(long Id, string Tags, string[] Fields, long ModelId)
    {
        public string? ModelName { get; set; }
    }

    private sealed record CardRow(
        long Id,
        long NoteId,
        long DeckId,
        int Type,
        int Queue,
        long Due,
        int IntervalDays,
        int Factor,
        int Reps,
        int Lapses,
        DateTimeOffset LastModifiedAt);

    private sealed record AnkiDueData(
        int Type,
        int Queue,
        int Due,
        int Interval,
        int Factor,
        int Reps,
        int Lapses);

    /// <summary>Content-only projection of a deck assembled from the relational store for export.</summary>
    private sealed record AnkiExportDeck(string Id, string Name, string? Description, IReadOnlyList<AnkiExportCard> Cards);

    /// <summary>Content-only projection of a card for export (no scheduling fields).</summary>
    private sealed record AnkiExportCard(
        string Id,
        string Front,
        string Back,
        IReadOnlyList<string> Tags,
        IReadOnlyList<Block>? FrontBlocks,
        IReadOnlyList<Block>? BackBlocks);
}
