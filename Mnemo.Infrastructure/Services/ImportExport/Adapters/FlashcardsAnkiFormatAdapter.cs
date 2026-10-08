using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

/// <summary>
/// Imports and exports flashcards in Anki package format (.apkg).
/// </summary>
public sealed partial class FlashcardsAnkiFormatAdapter : IContentFormatAdapter
{
    private const char UnitSeparator = '\u001f';
    private const int CardPageSize = 200;

    /// <summary>How Anki spells a deck hierarchy inside a single deck name.</summary>
    private const string DeckPathSeparator = "::";

    // Anki's card.type column.
    private const int AnkiCardTypeLearning = 1;
    private const int AnkiCardTypeReview = 2;
    private const int AnkiCardTypeRelearning = 3;

    /// <summary>Anki's card.queue value for a suspended card.</summary>
    private const int AnkiQueueSuspended = -1;

    /// <summary>Anki's card.flags value for the red flag, the first of its colors.</summary>
    private const int AnkiFlagRed = 1;

    /// <summary>
    /// Anki's note type kind for cloze. Such a type makes one card per deletion off a single
    /// template, so its card ordinals name deletions rather than templates.
    /// </summary>
    private const int AnkiClozeModelType = 1;

    /// <summary>
    /// Above this a due value is an absolute second rather than a day offset. Day offsets are
    /// counted from a collection's creation, so reaching this would mean studying for millennia.
    /// </summary>
    private const long SecondsSinceEpochThreshold = 1_000_000_000L;

    /// <summary>9999-12-31T23:59:59Z, the last instant a date can hold, in Unix seconds.</summary>
    private const long MaxUnixSeconds = 253_402_300_799L;

    /// <summary>The same instant in Unix milliseconds.</summary>
    private const long MaxUnixMilliseconds = 253_402_300_799_999L;

    /// <summary>
    /// How far ahead an imported due date is believed. Beyond this the row is broken, and honouring
    /// it would hide the card rather than schedule it.
    /// </summary>
    private const int MaxCarriedDueDays = 365 * 20;

    private static readonly UTF8Encoding Utf8WithoutBom = new(encoderShouldEmitUTF8Identifier: false);
    private static readonly Regex ClozeRegex = new(@"\{\{c\d+::", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    // Linear-time engine, since a field of unclosed tags would make a backtracking match quadratic.
    internal static readonly Regex ImageTagRegex = new(
        @"<img\s+[^>]*src\s*=\s*(?:['""](?<src>[^'""]+)['""]|(?<src>[^\s>'""/]+(?:/[^\s>'""/]+)*))[^>]*>",
        RegexOptions.NonBacktracking | RegexOptions.IgnoreCase);
    private static readonly Regex BreakRegex = new(@"<\s*br\s*/?\s*>", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    /// <summary>Closing tags that end a line of text. Without them a list or a table reads as one run-on line.</summary>
    private static readonly Regex BlockCloseRegex = new(
        @"<\s*/\s*(div|p|li|ul|ol|tr|h[1-6]|blockquote|pre)\s*>", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Table cells sit side by side on their row's line rather than each taking one of their own.</summary>
    private static readonly Regex CellCloseRegex = new(@"<\s*/\s*(td|th)\s*>", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex AllTagsRegex = new(@"<[^>]+>", RegexOptions.Compiled);
    private static readonly Regex WhitespaceRegex = new(@"\s+", RegexOptions.Compiled);

    /// <summary>How Anki references an audio clip inside a field. Cards here hold images only.</summary>
    private static readonly Regex SoundTagRegex = new(@"\[sound:[^\]]+\]", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex InlineTagRegex = new(@"</?(b|strong|i|em|u|s|strike)>", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardCardService _cards;
    private readonly IFlashcardFactService _facts;
    private readonly IFlashcardPresetService _presets;
    private readonly FlashcardClock _clock;
    private readonly IFlashcardReviewHistoryService _history;
    private readonly IImageAssetService _imageAssetService;
    private readonly string _importTempDirectory;

    public FlashcardsAnkiFormatAdapter(
        IFlashcardLibraryService library,
        IFlashcardCardService cards,
        IFlashcardFactService facts,
        IFlashcardPresetService presets,
        FlashcardClock clock,
        IFlashcardReviewHistoryService history,
        IImageAssetService imageAssetService,
        string? importTempDirectory = null)
    {
        _library = library;
        _cards = cards;
        _facts = facts;
        _presets = presets;
        _clock = clock;
        _history = history;
        _imageAssetService = imageAssetService;
        _importTempDirectory = importTempDirectory ?? Path.GetTempPath();
    }

    public string ContentType => "flashcards";
    public string FormatId => "flashcards.anki";
    public string DisplayName => "Anki Package (.apkg)";
    public IReadOnlyList<string> Extensions => [".apkg"];
    public bool SupportsImport => true;
    public bool SupportsExport => true;

    /// <summary>
    /// An Anki note's identity is its <c>guid</c>, which nothing here records, so there is no id an
    /// import can collide on and every import of a package is new content. Offering the choice
    /// anyway would promise a behaviour that never runs.
    /// </summary>
    public bool SupportsConflictPolicy => false;

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
                Warnings = { TransferWarning.Of("AnkiPackageUnreadable", ("error", ex.Message)) }
            };
        }
    }

    public async Task<ImportExportResult> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
    {
        var warnings = new List<TransferWarning>();
        var importedDecks = 0;
        var importedCards = 0;

        try
        {
            await using var opened = await OpenApkgAsync(request.FilePath, cancellationToken).ConfigureAwait(false);
            warnings.AddRange(opened.Warnings);
            var collectionInfo = await ReadCollectionInfoAsync(opened.Connection, cancellationToken).ConfigureAwait(false);
            var notes = await ReadNotesAsync(opened.Connection, cancellationToken).ConfigureAwait(false);
            var cards = RankNewCards(await ReadCardsAsync(opened.Connection, cancellationToken).ConfigureAwait(false));
            foreach (var note in notes.Values)
            {
                if (collectionInfo.Models.TryGetValue(note.ModelId, out var modelName))
                    note.ModelName = modelName;
            }

            var enhanced = PlanEnhancedOcclusion(notes, collectionInfo.NoteTypes, opened);
            var plan = PlanDecks(cards, notes, collectionInfo.NoteTypes, enhanced);
            var flaggedRows = cards.Where(c => c.IsFlagged).Select(c => c.Id).ToHashSet();
            var revlog = await ReadRevlogAsync(opened.Connection, cancellationToken).ConfigureAwait(false);

            var now = DateTimeOffset.UtcNow;
            var preset = await _presets.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(false);
            var weights = FsrsWeightRules.Resolve(preset);
            var folders = await DeckFolderResolver.CreateAsync(
                _library, cancellationToken, ImportExportOptionKeys.GetStringOption(request.Options, ImportExportOptionKeys.TargetFolderId)).ConfigureAwait(false);
            var tally = new ImportTally { OcclusionRepeatsSkipped = enhanced.Repeats.Count };
            var failedDecks = 0;
            var importSessionId = FlashcardImportedReviews.NewSessionId();
            var importedReviews = 0;

            foreach (var deckPlan in plan.Decks)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var deckPath = collectionInfo.Decks.TryGetValue(deckPlan.DeckId, out var n) && !string.IsNullOrWhiteSpace(n)
                    ? n
                    : $"Imported Deck {deckPlan.DeckId}";
                // Keep row construction inside the per-deck failure boundary so errors affect only
                // that deck.
                string? createdDeckId = null;
                try
                {
                    var drafts = new List<FlashcardCardDraft>();
                    // Retain source row ids to attach review history after cards receive their new
                    // ids.
                    var draftRows = new List<CardRow>();
                    var material = new List<FlashcardFactDraft>();
                    var materialNotes = new List<AnkiMaterialNote>();

                    foreach (var cardRow in deckPlan.Rows)
                    {
                        if (!notes.TryGetValue(cardRow.NoteId, out var note))
                            continue;

                        var sides = await ReadSidesAsync(
                            note, cardRow.Ord, rowCount: 1, collectionInfo, opened, warnings, tally, cancellationToken).ConfigureAwait(false);
                        drafts.Add(DraftFor(note, cardRow, sides, collectionInfo, revlog, weights, now, tally));
                        draftRows.Add(cardRow);
                    }

                    foreach (var clozeNote in deckPlan.MaterialNotes)
                    {
                        // A note whose picture is missing is dropped whole: its masks mean nothing
                        // without it, and a plain card over no image would only mislead.
                        if (clozeNote.Occlusion is not null)
                        {
                            if (await OcclusionMaterialAsync(
                                    clozeNote, opened, collectionInfo, revlog, weights, now, warnings, tally, cancellationToken)
                                .ConfigureAwait(false) is { } occlusionFact)
                            {
                                material.Add(occlusionFact);
                                materialNotes.Add(clozeNote);
                            }

                            continue;
                        }

                        var sides = await ReadSidesAsync(
                            clozeNote.Note, ord: 0, clozeNote.Rows.Count, collectionInfo, opened, warnings, tally, cancellationToken)
                            .ConfigureAwait(false);

                        if (MaterialFor(clozeNote, sides, collectionInfo, revlog, weights, now, tally) is { } fact)
                        {
                            material.Add(fact);
                            materialNotes.Add(clozeNote);
                            continue;
                        }

                        // Preserve individual cards when a cloze note contains no cloze markers.
                        foreach (var row in clozeNote.Rows.Values)
                        {
                            drafts.Add(DraftFor(clozeNote.Note, row, sides, collectionInfo, revlog, weights, now, tally));
                            draftRows.Add(row);
                        }
                    }

                    if (drafts.Count == 0 && material.Count == 0)
                        continue;

                    var (folderId, deckName) = await folders.ResolvePathAsync(deckPath, cancellationToken).ConfigureAwait(false);
                    var deck = await _library.CreateDeckAsync(deckName, folderId, preset.Id, cancellationToken).ConfigureAwait(false);
                    createdDeckId = deck.Id;
                    var header = deck with { Description = "Imported from Anki package" };
                    await _library.SaveDeckAsync(header, cancellationToken).ConfigureAwait(false);

                    // Which package card row each card that just landed came from. The history in
                    // the package is keyed by that row, and a note's deletions each have one of
                    // their own, so this is what keeps a deletion's answers on its own card.
                    var landed = new List<(long PackageCardId, string CardId)>();

                    if (drafts.Count > 0)
                    {
                        var created = await _cards.CreateCardsAsync(deck.Id, drafts, cancellationToken).ConfigureAwait(false);
                        importedCards += created.Count;
                        // Cards come back in draft order, which is the order the rows were read in.
                        for (var i = 0; i < created.Count && i < draftRows.Count; i++)
                            landed.Add((draftRows[i].Id, created[i].Id));
                    }

                    if (material.Count > 0)
                    {
                        var saved = await _facts.SaveFactsAsync(
                            [.. material.Select(m => m with { DeckId = deck.Id })], cancellationToken).ConfigureAwait(false);
                        importedCards += saved.Sum(s => s.Cards.Count);
                        for (var i = 0; i < saved.Count && i < materialNotes.Count; i++)
                        {
                            if (materialNotes[i].Occlusion is null)
                            {
                                landed.AddRange(PairDeletions(saved[i], materialNotes[i]));
                                continue;
                            }

                            tally.OcclusionCards += saved[i].Cards.Count;
                            landed.AddRange(PairOcclusion(saved[i], materialNotes[i]));
                        }
                    }

                    await ApplyFlagsAsync(landed, flaggedRows, cancellationToken).ConfigureAwait(false);

                    var (attached, newestReview) = await AttachHistoryAsync(
                        deck.Id, landed, revlog, importSessionId, cancellationToken).ConfigureAwait(false);
                    importedReviews += attached;

                    // The deck was last studied when its newest imported answer was given, in
                    // the other app; leaving it unset reads "Never studied" beside a real retention.
                    if (newestReview is { } lastStudied)
                        await _library.SaveDeckAsync(header with { LastStudied = lastStudied }, cancellationToken).ConfigureAwait(false);

                    importedDecks++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    failedDecks++;
                    warnings.Add(TransferWarning.Of("AnkiDeckImportFailed", ("deckName", deckPath), ("error", ex.Message)));
                    if (createdDeckId is not null)
                        await TryDeleteDeckAsync(createdDeckId, cancellationToken).ConfigureAwait(false);
                }
            }

            // A partial import has to report what landed as well as what failed, or a retry duplicates
            // every deck that already worked.
            if (failedDecks > 0)
            {
                warnings.Add(TransferWarning.Counted(
                    "AnkiDecksImportFailedOne",
                    "AnkiDecksImportFailedMany",
                    failedDecks,
                    ("totalCount", plan.Decks.Count.ToString(CultureInfo.InvariantCulture))));
            }

            if (tally.NoteTypesWithExtraFields.Count > 0)
            {
                warnings.Add(TransferWarning.Of(
                    "AnkiExtraFieldsDropped", ("noteTypes", string.Join(", ", tally.NoteTypesWithExtraFields))));
            }

            if (tally.CardsWithAudio > 0)
            {
                warnings.Add(TransferWarning.Counted("AnkiAudioNotImportedOne", "AnkiAudioNotImportedMany", tally.CardsWithAudio));
            }

            // Cards moving between decks without a word is exactly the kind of thing somebody finds
            // months later and cannot explain.
            if (plan.NotesFiledTogether > 0)
            {
                warnings.Add(TransferWarning.Counted(
                    "AnkiClozeSiblingsFiledTogetherOne", "AnkiClozeSiblingsFiledTogetherMany", plan.NotesFiledTogether));
            }

            AddOcclusionWarnings(warnings, tally);

            if (importedCards > 0 && tally.CardsWithMemory > 0)
                warnings.Add(TransferWarning.Of("AnkiMemoryCarriedOver").AsInfo());

            // A card with no usable memory or history still has to start measuring from its next
            // answers. Calling that out keeps a mixed import honest about the cards it could not carry.
            if (importedCards > 0 && tally.CardsWithoutMemory > 0)
                warnings.Add(TransferWarning.Of("AnkiScheduleCarriedOver"));

            // Retention and the deck's own numbers move the moment this lands, and someone who
            // opens a freshly imported deck to a filled in retention figure deserves to know why.
            if (importedReviews > 0)
            {
                warnings.Add(TransferWarning.Counted(
                    "AnkiReviewHistoryImportedOne", "AnkiReviewHistoryImportedMany", importedReviews).AsInfo());
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
        var warnings = new List<TransferWarning>();
        try
        {
            var occlusionSkipped = new StrongBox<int>();
            var decksToExport = await ResolveDecksToExportAsync(request, occlusionSkipped, cancellationToken).ConfigureAwait(false);

            // An Anki note cannot hold masks, and the fallback would write each card as a question
            // over the unmasked picture, so these are left out and counted.
            if (occlusionSkipped.Value > 0)
            {
                warnings.Add(TransferWarning.Counted(
                    "ExportOcclusionSkippedOne", "ExportOcclusionSkippedMany", occlusionSkipped.Value));
            }

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
                var media = new MediaExportState();
                var exportedCards = 0;
                var now = DateTimeOffset.UtcNow;
                var nowMs = now.ToUnixTimeMilliseconds();
                var nowSec = now.ToUnixTimeSeconds();
                // Anki counts review due values in whole days from the start of the collection's
                // first day. Due dates here sit on the start of a study day, so the epoch is the
                // current study day's start and every review offset comes out a whole number. An
                // epoch at UTC midnight would sit hours away from that boundary and round a day
                // off for anyone whose day starts more than twelve hours from it.
                var standardPreset = await _presets.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(false);
                var dayStartHour = standardPreset.DayStartHour;
                var collectionCreatedAt = _clock.StartOf(_clock.Today(dayStartHour), dayStartHour);
                var crt = collectionCreatedAt.ToUnixTimeSeconds();

                await CreateSchemaAsync(dbPath, cancellationToken).ConfigureAwait(false);
                {
                    await using var connection = new SqliteConnection($"Data Source={dbPath};Pooling=False");
                    await connection.OpenAsync(cancellationToken).ConfigureAwait(false);

                    var deckJson = BuildDeckJson(decksToExport, nowMs);
                    var dconfJson = BuildDeckConfigJson(nowMs);
                    var modelJson = BuildModelJson(nowMs);
                    await InsertColAsync(connection, crt, nowSec, nowSec, deckJson, dconfJson, modelJson, cancellationToken).ConfigureAwait(false);

                    // Which package card row each exported card became, so the history it carries can
                    // be written against the right one once every note is in.
                    var exported = new List<(string CardId, long PackageCardId)>();

                    foreach (var deck in decksToExport)
                    {
                        var did = StableAnkiId($"deck:{deck.Id}:{deck.Name}");
                        foreach (var note in deck.Notes)
                        {
                            cancellationToken.ThrowIfCancellationRequested();

                            var mod = nowSec;
                            var tags = ExportTags(note.Tags);

                            var frontHtml = BuildFieldHtml(
                                note.FirstFieldText, note.FirstFieldBlocks, note.Attachments,
                                FlashcardAttachment.FrontSide, tempRoot, media, warnings);
                            var backHtml = BuildFieldHtml(
                                note.SecondFieldText, note.SecondFieldBlocks, note.Attachments,
                                FlashcardAttachment.BackSide, tempRoot, media, warnings);
                            var flds = $"{frontHtml}{UnitSeparator}{backHtml}";
                            var csum = ComputeChecksum(note.SortField);

                            await InsertNoteAsync(
                                connection, note.NoteId, note.Guid, note.ModelId, mod, tags, flds, note.SortField, csum,
                                cancellationToken).ConfigureAwait(false);

                            foreach (var row in note.Rows)
                            {
                                var cid = StableAnkiId($"card:{row.CardId}");
                                await InsertCardAsync(
                                    connection, cid, note.NoteId, did, mod, row.Ord,
                                    BuildExportScheduling(row, collectionCreatedAt), row.IsFlagged ? AnkiFlagRed : 0,
                                    cancellationToken).ConfigureAwait(false);
                                exported.Add((row.CardId, cid));
                                exportedCards++;
                            }
                        }
                    }

                    await WriteReviewHistoryAsync(connection, exported, cancellationToken).ConfigureAwait(false);
                }

                var mediaJsonPath = Path.Combine(tempRoot, "media");
                await File.WriteAllTextAsync(mediaJsonPath, JsonSerializer.Serialize(media.Map), Utf8WithoutBom, cancellationToken).ConfigureAwait(false);

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

    /// <summary>
    /// The note type material whose cards are its deletions is written out under. Its own id rather
    /// than a shared one, because a cloze note type makes one card per deletion and a basic one
    /// makes one card, and a note filed under the wrong one arrives with the wrong cards.
    /// </summary>
    private static long ClozeModelId => 1_608_194_021_002L;

    /// <summary>The note type basic and reverse material is written under, Anki's own two-card shape.</summary>
    private static long BasicReverseModelId => 1_608_194_021_003L;

    private async Task<OpenedApkg> OpenApkgAsync(string apkgPath, CancellationToken cancellationToken)
    {
        var tempDirectory = Path.Combine(_importTempDirectory, $"mnemo-anki-import-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDirectory);
        SqliteConnection? connection = null;
        try
        {
            var contents = await AnkiPackageReader.ExtractAsync(apkgPath, tempDirectory, cancellationToken).ConfigureAwait(false);

            var connectionString = new SqliteConnectionStringBuilder
            {
                DataSource = contents.CollectionPath,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false
            }.ToString();
            connection = new SqliteConnection(connectionString);
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            AnkiNoteTypeReader.RegisterCollations(connection);
            return new OpenedApkg(
                tempDirectory,
                connection,
                MediaIndex.FromStoredNames(contents.MediaNamesByStoredName),
                contents.Warnings);
        }
        catch
        {
            // The failure happened before the OpenedApkg wrapper exists, so no caller-side
            // "await using" will ever run its cleanup. Delete the extracted files ourselves, after
            // the connection lets go of the collection file.
            if (connection is not null)
                await connection.DisposeAsync().ConfigureAwait(false);
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
        {
            return new CollectionInfo(
                DateTimeOffset.UtcNow,
                new Dictionary<long, string>(),
                new Dictionary<long, string>(),
                new Dictionary<long, AnkiNoteType>());
        }

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

        var noteTypes = await AnkiNoteTypeReader.ReadAsync(connection, modelsJson, cancellationToken).ConfigureAwait(false);
        return new CollectionInfo(createdAt, deckNames, modelNames, noteTypes);
    }

    /// <summary>
    /// The question and answer HTML one card row stands for. Falls back to the note's first two
    /// fields when nothing is known about the template, which is the shape every note had before
    /// templates were read at all.
    /// </summary>
    private static (string Front, string Back) SidesFor(NoteRow note, int ord, IReadOnlyDictionary<long, AnkiNoteType> noteTypes)
    {
        var fields = note.Fields;
        var fallback = (
            fields.Length > 0 ? fields[0] : string.Empty,
            fields.Length > 1 ? fields[1] : string.Empty);

        noteTypes.TryGetValue(note.ModelId, out var noteType);
        if (ClozeFieldFor(fields, noteType) is { } clozeField)
            return ClozeSides(fields, clozeField, noteType);
        if (noteType is null)
            return fallback;
        // A cloze kind type has one template and its ordinals name deletions, so every row of an
        // occlusion note reads that one template.
        var template = noteType.IsImageOcclusion ? noteType.Templates.FirstOrDefault() : noteType.TemplateFor(ord);
        if (template is null || template.FrontFields.Count == 0)
            return fallback;

        // An occlusion type's cloze field holds mask shapes, which read as noise on a plain card.
        if (noteType.IsImageOcclusion && template.ClozeField is { } masks)
        {
            return (
                JoinFields(fields, [.. template.FrontFields.Where(i => i != masks)]),
                JoinFields(fields, [.. template.BackFields.Where(i => i != masks)]));
        }

        return (JoinFields(fields, template.FrontFields), JoinFields(fields, template.BackFields));
    }

    /// <summary>
    /// The deletion text and, as the extra, whatever else the note shows: every other field its
    /// template lays out, or, when no template can say, the field after the text and failing
    /// that the one before it. After rather than before because Anki's own cloze type puts the
    /// extra after the text, and a note with a title ahead of its text keeps its explanation
    /// rather than its heading.
    /// </summary>
    private static (string Front, string Back) ClozeSides(string[] fields, int clozeField, AnkiNoteType? noteType)
    {
        var text = clozeField < fields.Length ? fields[clozeField] : string.Empty;
        var shown = noteType?.Templates.FirstOrDefault(t => t.FrontFields.Count > 0 || t.BackFields.Count > 0);
        if (shown is null)
        {
            var other = clozeField + 1 < fields.Length ? clozeField + 1 : clozeField - 1;
            return (text, other >= 0 && other < fields.Length ? fields[other] : string.Empty);
        }

        return (text, JoinFields(fields, [.. shown.FrontFields.Concat(shown.BackFields).Where(i => i != clozeField)]));
    }

    /// <summary>
    /// Which of a note's fields holds its deletions: the field the cloze template names, or, when
    /// no template can say, the first field a deletion appears in. Null for a note that is not
    /// cloze at all.
    /// </summary>
    /// <remarks>
    /// A cloze note type says so outright, and its named field is taken even when the note has no
    /// deletion in it, since that is the field the other app would have made cards from. A note
    /// whose type the package does not define says nothing, so there the deletions in its own
    /// fields are the only signal left. Anki's image occlusion type is cloze over mask shapes, not
    /// text, so notes with readable masks are planned apart from this and the rest land as plain cards.
    /// </remarks>
    private static int? ClozeFieldFor(string[] fields, AnkiNoteType? noteType)
    {
        if (noteType is null)
            return FirstFieldWithDeletion(fields);
        if (!noteType.IsCloze || noteType.IsImageOcclusion)
            return null;
        if (noteType.ClozeField is { } named && named < fields.Length)
            return named;

        return FirstFieldWithDeletion(fields) ?? 0;
    }

    private static int? FirstFieldWithDeletion(string[] fields)
    {
        for (var i = 0; i < fields.Length; i++)
        {
            if (ClozeRegex.IsMatch(fields[i]))
                return i;
        }

        return null;
    }

    /// <summary>
    /// Divides a package's card rows into the decks they land in, separating the rows that stand
    /// for themselves from the notes whose rows are the deletions of one piece of material.
    /// </summary>
    /// <remarks>
    /// A note is one piece of material, so it lands whole. Siblings someone filed into a second
    /// deck come along to the deck holding most of them rather than splitting the material in two,
    /// which would give each half a card for every deletion in the shared text.
    /// </remarks>
    private static AnkiImportPlan PlanDecks(
        IReadOnlyList<CardRow> cards,
        IReadOnlyDictionary<long, NoteRow> notes,
        IReadOnlyDictionary<long, AnkiNoteType> noteTypes,
        EnhancedOcclusionPlan enhanced)
    {
        var rowsByDeck = new Dictionary<long, List<CardRow>>();
        var materialRowsByNote = new Dictionary<long, List<CardRow>>();
        var reverseNotes = new HashSet<long>();
        var occlusionByNote = new Dictionary<long, AnkiOcclusionNote?>();
        var enhancedOrdinalByRow = new Dictionary<long, int>();

        foreach (var row in cards)
        {
            if (!notes.TryGetValue(row.NoteId, out var note) || enhanced.Repeats.Contains(row.NoteId))
                continue;

            // The add-on keeps one card per note, so a set's notes gather under its lead note.
            if (enhanced.MemberOf.TryGetValue(row.NoteId, out var member))
            {
                if (!materialRowsByNote.TryGetValue(member.LeadNoteId, out var set))
                    materialRowsByNote[member.LeadNoteId] = set = [];
                set.Add(row);
                occlusionByNote[member.LeadNoteId] = enhanced.NoteByLead[member.LeadNoteId];
                enhancedOrdinalByRow[row.Id] = member.Ordinal;
                continue;
            }

            if (!occlusionByNote.TryGetValue(row.NoteId, out var occlusion))
            {
                noteTypes.TryGetValue(note.ModelId, out var noteType);
                occlusionByNote[row.NoteId] = occlusion = AnkiOcclusionNote.From(note.Id, note.Fields, noteType);
            }

            var isReverse = IsBasicAndReversed(note, noteTypes);
            if (isReverse || occlusion is not null || MakesOneCardPerDeletion(note, noteTypes))
            {
                if (!materialRowsByNote.TryGetValue(row.NoteId, out var sibling))
                    materialRowsByNote[row.NoteId] = sibling = [];
                sibling.Add(row);
                if (isReverse)
                    reverseNotes.Add(row.NoteId);
                continue;
            }

            if (!rowsByDeck.TryGetValue(row.HomeDeckId, out var rows))
                rowsByDeck[row.HomeDeckId] = rows = [];
            rows.Add(row);
        }

        var materialByDeck = new Dictionary<long, List<AnkiMaterialNote>>();
        var filedTogether = 0;
        foreach (var (noteId, rows) in materialRowsByNote.OrderBy(pair => pair.Key))
        {
            var isReverse = reverseNotes.Contains(noteId);
            var homes = rows.GroupBy(r => r.HomeDeckId).ToArray();

            // A reversed pair lands as one fact only when both its cards are here and in one deck.
            // Otherwise each row lands as the plain card it is, in its own deck, rather than the
            // fact making a card the package did not have or moving one out of its deck.
            if (isReverse && (homes.Length > 1 || !rows.Any(r => r.Ord == 0) || !rows.Any(r => r.Ord == 1)))
            {
                foreach (var row in rows)
                {
                    if (!rowsByDeck.TryGetValue(row.HomeDeckId, out var plain))
                        rowsByDeck[row.HomeDeckId] = plain = [];
                    plain.Add(row);
                }

                continue;
            }

            if (homes.Length > 1)
                filedTogether++;

            var deckId = homes.OrderByDescending(g => g.Count()).ThenBy(g => g.Key).First().Key;
            var byOrdinal = new SortedDictionary<int, CardRow>();
            foreach (var row in rows)
                byOrdinal.TryAdd(
                    isReverse ? row.Ord : enhancedOrdinalByRow.TryGetValue(row.Id, out var ordinal) ? ordinal : ClozeOrdinalFor(row),
                    row);

            if (!materialByDeck.TryGetValue(deckId, out var forDeck))
                materialByDeck[deckId] = forDeck = [];
            forDeck.Add(new AnkiMaterialNote(notes[noteId], byOrdinal, isReverse, occlusionByNote.GetValueOrDefault(noteId)));
        }

        var deckIds = rowsByDeck.Keys.Concat(materialByDeck.Keys).Distinct().OrderBy(id => id);
        var decks = deckIds
            .Select(id => new AnkiDeckPlan(
                id,
                rowsByDeck.TryGetValue(id, out var rows) ? rows : [],
                materialByDeck.TryGetValue(id, out var cloze) ? cloze : []))
            .ToArray();

        return new AnkiImportPlan(decks, filedTogether);
    }

    /// <summary>
    /// Whether a note's card rows stand for its deletions rather than for its templates, which is
    /// so exactly when the note has a field its deletions live in.
    /// </summary>
    private static bool MakesOneCardPerDeletion(NoteRow note, IReadOnlyDictionary<long, AnkiNoteType> noteTypes)
    {
        noteTypes.TryGetValue(note.ModelId, out var noteType);
        return ClozeFieldFor(note.Fields, noteType) is not null;
    }

    /// <summary>
    /// Whether a note is written under Anki's basic and reversed shape: two fields, and two templates
    /// that each ask one and answer with the other. Read from the templates rather than the note
    /// type's name, which Anki translates.
    /// </summary>
    private static bool IsBasicAndReversed(NoteRow note, IReadOnlyDictionary<long, AnkiNoteType> noteTypes)
    {
        if (!noteTypes.TryGetValue(note.ModelId, out var type) || type.IsCloze
            || type.FieldNames.Count != 2 || type.Templates.Count != 2)
            return false;

        return Asks(type.TemplateFor(0), 0, 1) && Asks(type.TemplateFor(1), 1, 0);

        static bool Asks(AnkiTemplate? template, int front, int back) =>
            template is not null
            && template.FrontFields.SequenceEqual([front])
            && template.BackFields.SequenceEqual([back]);
    }

    /// <summary>
    /// The deletion one cloze card row stands for. Anki numbers those rows from zero, while the
    /// deletion they name is written from one.
    /// </summary>
    private static int ClozeOrdinalFor(CardRow row) => row.Ord + 1;

    /// <summary>
    /// Reads what a note shows into both sides of a card: media copied out of the package, images
    /// turned into attachments, and everything the reading noticed added to the tally.
    /// </summary>
    /// <param name="rowCount">
    /// How many card rows this reading covers, so a note read once for all its deletions still
    /// counts for the cards the package actually held.
    /// </param>
    private async Task<NoteSides> ReadSidesAsync(
        NoteRow note,
        int ord,
        int rowCount,
        CollectionInfo collectionInfo,
        OpenedApkg opened,
        ICollection<TransferWarning> warnings,
        ImportTally tally,
        CancellationToken cancellationToken)
    {
        var (frontHtml, backHtml) = SidesFor(note, ord, collectionInfo.NoteTypes);

        // A card here has two sides, so fields a template does not show are lost. Say so once per
        // note type rather than per card or not at all.
        if (note.Fields.Length > 2 && !collectionInfo.NoteTypes.ContainsKey(note.ModelId))
            tally.NoteTypesWithExtraFields.Add(note.ModelName ?? $"note type {note.ModelId}");

        // A card holds images and nothing else, so an audio reference stays as the text it is
        // written as. Counted rather than silently left on the card.
        if (SoundTagRegex.IsMatch(frontHtml) || SoundTagRegex.IsMatch(backHtml))
            tally.CardsWithAudio += rowCount;

        // Images become FlashcardAttachments (up to 3 per side). The block pipeline emits no image
        // blocks: the canonical body is the text field, and attachments render as framed figures.
        var front = await BuildSideAsync(
            frontHtml, FlashcardAttachment.FrontSide, opened.TempDirectory, opened.Media, warnings, cancellationToken).ConfigureAwait(false);
        var back = await BuildSideAsync(
            backHtml, FlashcardAttachment.BackSide, opened.TempDirectory, opened.Media, warnings, cancellationToken).ConfigureAwait(false);

        return new NoteSides(frontHtml, front, back);
    }

    /// <summary>One card row as a card written side by side, which is what a single row stands for.</summary>
    private static FlashcardCardDraft DraftFor(
        NoteRow note,
        CardRow row,
        NoteSides sides,
        CollectionInfo collectionInfo,
        IReadOnlyDictionary<long, List<AnkiRevlogRow>> revlog,
        double[] weights,
        DateTimeOffset now,
        ImportTally tally) =>
        new(
            DeckId: string.Empty,
            Type: DetectType(sides.Front.Text, sides.FrontHtml, note.ModelName),
            Front: sides.Front.Text,
            Back: sides.Back.Text,
            Tags: ParseTags(note.Tags),
            Attachments: sides.Attachments,
            SourceInfo: null,
            FrontBlocks: sides.Front.Blocks,
            BackBlocks: sides.Back.Blocks,
            // Landing a studied collection as new cards makes every one of them due at once, which
            // is the opposite of what importing a schedule is for.
            Schedule: BuildImportedSchedule(row, collectionInfo.CollectionCreatedAt, revlog, weights, now, tally),
            State: row.Queue == AnkiQueueSuspended
                ? FlashcardCardState.Suspended
                : FlashcardCardState.Active);

    /// <summary>
    /// The material one cloze note stands for: the whole text with every deletion still in it, plus
    /// what the package knew about the card each deletion already had. Saving it makes one card per
    /// deletion, all off the one piece of material, which is what lets answering one hold the rest
    /// back and what lets a later edit reach all of them.
    /// </summary>
    /// <returns>
    /// Null when the text carries no deletion after all, which leaves the note's rows to import as
    /// the plain cards they describe rather than losing them to a classification nobody typed.
    /// </returns>
    private static FlashcardFactDraft? MaterialFor(
        AnkiMaterialNote note,
        NoteSides sides,
        CollectionInfo collectionInfo,
        IReadOnlyDictionary<long, List<AnkiRevlogRow>> revlog,
        double[] weights,
        DateTimeOffset now,
        ImportTally tally)
    {
        if (note.IsReverse)
            return ReverseMaterialFor(note, sides, collectionInfo, revlog, weights, now, tally);
        if (FlashcardGeneration.ClozeOrdinals(sides.Front.Text).Count == 0)
            return null;

        var carried = new Dictionary<string, FlashcardImportedCard>(StringComparer.Ordinal);
        foreach (var (ordinal, row) in note.Rows)
        {
            carried[FlashcardGeneration.ClozeKey(ordinal)] = new FlashcardImportedCard(
                BuildImportedSchedule(row, collectionInfo.CollectionCreatedAt, revlog, weights, now, tally),
                row.Queue == AnkiQueueSuspended ? FlashcardCardState.Suspended : FlashcardCardState.Active);
        }

        var media = new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal);
        if (sides.Front.Attachments.Count > 0)
            media[FlashcardCardType.ClozeTextFieldId] = sides.Front.Attachments;
        if (sides.Back.Attachments.Count > 0)
            media[FlashcardCardType.ClozeExtraFieldId] = sides.Back.Attachments;

        return new FlashcardFactDraft(
            Id: null,
            DeckId: string.Empty,
            TypeId: FlashcardCardType.ClozeId,
            Values: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [FlashcardCardType.ClozeTextFieldId] = sides.Front.Text,
                [FlashcardCardType.ClozeExtraFieldId] = sides.Back.Text,
            },
            Media: media,
            Tags: ParseTags(note.Note.Tags),
            Cards: carried);
    }

    /// <summary>
    /// A basic and reversed note as one basic and reverse fact, each of its two card rows carried
    /// onto the layout that asks the same side.
    /// </summary>
    private static FlashcardFactDraft ReverseMaterialFor(
        AnkiMaterialNote note,
        NoteSides sides,
        CollectionInfo collectionInfo,
        IReadOnlyDictionary<long, List<AnkiRevlogRow>> revlog,
        double[] weights,
        DateTimeOffset now,
        ImportTally tally)
    {
        var carried = new Dictionary<string, FlashcardImportedCard>(StringComparer.Ordinal);
        foreach (var (ord, row) in note.Rows)
        {
            if (ReverseLayoutFor(ord) is not { } layout)
                continue;
            carried[layout] = new FlashcardImportedCard(
                BuildImportedSchedule(row, collectionInfo.CollectionCreatedAt, revlog, weights, now, tally),
                row.Queue == AnkiQueueSuspended ? FlashcardCardState.Suspended : FlashcardCardState.Active);
        }

        var media = new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal);
        if (sides.Front.Attachments.Count > 0)
            media[FlashcardCardType.BasicFrontFieldId] = sides.Front.Attachments;
        if (sides.Back.Attachments.Count > 0)
            media[FlashcardCardType.BasicBackFieldId] = sides.Back.Attachments;

        return new FlashcardFactDraft(
            Id: null,
            DeckId: string.Empty,
            TypeId: FlashcardCardType.BasicReverseId,
            Values: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [FlashcardCardType.BasicFrontFieldId] = sides.Front.Text,
                [FlashcardCardType.BasicBackFieldId] = sides.Back.Text,
            },
            Media: media,
            Tags: ParseTags(note.Note.Tags),
            Cards: carried);
    }

    /// <summary>The layout a basic and reversed card row stands for, by its template's ordinal.</summary>
    private static string? ReverseLayoutFor(int ord) => ord switch
    {
        0 => FlashcardCardType.RecognitionLayoutId,
        1 => FlashcardCardType.RecallLayoutId,
        _ => null,
    };

    private static string JoinFields(string[] fields, IReadOnlyList<int> positions) =>
        string.Join(
            "<br><br>",
            positions
                .Where(i => i >= 0 && i < fields.Length)
                .Select(i => fields[i])
                .Where(value => !string.IsNullOrWhiteSpace(value)));

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

                map[reader.GetInt64(0)] = reader.GetString(1)
                    .Replace(UnitSeparator.ToString(), DeckPathSeparator, StringComparison.Ordinal);
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

    /// <summary>
    /// The package's review log, grouped by card row. Non-answer rows stay available so memory
    /// reconstruction can respect reset boundaries, while history storage still filters them.
    /// </summary>
    /// <remarks>
    /// A package assembled by something other than Anki may have no such table at all, and losing
    /// the history is a far smaller thing than losing the import.
    /// </remarks>
    private static async Task<Dictionary<long, List<AnkiRevlogRow>>> ReadRevlogAsync(
        SqliteConnection connection, CancellationToken cancellationToken)
    {
        var byCard = new Dictionary<long, List<AnkiRevlogRow>>();
        if (!await TableExistsAsync(connection, "revlog", cancellationToken).ConfigureAwait(false))
            return byCard;

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, cid, ease, ivl, lastIvl, factor, type FROM revlog";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var row = new AnkiRevlogRow(
                reader.IsDBNull(0) ? 0 : reader.GetInt64(0),
                reader.IsDBNull(1) ? 0 : reader.GetInt64(1),
                reader.IsDBNull(2) ? 0 : reader.GetInt32(2),
                reader.IsDBNull(3) ? 0 : reader.GetInt32(3),
                reader.IsDBNull(4) ? 0 : reader.GetInt32(4),
                reader.IsDBNull(5) ? 0 : reader.GetInt32(5),
                reader.IsDBNull(6) ? 0 : reader.GetInt32(6));

            if (!byCard.TryGetValue(row.CardId, out var rows))
                byCard[row.CardId] = rows = [];
            rows.Add(row);
        }

        return byCard;
    }

    /// <summary>
    /// Flags the cards whose package row carried a flag. Anki has seven colors and a card here has
    /// one flag, so any color counts.
    /// </summary>
    private Task ApplyFlagsAsync(
        IReadOnlyList<(long PackageCardId, string CardId)> landed,
        HashSet<long> flaggedRows,
        CancellationToken cancellationToken)
    {
        var flagged = landed.Where(l => flaggedRows.Contains(l.PackageCardId)).Select(l => l.CardId).ToArray();
        return flagged.Length == 0
            ? Task.CompletedTask
            : _cards.SetFlaggedAsync(flagged, flagged: true, cancellationToken);
    }

    /// <summary>
    /// Which card each of a note's deletions became, paired with the package row that deletion had.
    /// </summary>
    /// <remarks>
    /// A deletion is named the same way on both sides, by its number, which is what lets a card
    /// keep the answers that were given to that deletion rather than to one of its siblings.
    /// </remarks>
    private static IEnumerable<(long PackageCardId, string CardId)> PairDeletions(
        FlashcardFactSaved saved, AnkiMaterialNote note)
    {
        foreach (var card in saved.Cards)
        {
            int? key = note.IsReverse
                ? (card.LayoutKey == FlashcardCardType.RecognitionLayoutId ? 0
                    : card.LayoutKey == FlashcardCardType.RecallLayoutId ? 1 : null)
                : FlashcardGeneration.ClozeOrdinalFromKey(card.LayoutKey);
            if (key is not { } ordinal)
                continue;
            if (note.Rows.TryGetValue(ordinal, out var row))
                yield return (row.Id, card.Id);
        }
    }

    /// <summary>
    /// Writes the answers the package recorded against the cards that just landed.
    /// </summary>
    /// <returns>How many answers were written.</returns>
    private async Task<(int Written, DateTimeOffset? Newest)> AttachHistoryAsync(
        string deckId,
        IReadOnlyList<(long PackageCardId, string CardId)> landed,
        IReadOnlyDictionary<long, List<AnkiRevlogRow>> revlog,
        string sessionId,
        CancellationToken cancellationToken)
    {
        if (revlog.Count == 0 || landed.Count == 0)
            return (0, null);

        var logs = new List<FlashcardReviewLog>();
        foreach (var (packageCardId, cardId) in landed)
        {
            if (revlog.TryGetValue(packageCardId, out var rows))
                logs.AddRange(AnkiRevlog.ToReviewLogs(cardId, deckId, sessionId, rows));
        }

        var written = await _history.AddImportedAsync(logs, cancellationToken).ConfigureAwait(false);
        return (written, logs.Count == 0 ? null : logs.Max(l => l.ReviewedAt));
    }

    /// <summary>
    /// Numbers the new cards in the order the package queues them: by their due position, which
    /// sibling cards of one note share, then by template.
    /// </summary>
    private static List<CardRow> RankNewCards(List<CardRow> cards)
    {
        var rank = 0;
        var ranks = cards
            .Where(c => c.Type is not (AnkiCardTypeLearning or AnkiCardTypeReview or AnkiCardTypeRelearning))
            .OrderBy(c => c.EffectiveDue)
            .ThenBy(c => c.NoteId)
            .ThenBy(c => c.Ord)
            .ToDictionary(c => c.Id, _ => rank++);
        return [.. cards.Select(c => ranks.TryGetValue(c.Id, out var r) ? c with { NewRank = r } : c)];
    }

    private static async Task<List<CardRow>> ReadCardsAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        var cards = new List<CardRow>();
        await using var command = connection.CreateCommand();
        // odue/odid hold the real due date and home deck of a card parked in a filtered deck. Read
        // without them such a card imports into the temporary deck, due whenever the filter said.
        command.CommandText = "SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, mod, odue, odid, data, flags FROM cards";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            cards.Add(new CardRow(
                reader.GetInt64(0),
                reader.GetInt64(1),
                reader.GetInt64(2),
                reader.IsDBNull(3) ? 0 : reader.GetInt32(3),
                reader.IsDBNull(4) ? 0 : reader.GetInt32(4),
                reader.IsDBNull(5) ? 0 : reader.GetInt32(5),
                reader.IsDBNull(6) ? 0 : reader.GetInt64(6),
                reader.IsDBNull(7) ? 0 : reader.GetInt32(7),
                reader.IsDBNull(8) ? 2500 : reader.GetInt32(8),
                reader.IsDBNull(9) ? 0 : reader.GetInt32(9),
                reader.IsDBNull(10) ? 0 : reader.GetInt32(10),
                reader.IsDBNull(11) ? DateTimeOffset.UtcNow : ParseUnixTimestamp(reader.GetInt64(11)),
                reader.IsDBNull(12) ? 0 : reader.GetInt64(12),
                reader.IsDBNull(13) ? 0 : reader.GetInt64(13),
                reader.IsDBNull(14) ? string.Empty : reader.GetString(14),
                // The low three bits are the flag color; Anki keeps other state above them.
                !reader.IsDBNull(15) && (reader.GetInt64(15) & 7) != 0));
        }

        return cards;
    }

    /// <summary>
    /// Extracts one side's text, image-free rich blocks, and image attachments from Anki field HTML.
    /// The first <see cref="IFlashcardCardService.MaxAttachmentsPerSide"/> images become
    /// <see cref="FlashcardAttachment"/>s (files copied via <see cref="IImageAssetService"/>); any
    /// overflow images are appended to the text as inline <c>![alt](path)</c> markdown tokens (kept
    /// visible by the persistence-layer converter, never silently dropped) with a logged warning.
    /// The block pipeline emits no image blocks; attachments are the model for card media.
    /// </summary>
    private async Task<SideContent> BuildSideAsync(
        string html,
        string side,
        string tempDirectory,
        MediaIndex media,
        ICollection<TransferWarning> warnings,
        CancellationToken cancellationToken)
    {
        var blocks = new List<Block>();
        var attachments = new List<FlashcardAttachment>();
        var overflowTokens = new List<string>();

        var normalized = AnkiMathDelimiters.ToCardText(NormalizeHtmlLineBreaks(html));
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
                    warnings.Add(TransferWarning.Of("AnkiMediaNotFound", ("mediaName", src)));
                    continue;
                }

                var attachmentId = Guid.NewGuid().ToString("N");
                var copied = await _imageAssetService.ImportAndCopyAsync(resolvedMediaPath, attachmentId, cancellationToken).ConfigureAwait(false);
                if (!copied.IsSuccess || string.IsNullOrWhiteSpace(copied.Value))
                {
                    warnings.Add(copied.ErrorMessage is { } mediaError
                        ? TransferWarning.Of("AnkiMediaImportFailed", ("mediaName", src), ("error", mediaError))
                        : TransferWarning.Of("AnkiMediaImportFailedUnknown", ("mediaName", src)));
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
                    var max = IFlashcardCardService.MaxAttachmentsPerSide.ToString(CultureInfo.InvariantCulture);
                    warnings.Add(side == FlashcardAttachment.FrontSide
                        ? TransferWarning.Of("AnkiFrontOverflowToken", ("max", max), ("fileName", displayName))
                        : TransferWarning.Of("AnkiBackOverflowToken", ("max", max), ("fileName", displayName)));
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
        normalized = CellCloseRegex.Replace(normalized, " ");
        normalized = BlockCloseRegex.Replace(normalized, "\n");
        return normalized;
    }

    private static string ToPlainText(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return string.Empty;
        var normalized = AnkiMathDelimiters.ToCardText(NormalizeHtmlLineBreaks(html));
        var stripped = AllTagsRegex.Replace(normalized, string.Empty);
        return WebUtility.HtmlDecode(stripped).Trim();
    }

    /// <summary>
    /// The note's tags field. Anki separates tags with spaces, so a space inside a tag becomes an
    /// underscore rather than splitting it into two tags on the way in.
    /// </summary>
    private static string ExportTags(IReadOnlyList<string> tags)
    {
        var written = tags
            .Select(tag => WhitespaceRegex.Replace(tag.Trim(), "_"))
            .Where(tag => tag.Length > 0)
            .ToArray();
        return written.Length > 0 ? $" {string.Join(' ', written)} " : string.Empty;
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

    private async Task<List<AnkiExportDeck>> ResolveDecksToExportAsync(
        ImportExportRequest request, StrongBox<int> occlusionSkipped, CancellationToken cancellationToken)
    {
        var summaries = await _library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        var selectedIds = ResolveSelectedDeckIds(request.Payload);
        var selected = selectedIds is { Count: > 0 }
            ? summaries.Where(s => selectedIds.Contains(s.Id))
            : summaries;

        var folderPaths = await BuildFolderPathsAsync(cancellationToken).ConfigureAwait(false);
        var result = new List<AnkiExportDeck>();
        foreach (var summary in selected)
        {
            var cards = await LoadExportCardsAsync(summary.Id, occlusionSkipped, cancellationToken).ConfigureAwait(false);
            var material = await LoadMaterialAsync(cards, cancellationToken).ConfigureAwait(false);
            result.Add(new AnkiExportDeck(
                summary.Id,
                QualifiedDeckName(summary, folderPaths),
                summary.Header.Description,
                PlanExportNotes(cards, material)));
        }

        return result;
    }

    /// <summary>
    /// The material behind the cards being exported that leaves as one note, keyed by id: material
    /// whose cards are its deletions, and basic and reverse material with both cards in the deck.
    /// </summary>
    /// <remarks>
    /// A card renders one deletion of its material with the rest of the sentence showing, which is
    /// not what the note the receiving app wants holds. The note holds the text as it was written,
    /// deletions and all, so it is read from the material rather than reassembled from the cards.
    /// </remarks>
    private async Task<Dictionary<string, AnkiExportMaterial>> LoadMaterialAsync(
        IReadOnlyList<AnkiExportCard> cards, CancellationToken cancellationToken)
    {
        var byFact = new Dictionary<string, AnkiExportMaterial>(StringComparer.Ordinal);
        var considered = new HashSet<string>(StringComparer.Ordinal);
        var types = new Dictionary<string, FlashcardCardType?>(StringComparer.Ordinal);

        // A pair with one card deleted or in another deck leaves as the plain cards it has, since a
        // two-card note would bring the missing one back on the way in.
        var bothSides = cards
            .Where(c => c.FactId is not null)
            .GroupBy(c => c.FactId!, StringComparer.Ordinal)
            .Where(g => g.Any(c => c.LayoutKey == FlashcardCardType.RecognitionLayoutId)
                && g.Any(c => c.LayoutKey == FlashcardCardType.RecallLayoutId))
            .Select(g => g.Key)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var card in cards)
        {
            if (card.FactId is not { } factId || !considered.Add(factId))
                continue;
            if (FlashcardGeneration.ClozeOrdinalFromKey(card.LayoutKey) is null && !bothSides.Contains(factId))
                continue;

            var fact = await _facts.GetFactAsync(factId, cancellationToken).ConfigureAwait(false);
            if (fact is null)
                continue;

            if (!types.TryGetValue(fact.TypeId, out var type))
            {
                type = await _facts.GetCardTypeAsync(fact.TypeId, cancellationToken).ConfigureAwait(false);
                types[fact.TypeId] = type;
            }

            if (string.Equals(fact.TypeId, FlashcardCardType.BasicReverseId, StringComparison.Ordinal))
            {
                byFact[factId] = new AnkiExportMaterial(
                    fact.Value(FlashcardCardType.BasicFrontFieldId),
                    fact.Value(FlashcardCardType.BasicBackFieldId),
                    fact.Tags,
                    IsReverse: true,
                    Attachments:
                    [
                        .. fact.MediaOn(FlashcardCardType.BasicFrontFieldId).Select(a => a with { Side = FlashcardAttachment.FrontSide }),
                        .. fact.MediaOn(FlashcardCardType.BasicBackFieldId).Select(a => a with { Side = FlashcardAttachment.BackSide }),
                    ]);
                continue;
            }

            // The generator is what decides that this material's cards are deletions. A key that
            // merely looks like one is not enough: a card type could name a layout the same way.
            if (type is null || !string.Equals(type.Generator, FlashcardGenerators.Cloze, StringComparison.Ordinal))
                continue;

            var source = type.EffectiveGenerateFrom;
            var extra = type.Fields.FirstOrDefault(f => !string.Equals(f.Id, source, StringComparison.Ordinal));
            byFact[factId] = new AnkiExportMaterial(
                fact.Value(source),
                extra is null ? string.Empty : fact.Value(extra.Id),
                fact.Tags);
        }

        return byFact;
    }

    /// <summary>
    /// Divides a deck's cards into the notes they are written out as, in the order they were read.
    /// </summary>
    private static List<AnkiExportNote> PlanExportNotes(
        IReadOnlyList<AnkiExportCard> cards, IReadOnlyDictionary<string, AnkiExportMaterial> materialByFact)
    {
        var notes = new List<AnkiExportNote>();
        var noteByFact = new Dictionary<string, AnkiExportNote>(StringComparer.Ordinal);

        foreach (var card in cards)
        {
            if (card.FactId is { } factId
                && materialByFact.TryGetValue(factId, out var material)
                && RowOrdinalFor(card, material) is { } ord)
            {
                if (!noteByFact.TryGetValue(factId, out var note))
                {
                    note = new AnkiExportNote(
                        material.IsReverse ? BasicReverseModelId : ClozeModelId,
                        StableAnkiId($"note:fact:{factId}"),
                        BuildGuid($"fact:{factId}"),
                        material.Text,
                        FirstFieldBlocks: null,
                        material.Extra,
                        SecondFieldBlocks: null,
                        material.Attachments ?? card.Attachments,
                        material.Tags,
                        material.Text,
                        []);
                    noteByFact[factId] = note;
                    notes.Add(note);
                }

                note.Rows.Add(new AnkiExportRow(card.Id, ord, card.State, card.IsFlagged, card.Schedule));
                continue;
            }

            notes.Add(new AnkiExportNote(
                BasicModelId,
                StableAnkiId($"note:{card.Id}"),
                BuildGuid(card.Id),
                card.Front,
                card.FrontBlocks,
                card.Back,
                card.BackBlocks,
                card.Attachments,
                card.Tags,
                card.Front,
                [new AnkiExportRow(card.Id, 0, card.State, card.IsFlagged, card.Schedule)]));
        }

        return notes;
    }

    /// <summary>
    /// Which of its note's card rows a card is: its template for basic and reverse, its deletion
    /// counted from zero for cloze. Null for a card the note has no row for.
    /// </summary>
    private static int? RowOrdinalFor(AnkiExportCard card, AnkiExportMaterial material)
    {
        if (material.IsReverse)
        {
            return card.LayoutKey switch
            {
                FlashcardCardType.RecognitionLayoutId => 0,
                FlashcardCardType.RecallLayoutId => 1,
                _ => null,
            };
        }

        return FlashcardGeneration.ClozeOrdinalFromKey(card.LayoutKey) - 1;
    }

    /// <summary>
    /// The deck's name prefixed with the folders it sits in, which is how the receiving app spells a
    /// hierarchy. Exporting the bare name flattens a whole library into a list of unrelated decks.
    /// </summary>
    private static string QualifiedDeckName(FlashcardDeckSummary summary, IReadOnlyDictionary<string, string> folderPaths)
    {
        var folderId = summary.Header.FolderId;
        if (string.IsNullOrWhiteSpace(folderId) || !folderPaths.TryGetValue(folderId, out var path))
            return summary.Name;

        return $"{path}{DeckPathSeparator}{summary.Name}";
    }

    private async Task<Dictionary<string, string>> BuildFolderPathsAsync(CancellationToken cancellationToken)
    {
        var chains = await DeckFolderResolver.ChainsByFolderIdAsync(_library, cancellationToken).ConfigureAwait(false);
        return chains.ToDictionary(c => c.Key, c => string.Join(DeckPathSeparator, c.Value), StringComparer.Ordinal);
    }

    private async Task<List<AnkiExportCard>> LoadExportCardsAsync(
        string deckId, StrongBox<int> occlusionSkipped, CancellationToken cancellationToken)
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
                if (card.Type == FlashcardType.Occlusion)
                {
                    occlusionSkipped.Value++;
                    continue;
                }

                cards.Add(new AnkiExportCard(
                    card.Id, card.Front, card.Back, card.Tags, card.Attachments, card.FrontBlocks, card.BackBlocks,
                    card.FactId, card.LayoutKey, card.State, card.IsFlagged, view.Schedule));
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
            [ClozeModelId.ToString(CultureInfo.InvariantCulture)] = BuildClozeModel(mod),
            [BasicReverseModelId.ToString(CultureInfo.InvariantCulture)] = BuildBasicReverseModel(mod),
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

    /// <summary>
    /// Anki's stock "Basic (and reversed card)" note type: Front and Back, and a card asking each.
    /// Its fields and templates are named as Anki ships them so the note lands on the type a user
    /// of the other app already knows.
    /// </summary>
    private static Dictionary<string, object?> BuildBasicReverseModel(long mod) => new()
    {
        ["id"] = BasicReverseModelId,
        ["name"] = "Basic (and reversed card)",
        ["type"] = 0,
        ["mod"] = mod,
        ["usn"] = 0,
        ["vers"] = Array.Empty<object>(),
        ["tags"] = Array.Empty<object>(),
        ["sortf"] = 0,
        ["did"] = 1,
        ["req"] = new object[]
        {
            new object[] { 0, "any", new object[] { 0 } },
            new object[] { 1, "any", new object[] { 1 } },
        },
        ["flds"] = new[]
        {
            ModelField("Front", 0),
            ModelField("Back", 1),
        },
        ["tmpls"] = new[]
        {
            ReverseTemplate("Card 1", 0, "{{Front}}", "{{Back}}"),
            ReverseTemplate("Card 2", 1, "{{Back}}", "{{Front}}"),
        },
        ["css"] = ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
        ["latexPre"] = "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        ["latexPost"] = "\\end{document}"
    };

    private static Dictionary<string, object?> ReverseTemplate(string name, int ord, string question, string answer) => new()
    {
        ["name"] = name,
        ["ord"] = ord,
        ["qfmt"] = question,
        ["afmt"] = $"{{{{FrontSide}}}}\n\n<hr id=answer>\n\n{answer}",
        ["bqfmt"] = string.Empty,
        ["bafmt"] = string.Empty,
        ["did"] = null,
        ["bfont"] = "Arial",
        ["bsize"] = 20
    };

    /// <summary>
    /// The cloze note type a package is written with: two fields, one template, and the kind marker
    /// that tells the receiving app to make a card per deletion off it.
    /// </summary>
    private static Dictionary<string, object?> BuildClozeModel(long mod) => new()
    {
        ["id"] = ClozeModelId,
        ["name"] = "Mnemo Cloze",
        ["type"] = AnkiClozeModelType,
        ["mod"] = mod,
        ["usn"] = 0,
        ["vers"] = Array.Empty<object>(),
        ["tags"] = Array.Empty<object>(),
        ["sortf"] = 0,
        ["did"] = 1,
        ["req"] = new object[]
        {
            new object[] { 0, "any", new object[] { 0 } }
        },
        ["flds"] = new[]
        {
            ModelField("Text", 0),
            ModelField("Extra", 1),
        },
        ["tmpls"] = new[]
        {
            new Dictionary<string, object?>
            {
                ["name"] = "Cloze",
                ["ord"] = 0,
                ["qfmt"] = "{{cloze:Text}}",
                ["afmt"] = "{{cloze:Text}}<br>{{Extra}}",
                ["bqfmt"] = string.Empty,
                ["bafmt"] = string.Empty,
                ["did"] = null,
                ["bfont"] = "Arial",
                ["bsize"] = 20
            }
        },
        ["css"] = ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }"
            + " .cloze { font-weight: bold; color: blue; }",
        ["latexPre"] = "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        ["latexPost"] = "\\end{document}"
    };

    private static Dictionary<string, object?> ModelField(string name, int ord) => new()
    {
        ["name"] = name,
        ["ord"] = ord,
        ["media"] = Array.Empty<object>(),
        ["sticky"] = false,
        ["rtl"] = false,
        ["font"] = "Arial",
        ["size"] = 20,
        ["description"] = string.Empty
    };

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
        int ord,
        AnkiDueData dueData,
        int flags,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        // The learning step index has no shared representation, so left stays zero. The card still
        // carries its phase and due time and resumes at the receiving scheduler's first step.
        command.CommandText = """
                              INSERT INTO cards(id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
                              VALUES(@id, @nid, @did, @ord, @mod, 0, @type, @queue, @due, @ivl, @factor, @reps, @lapses, 0, 0, 0, @flags, @data)
                              """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@nid", noteId);
        command.Parameters.AddWithValue("@did", deckId);
        command.Parameters.AddWithValue("@ord", ord);
        command.Parameters.AddWithValue("@mod", mod);
        command.Parameters.AddWithValue("@type", dueData.Type);
        command.Parameters.AddWithValue("@queue", dueData.Queue);
        command.Parameters.AddWithValue("@due", dueData.Due);
        command.Parameters.AddWithValue("@ivl", dueData.Interval);
        command.Parameters.AddWithValue("@factor", dueData.Factor);
        command.Parameters.AddWithValue("@reps", dueData.Reps);
        command.Parameters.AddWithValue("@lapses", dueData.Lapses);
        command.Parameters.AddWithValue("@flags", flags);
        command.Parameters.AddWithValue("@data", dueData.Data);
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Maps one stored schedule onto Anki's card row fields.</summary>
    private static AnkiDueData BuildExportScheduling(
        AnkiExportRow row,
        DateTimeOffset collectionCreatedAt)
    {
        var schedule = row.Schedule;
        var (type, queue) = schedule.FsrsState switch
        {
            FlashcardFsrsState.Learning => (AnkiCardTypeLearning, 1),
            FlashcardFsrsState.Review => (AnkiCardTypeReview, 2),
            FlashcardFsrsState.Relearning => (AnkiCardTypeRelearning, 1),
            _ => (0, 0),
        };

        if (row.State == FlashcardCardState.Suspended)
            queue = AnkiQueueSuspended;

        var due = schedule.FsrsState switch
        {
            FlashcardFsrsState.New => 0L,
            FlashcardFsrsState.Review => (long)Math.Round(
                (schedule.DueDate - collectionCreatedAt).TotalDays,
                MidpointRounding.AwayFromZero),
            _ => schedule.DueDate.ToUnixTimeSeconds(),
        };

        var interval = schedule.FsrsState == FlashcardFsrsState.New
            ? 0
            : Math.Max(1, (int)Math.Round(
                (schedule.DueDate - (schedule.LastReviewedAt ?? schedule.DueDate)).TotalDays,
                MidpointRounding.AwayFromZero));

        return new AnkiDueData(
            type,
            queue,
            due,
            interval,
            AnkiRevlog.ExportFactor,
            Math.Max(0, schedule.Reps),
            Math.Max(0, schedule.Lapses),
            ExportMemoryData(schedule));
    }

    private static string ExportMemoryData(FlashcardSchedule schedule)
    {
        if (schedule.Stability is not { } stability
            || schedule.Difficulty is not { } difficulty
            || !double.IsFinite(stability)
            || !double.IsFinite(difficulty))
        {
            return string.Empty;
        }

        stability = Math.Clamp(stability, FsrsForwardModel.MinStability, FsrsForwardModel.MaxStability);
        difficulty = Math.Clamp(difficulty, 1d, 10d);
        return string.Create(
            CultureInfo.InvariantCulture,
            $"{{\"s\":{stability:0.0000},\"d\":{difficulty:0.000}}}");
    }

    /// <summary>
    /// Writes the answers recorded against the exported cards into the package's review log.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Without this, leaving costs a user everything they have already answered. The other app can
    /// read a history it did not record, so there is no reason for one to be thrown away at the door.
    /// </para>
    /// <para>
    /// Only the cards actually written out are asked about, and those came from the library's own
    /// listing, so a card the trash is holding contributes nothing: its history is kept and comes
    /// back with it, and a package of a deck does not quietly carry away what somebody deleted.
    /// </para>
    /// </remarks>
    private async Task WriteReviewHistoryAsync(
        SqliteConnection connection,
        IReadOnlyList<(string CardId, long PackageCardId)> exported,
        CancellationToken cancellationToken)
    {
        if (exported.Count == 0)
            return;

        var packageIdByCard = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var (cardId, packageCardId) in exported)
            packageIdByCard[cardId] = packageCardId;

        // The row's key is the instant it was answered, and two answers can share a millisecond.
        // A collision would silently drop one of them, so a taken key is stepped past.
        var usedIds = new HashSet<long>();

        foreach (var page in exported.Select(e => e.CardId).Chunk(CardPageSize))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var history = await _history.ListForCardsAsync(page, cancellationToken).ConfigureAwait(false);
            foreach (var log in history)
            {
                if (!packageIdByCard.TryGetValue(log.CardId, out var packageCardId))
                    continue;

                var id = log.ReviewedAt.ToUnixTimeMilliseconds();
                while (!usedIds.Add(id))
                    id++;

                var row = AnkiRevlog.FromReviewLog(log, id);
                await InsertRevlogAsync(connection, row, packageCardId, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private static async Task InsertRevlogAsync(
        SqliteConnection connection, AnkiRevlogRow row, long cardId, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        // How long the answer took is not recorded here, so the column stays at zero rather than
        // carrying a number nobody measured.
        command.CommandText = """
                              INSERT INTO revlog(id, cid, usn, ease, ivl, lastIvl, factor, time, type)
                              VALUES(@id, @cid, 0, @ease, @ivl, @lastIvl, @factor, 0, @type)
                              """;
        command.Parameters.AddWithValue("@id", row.Id);
        command.Parameters.AddWithValue("@cid", cardId);
        command.Parameters.AddWithValue("@ease", row.Ease);
        command.Parameters.AddWithValue("@ivl", row.Interval);
        command.Parameters.AddWithValue("@lastIvl", row.LastInterval);
        command.Parameters.AddWithValue("@factor", row.Factor);
        command.Parameters.AddWithValue("@type", row.Type);
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// One card side as Anki field HTML: the card's text followed by an <c>&lt;img&gt;</c> for each
    /// image on that side.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Images live on the card as attachments. Reading them off the rich blocks instead finds
    /// nothing, because the block pipeline emits no image blocks, and a deck full of pictures
    /// would export as a deck of bare text.
    /// </para>
    /// <para>
    /// Maths goes back into the delimiters the receiving app draws. Text is rewritten before the
    /// pictures are appended, so a filename that happens to hold a dollar is never read as a formula.
    /// </para>
    /// </remarks>
    private static string BuildFieldHtml(
        string plain,
        IReadOnlyList<Block>? blocks,
        IReadOnlyList<FlashcardAttachment>? attachments,
        string side,
        string tempRoot,
        MediaExportState media,
        ICollection<TransferWarning> warnings)
    {
        var fragments = new List<string>();
        if (blocks is { Count: > 0 })
        {
            foreach (var block in blocks.OrderBy(b => b.Order))
            {
                var text = block.Spans is { Count: > 0 } ? SerializeSpansToHtml(block.Spans) : WebUtility.HtmlEncode(block.Content);
                fragments.Add(AnkiMathDelimiters.ToAnkiField(text));
            }
        }
        else
        {
            // Anki collapses a raw newline to a space, so a multi-line card would arrive as one run-on line.
            fragments.Add(AnkiMathDelimiters.ToAnkiField(
                WebUtility.HtmlEncode(plain ?? string.Empty).Replace("\n", "<br>", StringComparison.Ordinal)));
        }

        foreach (var attachment in attachments ?? Array.Empty<FlashcardAttachment>())
        {
            if (!string.Equals(attachment.Side, side, StringComparison.OrdinalIgnoreCase))
                continue;

            var exportedName = TryCopyMedia(attachment.FilePath, tempRoot, media, warnings);
            if (exportedName != null)
                fragments.Add($"<img src=\"{WebUtility.HtmlEncode(exportedName)}\">");
        }

        return string.Join("<br>", fragments.Where(f => !string.IsNullOrWhiteSpace(f)));
    }

    private static string? TryCopyMedia(
        string sourcePath,
        string tempRoot,
        MediaExportState media,
        ICollection<TransferWarning> warnings)
    {
        if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath))
        {
            warnings.Add(TransferWarning.Of("AnkiExportImageMissing", ("filePath", sourcePath)));
            return null;
        }

        if (media.TryGetExportedName(sourcePath, out var already))
            return already;

        var exportedName = media.ReserveName(Path.GetFileName(sourcePath));
        var slot = media.NextSlot();
        File.Copy(sourcePath, Path.Combine(tempRoot, slot), overwrite: true);
        media.Record(sourcePath, slot, exportedName);
        return exportedName;
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

    /// <summary>
    /// Reads Unix seconds, falling back to milliseconds when seconds overflow. Returns false if
    /// neither interpretation is representable.
    /// </summary>
    private static bool TryReadUnixTimestamp(long value, out DateTimeOffset instant)
    {
        instant = default;
        if (value <= 0)
            return false;

        if (value <= MaxUnixSeconds)
        {
            instant = DateTimeOffset.FromUnixTimeSeconds(value);
            return true;
        }

        if (value <= MaxUnixMilliseconds)
        {
            instant = DateTimeOffset.FromUnixTimeMilliseconds(value);
            return true;
        }

        return false;
    }

    private static DateTimeOffset ParseUnixTimestamp(long value) =>
        TryReadUnixTimestamp(value, out var instant) ? instant : DateTimeOffset.UtcNow;

    /// <summary>
    /// Turns one Anki card row's scheduling into the state this app keeps. A new card carries only
    /// its place in the new queue. Native FSRS memory wins over review-log replay, which wins over
    /// the published SM-2 approximation. A card with none of those keeps its schedule without memory.
    /// </summary>
    private static FlashcardImportedSchedule? BuildImportedSchedule(
        CardRow card,
        DateTimeOffset collectionCreatedAt,
        IReadOnlyDictionary<long, List<AnkiRevlogRow>> revlog,
        double[] weights,
        DateTimeOffset now,
        ImportTally tally)
    {
        var state = card.Type switch
        {
            AnkiCardTypeLearning => FlashcardFsrsState.Learning,
            AnkiCardTypeReview => FlashcardFsrsState.Review,
            AnkiCardTypeRelearning => FlashcardFsrsState.Relearning,
            _ => FlashcardFsrsState.New
        };

        // A new card's due is its place in the queue, not a date. One tick per place keeps that
        // order, since the new queue sorts by due date and new cards are not gated on it.
        if (state == FlashcardFsrsState.New)
            return new FlashcardImportedSchedule(now.AddTicks(card.NewRank), null, null, 0, 0, FlashcardFsrsState.New, null);

        var due = ResolveDueDate(card, state, collectionCreatedAt, now);

        // Derive the last review from the due date and interval. Leave it unset if the subtraction
        // exceeds the date range.
        DateTimeOffset? lastReviewedAt = null;
        if (card.IntervalDays > 0 && (due - DateTimeOffset.MinValue).TotalDays > card.IntervalDays)
            lastReviewedAt = due.AddDays(-card.IntervalDays);
        if (lastReviewedAt > now)
            lastReviewedAt = null;

        var memory = ReadAnkiMemory(card.Data)
            ?? ReplayMemory(card.Id, revlog, weights)
            ?? FsrsSm2Memory.Approximate(
                AnkiRevlog.EaseFactor(card.Factor), card.IntervalDays, 0.9d, weights);

        if (memory is null)
            tally.CardsWithoutMemory++;
        else
            tally.CardsWithMemory++;

        return new FlashcardImportedSchedule(
            due,
            memory?.Stability,
            memory?.Difficulty,
            Math.Max(0, card.Reps),
            Math.Max(0, card.Lapses),
            state,
            lastReviewedAt);
    }

    private static FsrsForwardModel.MemoryState? ReplayMemory(
        long cardId,
        IReadOnlyDictionary<long, List<AnkiRevlogRow>> revlog,
        double[] weights)
    {
        if (!revlog.TryGetValue(cardId, out var rows))
            return null;

        return AnkiMemoryState.Replay(rows, weights);
    }

    private static FsrsForwardModel.MemoryState? ReadAnkiMemory(string data)
    {
        if (string.IsNullOrWhiteSpace(data))
            return null;

        try
        {
            using var document = JsonDocument.Parse(data);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("s", out var stabilityValue)
                || !root.TryGetProperty("d", out var difficultyValue)
                || stabilityValue.ValueKind != JsonValueKind.Number
                || difficultyValue.ValueKind != JsonValueKind.Number
                || !stabilityValue.TryGetDouble(out var stability)
                || !difficultyValue.TryGetDouble(out var difficulty)
                || !double.IsFinite(stability)
                || !double.IsFinite(difficulty)
                || stability <= 0d
                || difficulty <= 0d)
            {
                return null;
            }

            // Anki only ever writes a positive pair, so a zero or negative value is not a measurement
            // that needs clamping but a slot something else wrote, and the review log is the better
            // witness. Values past the ceiling are real measurements the scheduler cannot hold.
            return new FsrsForwardModel.MemoryState(
                Math.Clamp(stability, FsrsForwardModel.MinStability, FsrsForwardModel.MaxStability),
                Math.Clamp(difficulty, 1d, 10d));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Anki spells a due date two ways: whole days since the collection was made, and, for a card
    /// mid-session, an absolute second. The number itself is the only thing that tells them apart.
    /// </summary>
    private static DateTimeOffset ResolveDueDate(
        CardRow card,
        FlashcardFsrsState state,
        DateTimeOffset collectionCreatedAt,
        DateTimeOffset now)
    {
        var raw = card.EffectiveDue;
        if (raw <= 0 && state != FlashcardFsrsState.Review)
            return now;

        // Invalid timestamps must not abort an otherwise readable import.
        DateTimeOffset due;
        if (raw >= SecondsSinceEpochThreshold)
        {
            if (!TryReadUnixTimestamp(raw, out due))
                return now;
        }
        else if (raw < (DateTimeOffset.MinValue - collectionCreatedAt).TotalDays
                 || raw > (DateTimeOffset.MaxValue - collectionCreatedAt).TotalDays)
        {
            return now;
        }
        else
        {
            due = collectionCreatedAt.AddDays(raw);
        }

        // A card that is already late stays late; one dated beyond any plausible schedule is a
        // corrupt row, and burying it a century out would hide it forever.
        if (due < now.AddDays(-MaxCarriedDueDays) || due > now.AddDays(MaxCarriedDueDays))
            return now;

        // A learning card's step is not carried, so it comes back at its next opportunity rather
        // than at a minute that no longer means anything.
        return state == FlashcardFsrsState.Learning && due < now ? now : due;
    }

    private static DateTimeOffset ParseCollectionCreatedAt(long crtRaw)
    {
        if (crtRaw <= 0)
            return DateTimeOffset.UtcNow.Date;

        if (crtRaw >= SecondsSinceEpochThreshold && TryReadUnixTimestamp(crtRaw, out var timestamp))
            return timestamp;

        // Old packages written with a day count are still accepted even though Anki's collection
        // creation field is a Unix timestamp in seconds.
        const long maxReasonableAnkiDays = MaxUnixSeconds / 86400L; // up to year 9999
        if (crtRaw <= maxReasonableAnkiDays)
            return DateTimeOffset.FromUnixTimeSeconds(crtRaw * 86400L);

        return ParseUnixTimestamp(crtRaw);
    }

    private async Task TryDeleteDeckAsync(string deckId, CancellationToken cancellationToken)
    {
        try
        {
            await _library.DeleteDeckAsync(deckId, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The deck stays, empty. Failing the cleanup must not replace the real failure.
        }
    }

    private sealed record OpenedApkg(
        string TempDirectory,
        SqliteConnection Connection,
        MediaIndex Media,
        IReadOnlyList<TransferWarning> Warnings) : IAsyncDisposable
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
    /// Both sides of what a note shows, read once. The question's original HTML is kept alongside
    /// its text because a marker that survives only in the markup still says what kind of card it is.
    /// </summary>
    private sealed record NoteSides(string FrontHtml, SideContent Front, SideContent Back)
    {
        /// <summary>Every picture on the note, each still tagged with the side it arrived on.</summary>
        public IReadOnlyList<FlashcardAttachment> Attachments =>
            Front.Attachments.Count == 0 && Back.Attachments.Count == 0
                ? Array.Empty<FlashcardAttachment>()
                : [.. Front.Attachments, .. Back.Attachments];
    }

    /// <summary>What an import noticed while reading, reported once at the end rather than per card.</summary>
    private sealed class ImportTally
    {
        public SortedSet<string> NoteTypesWithExtraFields { get; } = new(StringComparer.OrdinalIgnoreCase);

        public int CardsWithAudio { get; set; }

        public int CardsWithMemory { get; set; }

        public int OcclusionCards { get; set; }

        public int OcclusionSkippedNoImage { get; set; }

        public int OcclusionTextLabels { get; set; }

        public int OcclusionRotatedShapes { get; set; }

        public int OcclusionCardsWithoutShape { get; set; }

        public int OcclusionCommentsLeftBehind { get; set; }

        public int OcclusionPicturesSkipped { get; set; }

        public int OcclusionRepeatsSkipped { get; set; }

        public int CardsWithoutMemory { get; set; }
    }

    /// <summary>
    /// How a package's rows are divided up before anything is written.
    /// </summary>
    /// <param name="NotesFiledTogether">
    /// How many notes had their cards spread over more than one deck and were kept together in one.
    /// </param>
    private sealed record AnkiImportPlan(IReadOnlyList<AnkiDeckPlan> Decks, int NotesFiledTogether);

    /// <summary>What one deck receives: rows that stand for themselves, and notes that make several.</summary>
    private sealed record AnkiDeckPlan(
        long DeckId,
        IReadOnlyList<CardRow> Rows,
        IReadOnlyList<AnkiMaterialNote> MaterialNotes);

    /// <summary>
    /// A note that lands as one piece of material. Its rows are keyed by deletion number for cloze,
    /// and by template ordinal for a basic and reversed note.
    /// </summary>
    private sealed record AnkiMaterialNote(
        NoteRow Note,
        IReadOnlyDictionary<int, CardRow> Rows,
        bool IsReverse = false,
        AnkiOcclusionNote? Occlusion = null);

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
        IReadOnlyDictionary<long, string> Models,
        IReadOnlyDictionary<long, AnkiNoteType> NoteTypes);

    private sealed record NoteRow(long Id, string Tags, string[] Fields, long ModelId)
    {
        public string? ModelName { get; set; }
    }

    private sealed record CardRow(
        long Id,
        long NoteId,
        long DeckId,
        /// <summary>Which of the note type's templates this card comes from.</summary>
        int Ord,
        int Type,
        int Queue,
        long Due,
        int IntervalDays,
        int Factor,
        int Reps,
        int Lapses,
        DateTimeOffset LastModifiedAt,
        long OriginalDue,
        long OriginalDeckId,
        string Data,
        /// <summary>Whether the card carries any of Anki's colored flags.</summary>
        bool IsFlagged)
    {
        /// <summary>The deck the card belongs to once it leaves whatever filtered deck holds it.</summary>
        public long HomeDeckId => OriginalDeckId != 0 ? OriginalDeckId : DeckId;

        /// <summary>The due value that survives the filtered deck it is parked in.</summary>
        public long EffectiveDue => OriginalDeckId != 0 && OriginalDue != 0 ? OriginalDue : Due;

        /// <summary>A new card's place in the package's new queue, counted from zero.</summary>
        public int NewRank { get; init; }
    }

    private sealed record AnkiDueData(
        int Type,
        int Queue,
        long Due,
        int Interval,
        int Factor,
        int Reps,
        int Lapses,
        string Data);

    /// <summary>Projection of a deck assembled from the relational store for export.</summary>
    private sealed record AnkiExportDeck(string Id, string Name, string? Description, IReadOnlyList<AnkiExportNote> Notes);

    /// <summary>Card content and scheduling projected for export.</summary>
    private sealed record AnkiExportCard(
        string Id,
        string Front,
        string Back,
        IReadOnlyList<string> Tags,
        IReadOnlyList<FlashcardAttachment>? Attachments,
        IReadOnlyList<Block>? FrontBlocks,
        IReadOnlyList<Block>? BackBlocks,
        string? FactId,
        string? LayoutKey,
        FlashcardCardState State,
        bool IsFlagged,
        FlashcardSchedule Schedule);

    /// <summary>
    /// Material written out as one note of several cards. For cloze, the text with every deletion
    /// still in it and what every card also shows; for basic and reverse, its front and back.
    /// </summary>
    /// <param name="Attachments">The note's media by side, or null to take the first card's.</param>
    private sealed record AnkiExportMaterial(
        string Text,
        string Extra,
        IReadOnlyList<string> Tags,
        bool IsReverse = false,
        IReadOnlyList<FlashcardAttachment>? Attachments = null);

    /// <summary>
    /// One note being written out, and the card rows it makes.
    /// </summary>
    /// <remarks>
    /// A card that stands for itself is one note with one row. A piece of material whose cards are
    /// its deletions is one note with a row per deletion, which is the only shape in which the
    /// receiving app understands them as siblings: exported a note each, they arrive as unrelated
    /// cards that all show the same sentence and never hold one another back.
    /// </remarks>
    private sealed record AnkiExportNote(
        long ModelId,
        long NoteId,
        string Guid,
        string FirstFieldText,
        IReadOnlyList<Block>? FirstFieldBlocks,
        string SecondFieldText,
        IReadOnlyList<Block>? SecondFieldBlocks,
        IReadOnlyList<FlashcardAttachment>? Attachments,
        IReadOnlyList<string> Tags,
        string SortField,
        List<AnkiExportRow> Rows);

    /// <summary>One card row of a note being written out.</summary>
    /// <param name="Ord">
    /// Which of the note's cards this is. A deletion written as <c>c2</c> is row one, because the
    /// receiving app numbers them from zero while the deletion is written from one.
    /// </param>
    private sealed record AnkiExportRow(
        string CardId,
        int Ord,
        FlashcardCardState State,
        bool IsFlagged,
        FlashcardSchedule Schedule);

    /// <summary>
    /// The media table being assembled for an export: which numbered file each image was copied to,
    /// and the filename it is referenced by.
    /// </summary>
    /// <remarks>
    /// Two images can share a filename while being different pictures, since the name a card shows
    /// is the one the file had wherever it came from. Keying by that name alone made the second one
    /// resolve to the first, so a card silently displayed someone else's picture. Identity is the
    /// stored file, and a name already taken is given a suffix.
    /// </remarks>
    private sealed class MediaExportState
    {
        private readonly Dictionary<string, string> _nameBySourcePath = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _usedNames = new(StringComparer.OrdinalIgnoreCase);
        private int _counter;

        /// <summary>Slot inside the package to the filename cards reference it by.</summary>
        public Dictionary<string, string> Map { get; } = new(StringComparer.Ordinal);

        public bool TryGetExportedName(string sourcePath, [MaybeNullWhen(false)] out string exportedName) =>
            _nameBySourcePath.TryGetValue(sourcePath, out exportedName);

        public string ReserveName(string preferredName)
        {
            var name = string.IsNullOrWhiteSpace(preferredName) ? "image" : preferredName;
            if (!_usedNames.Contains(name))
                return name;

            var stem = Path.GetFileNameWithoutExtension(name);
            var extension = Path.GetExtension(name);
            for (var suffix = 2; ; suffix++)
            {
                var candidate = $"{stem}_{suffix.ToString(CultureInfo.InvariantCulture)}{extension}";
                if (!_usedNames.Contains(candidate))
                    return candidate;
            }
        }

        public string NextSlot() => (_counter++).ToString(CultureInfo.InvariantCulture);

        public void Record(string sourcePath, string slot, string exportedName)
        {
            Map[slot] = exportedName;
            _usedNames.Add(exportedName);
            _nameBySourcePath[sourcePath] = exportedName;
        }
    }
}
