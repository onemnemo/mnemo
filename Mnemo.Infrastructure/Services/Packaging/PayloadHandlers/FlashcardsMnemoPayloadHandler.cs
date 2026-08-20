using System.Globalization;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// Reads and writes the flashcards payload of a <c>.mnemo</c> package: a SQLite database of deck,
/// folder, material, card type, scheduling profile and review rows, plus the image files they name.
/// </summary>
/// <remarks>
/// The two original tables keep their shape, so a package this build writes still opens in a build
/// that predates the rest, and a package written before those tables existed still imports here.
/// A package from a build newer than this one is refused outright rather than read for whatever
/// happens to line up: the user would end up with a collection that looks restored and is not.
/// </remarks>
public sealed class FlashcardsMnemoPayloadHandler : IMnemoPayloadHandler, IMnemoPayloadInspector
{
    private const string AssetPrefix = "assets/images/";

    /// <summary>
    /// The payload layout this build writes, and the newest one it knows how to read. Version 2
    /// added attachment bytes, suspension and flags; version 3 added material, card types,
    /// scheduling profiles and review history, and gave a card the material it renders.
    /// </summary>
    private const int PayloadSchemaVersion = 3;

    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardCardService _cards;
    private readonly IFlashcardPresetService _presetService;
    private readonly IFlashcardStore _store;
    private readonly IFolderRepository _folders;
    private readonly IDeckRepository _decks;
    private readonly ICardRepository _cardRows;
    private readonly IFactRepository _facts;
    private readonly ICardTypeRepository _cardTypes;
    private readonly IPresetRepository _presets;
    private readonly IScheduleRepository _schedules;
    private readonly IReviewRepository _reviews;
    private readonly IDailyStatsRepository _dailyStats;
    private readonly ILoggerService _logger;

    public FlashcardsMnemoPayloadHandler(
        IFlashcardLibraryService library,
        IFlashcardCardService cards,
        IFlashcardPresetService presetService,
        IFlashcardStore store,
        IFolderRepository folders,
        IDeckRepository decks,
        ICardRepository cardRows,
        IFactRepository facts,
        ICardTypeRepository cardTypes,
        IPresetRepository presets,
        IScheduleRepository schedules,
        IReviewRepository reviews,
        IDailyStatsRepository dailyStats,
        ILoggerService logger)
    {
        _library = library;
        _cards = cards;
        _presetService = presetService;
        _store = store;
        _folders = folders;
        _decks = decks;
        _cardRows = cardRows;
        _facts = facts;
        _cardTypes = cardTypes;
        _presets = presets;
        _schedules = schedules;
        _reviews = reviews;
        _dailyStats = dailyStats;
        _logger = logger;
    }

    public string PayloadType => "flashcards";

    public async Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default)
    {
        var capture = new FlashcardCollectionCapture(
            _library, _cards, _store, _presets, _cardTypes, _facts, _reviews, _dailyStats);
        var captured = await capture.CaptureAsync(context.Options, cancellationToken).ConfigureAwait(false);

        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase)
        {
            [FlashcardPayloadDatabase.FileName] = FlashcardPayloadDatabase.Write(captured.Snapshot),
        };
        AddImageAssets(files, captured.AttachmentPaths);

        return new MnemoPayloadExportData
        {
            ItemCount = captured.Snapshot.Decks.Count,
            SchemaVersion = PayloadSchemaVersion,
            Files = files,
        };
    }

    public async Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
    {
        if (RefusalFor(context.Entry) is { } refusal)
            return refusal;

        if (!context.Files.TryGetValue(FlashcardPayloadDatabase.FileName, out var bytes))
            return new MnemoPayloadImportResult { Warnings = { TransferWarning.Of("FlashcardsPayloadMissingFile") } };

        if (ReadSnapshot(bytes) is not { } snapshot)
            return new MnemoPayloadImportResult { Warnings = { TransferWarning.Of("FlashcardsPayloadUnreadable") } };

        RestoreImageAssets(context.Files);

        var restore = new FlashcardCollectionRestore(
            _store, _presetService, _folders, _decks, _cardRows, _facts, _cardTypes,
            _presets, _schedules, _reviews, _dailyStats, _logger);
        return await restore.RestoreAsync(snapshot, context.Options.ConflictPolicy, cancellationToken).ConfigureAwait(false);
    }

    public async Task<MnemoPayloadEvidence> InspectAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
    {
        var evidence = new MnemoPayloadEvidence
        {
            PayloadType = PayloadType,
            PayloadVersion = context.Entry.SchemaVersion,
            SupportedPayloadVersion = PayloadSchemaVersion,
            CanRead = context.Entry.SchemaVersion <= PayloadSchemaVersion,
        };

        if (!evidence.CanRead
            || !context.Files.TryGetValue(FlashcardPayloadDatabase.FileName, out var bytes)
            || ReadSnapshot(bytes) is not { } snapshot)
        {
            return evidence;
        }

        var packagedDeckIds = new HashSet<string>(snapshot.Decks.Select(d => d.Id), StringComparer.Ordinal);
        var packagedCardIds = new HashSet<string>(
            snapshot.Decks.SelectMany(d => d.Cards ?? new List<CardSnapshotDto>()).Select(c => c.Id),
            StringComparer.Ordinal);

        evidence.InPackage = snapshot.Decks.Count;

        await _store.ReadAsync(async (conn, ct) =>
        {
            var localDecks = await _decks.ListHeadersAsync(conn, ct).ConfigureAwait(false);
            foreach (var deck in localDecks)
            {
                if (!packagedDeckIds.Contains(deck.Id))
                {
                    evidence.MissingFromPackage++;
                    continue;
                }

                evidence.AlreadyHere++;

                // What a replace destroys is what sits in a deck the package also carries and that
                // the package itself does not contain. Everything else either comes back or is
                // never touched, so counting it would overstate the damage.
                foreach (var card in await _cardRows.ListByDeckAsync(conn, deck.Id, ct).ConfigureAwait(false))
                {
                    if (!packagedCardIds.Contains(card.Id))
                        evidence.ReplaceWouldDiscard++;
                }
            }

            return true;
        }, cancellationToken).ConfigureAwait(false);

        evidence.NewHere = evidence.InPackage - evidence.AlreadyHere;
        return evidence;
    }

    /// <summary>
    /// The refusal a payload from a newer build earns, or null when this build can read it.
    /// </summary>
    /// <remarks>
    /// Reading it as if it were the format below would import whatever happens to line up and
    /// quietly drop the rest, which is worse than not importing it at all: the user would end up
    /// with decks that look restored and are not. Refusing leaves the package intact for a build
    /// that understands it.
    /// </remarks>
    private MnemoPayloadImportResult? RefusalFor(MnemoPackageEntry entry)
    {
        if (entry.SchemaVersion <= PayloadSchemaVersion)
            return null;

        var version = entry.SchemaVersion;
        _logger.Warning("Flashcards", $"Refused a flashcards payload in format {version}; this build reads up to {PayloadSchemaVersion}.");
        return new MnemoPayloadImportResult
        {
            Warnings = { TransferWarning.Of(
                "FlashcardsPackageTooNew",
                ("packageVersion", version.ToString(CultureInfo.InvariantCulture)),
                ("supportedVersion", PayloadSchemaVersion.ToString(CultureInfo.InvariantCulture))) },
        };
    }

    /// <summary>
    /// The package's database, or null when it cannot be read at all. A file the user was handed
    /// can be truncated, half downloaded or not a database, and that is a reason to skip the
    /// flashcards in the package rather than to fail the package: the notes and maps beside them
    /// are still perfectly readable.
    /// </summary>
    private FlashcardPayloadSnapshot? ReadSnapshot(byte[] bytes)
    {
        try
        {
            return FlashcardPayloadDatabase.Read(bytes);
        }
        catch (Exception ex) when (ex is SqliteException or System.Text.Json.JsonException or InvalidDataException or IOException)
        {
            _logger.Warning("Flashcards", $"Flashcards payload could not be read: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Copies every attachment's bytes into the package. Without them a backup restores cards whose
    /// pictures point at files only the machine that wrote the package ever had.
    /// </summary>
    private void AddImageAssets(IDictionary<string, byte[]> files, IReadOnlyList<string> attachmentPaths)
    {
        foreach (var path in attachmentPaths)
        {
            var fileName = Path.GetFileName(path);
            if (string.IsNullOrWhiteSpace(fileName))
                continue;

            var key = AssetPrefix + fileName;
            if (files.ContainsKey(key))
                continue;

            if (!File.Exists(path))
            {
                // A picture the user already deleted must never fail the export.
                _logger.Warning("Flashcards", $"Skipping missing card image '{path}' while exporting.");
                continue;
            }

            files[key] = File.ReadAllBytes(path);
        }
    }

    /// <summary>
    /// Writes packaged attachment bytes into the local images directory. A file already there is
    /// left alone: a restore must never overwrite a picture this machine's own cards point at.
    /// </summary>
    private static void RestoreImageAssets(IReadOnlyDictionary<string, byte[]> files)
    {
        string? imagesDirectory = null;
        foreach (var pair in files)
        {
            if (!pair.Key.StartsWith(AssetPrefix, StringComparison.OrdinalIgnoreCase))
                continue;

            var fileName = Path.GetFileName(pair.Key.Replace('\\', '/'));
            if (string.IsNullOrWhiteSpace(fileName))
                continue;

            if (imagesDirectory is null)
            {
                imagesDirectory = MnemoAppPaths.GetImagesDirectory();
                Directory.CreateDirectory(imagesDirectory);
            }

            var destination = Path.Combine(imagesDirectory, fileName);
            if (File.Exists(destination))
                continue;

            File.WriteAllBytes(destination, pair.Value);
        }
    }
}
