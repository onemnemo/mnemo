using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Common;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// Reads/writes the flashcards payload of a <c>.mnemo</c> package. The on-disk wire format is
/// unchanged from the legacy handler — a SQLite database with <c>Decks</c>/<c>Folders</c> tables of
/// JSON-serialized deck/folder snapshots (camelCase, enums as ints) — but the storage side now maps
/// to the relational store (deck header + cards + FSRS schedules) at the boundary.
/// </summary>
/// <remarks>
/// The snapshot DTOs below mirror the legacy <c>FlashcardDeck</c>/<c>Flashcard</c>/<c>FlashcardFolder</c>
/// JSON shape so previously exported packages still import. Legacy-only fields that the relational
/// store no longer tracks are filled with neutral values on export: <c>retrievability</c> and
/// <c>leitnerBox</c> are always null, <c>schedulingAlgorithm</c> is always FSRS, and deck
/// <c>retentionScore</c> carries the summary's retention percent. New card-only fields (state, flags,
/// attachments) are not part of the legacy wire shape and are dropped on export.
/// </remarks>
public sealed class FlashcardsMnemoPayloadHandler : IMnemoPayloadHandler
{
    private const int CardPageSize = 200;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardCardService _cards;
    private readonly IFlashcardPresetService _presets;
    private readonly IFlashcardStore _store;
    private readonly IScheduleRepository _schedules;
    private readonly ILoggerService _logger;

    public FlashcardsMnemoPayloadHandler(
        IFlashcardLibraryService library,
        IFlashcardCardService cards,
        IFlashcardPresetService presets,
        IFlashcardStore store,
        IScheduleRepository schedules,
        ILoggerService logger)
    {
        _library = library;
        _cards = cards;
        _presets = presets;
        _store = store;
        _schedules = schedules;
        _logger = logger;
    }

    public string PayloadType => "flashcards";

    public async Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default)
    {
        var folders = await _library.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
        var summaries = await _library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        var selectedDeckIds = ResolveSelectedDeckIds(context.Options);
        if (selectedDeckIds.Count > 0)
        {
            summaries = summaries.Where(d => selectedDeckIds.Contains(d.Id)).ToArray();
            var usedFolderIds = new HashSet<string>(
                summaries.Where(d => !string.IsNullOrWhiteSpace(d.Header.FolderId)).Select(d => d.Header.FolderId!),
                StringComparer.Ordinal);
            folders = folders.Where(f => usedFolderIds.Contains(f.Id)).ToArray();
        }

        var deckSnapshots = new List<DeckSnapshotDto>(summaries.Count);
        foreach (var summary in summaries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            deckSnapshots.Add(await BuildDeckSnapshotAsync(summary, cancellationToken).ConfigureAwait(false));
        }

        var folderSnapshots = folders
            .Select(f => new FolderSnapshotDto { Id = f.Id, Name = f.Name, ParentId = f.ParentId, Order = f.Order })
            .ToList();

        return new MnemoPayloadExportData
        {
            ItemCount = deckSnapshots.Count,
            SchemaVersion = 1,
            Files = new Dictionary<string, byte[]>
            {
                ["flashcards.db"] = BuildFlashcardsSqlite(deckSnapshots, folderSnapshots)
            }
        };
    }

    public async Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
    {
        if (!context.Files.TryGetValue("flashcards.db", out var bytes))
            return new MnemoPayloadImportResult { Warnings = { "Flashcards payload missing flashcards.db file." } };

        var snapshot = ReadFlashcardsSqlite(bytes);
        var existingFolders = await _library.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
        var existingDecks = await _library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        var existingFolderIds = new HashSet<string>(existingFolders.Select(f => f.Id), StringComparer.Ordinal);
        var existingDeckIds = new HashSet<string>(existingDecks.Select(d => d.Id), StringComparer.Ordinal);
        var folderMap = new Dictionary<string, string>(StringComparer.Ordinal);

        var result = new MnemoPayloadImportResult();
        var policy = context.Options.ConflictPolicy;
        var usedDeckNames = new HashSet<string>(existingDecks.Select(d => d.Name), StringComparer.OrdinalIgnoreCase);

        // New decks bind to the shared Standard preset (same as migration and other imports).
        var preset = await _presets.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(false);

        foreach (var folder in snapshot.Folders)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var id = folder.Id;
            if (existingFolderIds.Contains(id))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    folderMap[folder.Id] = id;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    id = Guid.NewGuid().ToString();
                    result.DuplicatedCount++;
                }
            }

            var parentId = folder.ParentId;
            if (!string.IsNullOrWhiteSpace(parentId) && folderMap.TryGetValue(parentId, out var remappedParentId))
                parentId = remappedParentId;

            folderMap[folder.Id] = id;
            await _library.SaveFolderAsync(new FlashcardFolder(id, folder.Name, parentId, folder.Order), cancellationToken).ConfigureAwait(false);
        }

        foreach (var deck in snapshot.Decks)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var deckId = deck.Id;
            var deckName = deck.Name;
            if (existingDeckIds.Contains(deckId))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    result.SkippedCount++;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    deckId = Guid.NewGuid().ToString();
                    deckName = ImportNaming.NextAvailableName(deckName, usedDeckNames);
                    result.DuplicatedCount++;
                }
            }

            usedDeckNames.Add(deckName);
            var folderId = deck.FolderId;
            if (!string.IsNullOrWhiteSpace(folderId) && folderMap.TryGetValue(folderId, out var remappedFolderId))
                folderId = remappedFolderId;

            var now = DateTimeOffset.UtcNow;
            await _library.SaveDeckAsync(new FlashcardDeckHeader(
                Id: deckId,
                FolderId: folderId,
                PresetId: preset.Id,
                Name: deckName,
                Description: deck.Description,
                Tags: deck.Tags ?? Array.Empty<string>(),
                SortOrder: 0,
                LastStudied: deck.LastStudied,
                CreatedAt: now,
                UpdatedAt: now), cancellationToken).ConfigureAwait(false);

            await ImportDeckCardsAsync(deckId, deck, cancellationToken).ConfigureAwait(false);
            result.ImportedCount++;
        }

        return result;
    }

    private async Task ImportDeckCardsAsync(string deckId, DeckSnapshotDto deck, CancellationToken cancellationToken)
    {
        var cards = deck.Cards ?? new List<CardSnapshotDto>();
        if (cards.Count == 0)
            return;

        var isFsrs = deck.SchedulingAlgorithm == (int)FlashcardSchedulingAlgorithm.Fsrs;
        var drafts = new FlashcardCardDraft[cards.Count];
        for (var i = 0; i < cards.Count; i++)
        {
            var c = cards[i];

            // Convert legacy embedded image tokens (`![alt](path){align=...}`) into attachment
            // records at the import boundary so no downstream renderer needs the regex again.
            var conversion = FlashcardImageTokenConverter.Convert(c.Id, c.Front, c.Back);
            foreach (var warning in conversion.Warnings)
                _logger.Warning("Flashcards", warning.Message);

            drafts[i] = new FlashcardCardDraft(
                DeckId: deckId,
                Type: (FlashcardType)c.Type,
                Front: conversion.CleanFront,
                Back: conversion.CleanBack,
                Tags: c.Tags ?? Array.Empty<string>(),
                Attachments: conversion.Attachments,
                SourceInfo: BuildSourceInfo(c.SourceInfo),
                FrontBlocks: c.FrontBlocks,
                BackBlocks: c.BackBlocks);
        }

        // Bulk-create (one transaction); cards arrive New/due-now with an initial schedule.
        var created = await _cards.CreateCardsAsync(deckId, drafts, cancellationToken).ConfigureAwait(false);
        if (created.Count != cards.Count)
            _logger.Warning("Flashcards", $"Imported {created.Count}/{cards.Count} card(s) into deck '{deckId}'; some rows were skipped.");

        // Best-effort FSRS carry-over: only for FSRS-scheduled legacy decks; non-FSRS stays New/due-now.
        if (!isFsrs)
            return;

        var now = DateTimeOffset.UtcNow;
        var schedules = new List<FlashcardSchedule>(Math.Min(created.Count, cards.Count));
        for (var i = 0; i < created.Count && i < cards.Count; i++)
        {
            var source = cards[i];
            schedules.Add(new FlashcardSchedule(
                CardId: created[i].Id,
                DueDate: source.DueDate == default ? now : source.DueDate,
                Stability: source.Stability,
                Difficulty: source.Difficulty,
                Reps: source.ReviewCount ?? 0,
                Lapses: source.LapseCount ?? 0,
                FsrsState: (FlashcardFsrsState)(source.FsrsState ?? 0),
                LearningStepIndex: 0,
                LastReviewedAt: source.LastReviewedAt));
        }

        // Overwrite the initial New schedules the card service seeded, in one transaction.
        await _store.WriteAsync(async (conn, tx, ct) =>
        {
            foreach (var schedule in schedules)
                await _schedules.UpsertAsync(conn, tx, schedule, ct).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);
    }

    private async Task<DeckSnapshotDto> BuildDeckSnapshotAsync(FlashcardDeckSummary summary, CancellationToken cancellationToken)
    {
        var header = summary.Header;
        var cards = new List<CardSnapshotDto>();
        var offset = 0;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var page = await _cards.ListCardsAsync(
                new FlashcardCardQuery(header.Id, Offset: offset, Limit: CardPageSize),
                cancellationToken).ConfigureAwait(false);
            foreach (var view in page.Items)
                cards.Add(ToCardSnapshot(view));

            offset += page.Items.Count;
            if (page.Items.Count == 0 || offset >= page.TotalCount)
                break;
        }

        return new DeckSnapshotDto
        {
            Id = header.Id,
            Name = header.Name,
            FolderId = header.FolderId,
            Description = header.Description,
            Tags = header.Tags?.ToArray() ?? Array.Empty<string>(),
            LastStudied = header.LastStudied,
            RetentionScore = summary.RetentionPercent,
            Cards = cards,
            SchedulingAlgorithm = (int)FlashcardSchedulingAlgorithm.Fsrs
        };
    }

    private static CardSnapshotDto ToCardSnapshot(FlashcardView view)
    {
        var card = view.Card;
        var schedule = view.Schedule;
        return new CardSnapshotDto
        {
            Id = card.Id,
            DeckId = card.DeckId,
            // Attachments are not part of the legacy wire shape, so re-embed them as the same inline
            // `![alt](path){align=...}` tokens the migrator/import path strips — the exported snapshot
            // stays legacy-shaped and re-importing it converts the tokens back into attachments.
            Front = EmbedAttachmentsAsTokens(card.Front, card.Attachments, FlashcardAttachment.FrontSide),
            Back = EmbedAttachmentsAsTokens(card.Back, card.Attachments, FlashcardAttachment.BackSide),
            Type = (int)card.Type,
            Tags = card.Tags?.ToArray() ?? Array.Empty<string>(),
            DueDate = schedule.DueDate,
            Stability = schedule.Stability,
            Difficulty = schedule.Difficulty,
            Retrievability = null,
            SourceInfo = card.SourceInfo is { } s
                ? new SourceSnapshotDto { SourceType = s.SourceType, SourceId = s.SourceId, DisplayLabel = s.DisplayLabel }
                : null,
            FrontBlocks = card.FrontBlocks,
            BackBlocks = card.BackBlocks,
            ReviewCount = schedule.Reps,
            LapseCount = schedule.Lapses,
            LeitnerBox = null,
            LastReviewedAt = schedule.LastReviewedAt,
            FsrsState = (int)schedule.FsrsState
        };
    }

    private static FlashcardSourceInfo? BuildSourceInfo(SourceSnapshotDto? source) =>
        source is { SourceType: { } type, SourceId: { } id }
            ? new FlashcardSourceInfo(type, id, source.DisplayLabel)
            : null;

    /// <summary>
    /// Re-embeds a card side's attachments as trailing <c>![alt](path)</c> tokens (the caption becomes
    /// alt text) so a legacy-shaped export still carries the images, and re-importing it round-trips
    /// them back into attachments via <see cref="FlashcardImageTokenConverter"/>.
    /// </summary>
    private static string EmbedAttachmentsAsTokens(string text, IReadOnlyList<FlashcardAttachment>? attachments, string side)
    {
        if (attachments is null || attachments.Count == 0)
            return text;

        var sideAttachments = attachments.Where(a => string.Equals(a.Side, side, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (sideAttachments.Length == 0)
            return text;

        var tokens = sideAttachments.Select(a => $"![{a.Caption ?? string.Empty}]({a.FilePath})");
        var suffix = string.Join("\n", tokens);
        return string.IsNullOrEmpty(text) ? suffix : $"{text}\n\n{suffix}";
    }

    private static HashSet<string> ResolveSelectedDeckIds(MnemoPackageExportOptions options)
    {
        if (!options.PayloadOptions.TryGetValue("flashcards.deckIds", out var value))
            return new HashSet<string>(StringComparer.Ordinal);
        if (value is IEnumerable<string> ids)
            return new HashSet<string>(ids.Where(v => !string.IsNullOrWhiteSpace(v)), StringComparer.Ordinal);
        return new HashSet<string>(StringComparer.Ordinal);
    }

    private static byte[] BuildFlashcardsSqlite(IReadOnlyList<DeckSnapshotDto> decks, IReadOnlyList<FolderSnapshotDto> folders)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-flashcards-{Guid.NewGuid():N}.db");
        try
        {
            using (var connection = new SqliteConnection($"Data Source={tempPath}"))
            {
                connection.Open();
                using var cmd = connection.CreateCommand();
                cmd.CommandText = """
                                  CREATE TABLE IF NOT EXISTS Decks (
                                      DeckId TEXT PRIMARY KEY,
                                      Json TEXT NOT NULL
                                  );
                                  CREATE TABLE IF NOT EXISTS Folders (
                                      FolderId TEXT PRIMARY KEY,
                                      Json TEXT NOT NULL
                                  );
                                  """;
                cmd.ExecuteNonQuery();

                using var tx = connection.BeginTransaction();
                foreach (var deck in decks)
                {
                    using var insert = connection.CreateCommand();
                    insert.Transaction = tx;
                    insert.CommandText = "INSERT OR REPLACE INTO Decks (DeckId, Json) VALUES ($id, $json)";
                    insert.Parameters.AddWithValue("$id", deck.Id);
                    insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(deck, JsonOptions));
                    insert.ExecuteNonQuery();
                }

                foreach (var folder in folders)
                {
                    using var insert = connection.CreateCommand();
                    insert.Transaction = tx;
                    insert.CommandText = "INSERT OR REPLACE INTO Folders (FolderId, Json) VALUES ($id, $json)";
                    insert.Parameters.AddWithValue("$id", folder.Id);
                    insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(folder, JsonOptions));
                    insert.ExecuteNonQuery();
                }

                tx.Commit();
            }

            SqliteConnection.ClearAllPools();
            return File.ReadAllBytes(tempPath);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }

    private FlashcardSnapshot ReadFlashcardsSqlite(byte[] dbBytes)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-flashcards-import-{Guid.NewGuid():N}.db");
        try
        {
            File.WriteAllBytes(tempPath, dbBytes);
            var snapshot = new FlashcardSnapshot();
            using var connection = new SqliteConnection($"Data Source={tempPath}");
            connection.Open();

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT Json FROM Decks";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var deck = JsonSerializer.Deserialize<DeckSnapshotDto>(reader.GetString(0), JsonOptions);
                    if (deck != null)
                        snapshot.Decks.Add(deck);
                }
            }

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT Json FROM Folders";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var folder = JsonSerializer.Deserialize<FolderSnapshotDto>(reader.GetString(0), JsonOptions);
                    if (folder != null)
                        snapshot.Folders.Add(folder);
                }
            }

            SqliteConnection.ClearAllPools();
            return snapshot;
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }

    private sealed class FlashcardSnapshot
    {
        public List<FolderSnapshotDto> Folders { get; } = new();
        public List<DeckSnapshotDto> Decks { get; } = new();
    }

    // --- Snapshot DTOs mirroring the legacy FlashcardDeck/Flashcard/FlashcardFolder JSON shape.
    //     Web JSON defaults => camelCase names, case-insensitive read, enums as ints. ---

    private sealed class FolderSnapshotDto
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? ParentId { get; set; }
        public int Order { get; set; }
    }

    private sealed class DeckSnapshotDto
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? FolderId { get; set; }
        public string? Description { get; set; }
        public string[]? Tags { get; set; }
        public DateTimeOffset? LastStudied { get; set; }
        public int RetentionScore { get; set; }
        public List<CardSnapshotDto>? Cards { get; set; }
        public int SchedulingAlgorithm { get; set; }
    }

    private sealed class CardSnapshotDto
    {
        public string Id { get; set; } = string.Empty;
        public string DeckId { get; set; } = string.Empty;
        public string? Front { get; set; }
        public string? Back { get; set; }
        public int Type { get; set; }
        public string[]? Tags { get; set; }
        public DateTimeOffset DueDate { get; set; }
        public double? Stability { get; set; }
        public double? Difficulty { get; set; }
        public double? Retrievability { get; set; }
        public SourceSnapshotDto? SourceInfo { get; set; }
        public IReadOnlyList<Block>? FrontBlocks { get; set; }
        public IReadOnlyList<Block>? BackBlocks { get; set; }
        public int? ReviewCount { get; set; }
        public int? LapseCount { get; set; }
        public int? LeitnerBox { get; set; }
        public DateTimeOffset? LastReviewedAt { get; set; }
        public int? FsrsState { get; set; }
    }

    private sealed class SourceSnapshotDto
    {
        public string? SourceType { get; set; }
        public string? SourceId { get; set; }
        public string? DisplayLabel { get; set; }
    }
}
