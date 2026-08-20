using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// One-shot import of the legacy <c>flashcards.state.v2</c> JSON blob into the relational store.
/// Fully self-contained: it deserializes into private DTOs (below) so it carries no dependency on
/// the retired model. Idempotent (backup-key guard + upserts), atomic (one transaction), and it
/// leaves a backup key rather than deleting data destructively.
/// </summary>
public interface IFlashcardStoreMigrator
{
    Task MigrateAsync(CancellationToken cancellationToken = default);
}

/// <inheritdoc />
public sealed class FlashcardStoreMigrator : IFlashcardStoreMigrator
{
    private const string LegacyKey = "flashcards.state.v2";
    private const string BackupKey = "flashcards.state.v2.migrated-backup";
    private const int LegacyFsrsAlgorithm = 1; // FlashcardSchedulingAlgorithm.Fsrs

    private readonly IFlashcardStore _store;
    private readonly IStorageProvider _storage;
    private readonly IPresetRepository _presets;
    private readonly IFolderRepository _folders;
    private readonly IDeckRepository _decks;
    private readonly ICardRepository _cards;
    private readonly IScheduleRepository _schedules;
    private readonly IReviewRepository _reviews;
    private readonly ILoggerService _logger;
    private readonly TimeProvider _time;

    /// <param name="time">Clock the imported rows are stamped from. Defaults to the system clock.</param>
    public FlashcardStoreMigrator(
        IFlashcardStore store,
        IStorageProvider storage,
        IPresetRepository presets,
        IFolderRepository folders,
        IDeckRepository decks,
        ICardRepository cards,
        IScheduleRepository schedules,
        IReviewRepository reviews,
        ILoggerService logger,
        TimeProvider? time = null)
    {
        _store = store;
        _storage = storage;
        _presets = presets;
        _folders = folders;
        _decks = decks;
        _cards = cards;
        _schedules = schedules;
        _reviews = reviews;
        _logger = logger;
        _time = time ?? TimeProvider.System;
    }

    /// <inheritdoc />
    public async Task MigrateAsync(CancellationToken cancellationToken = default)
    {
        await _store.InitializeAsync(cancellationToken).ConfigureAwait(false);

        var backup = await _storage.LoadAsync<LegacyState>(BackupKey).ConfigureAwait(false);
        if (backup.IsSuccess && backup.Value is not null)
            return; // already migrated

        var load = await _storage.LoadAsync<LegacyState>(LegacyKey).ConfigureAwait(false);
        if (!load.IsSuccess || load.Value is null)
            return; // fresh install or nothing to import

        var legacy = load.Value;
        var now = _time.GetUtcNow();

        try
        {
            await _store.WriteAsync(async (conn, tx, ct) =>
            {
                await _presets.UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(now), ct).ConfigureAwait(false);

                foreach (var folder in legacy.Folders ?? new List<LegacyFolder>())
                    await _folders.UpsertAsync(conn, tx,
                        new FlashcardFolder(folder.Id, folder.Name, folder.ParentId, folder.Order), now, ct).ConfigureAwait(false);

                var decks = legacy.Decks ?? new List<LegacyDeck>();
                var deckIds = decks.Select(d => d.Id).ToList();
                if (deckIds.Count > 0)
                    await ClearReviewsAsync(conn, tx, deckIds, ct).ConfigureAwait(false);

                for (var i = 0; i < decks.Count; i++)
                {
                    var deck = decks[i];
                    await _decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                        Id: deck.Id,
                        FolderId: deck.FolderId,
                        PresetId: FlashcardPreset.StandardPresetId,
                        Name: deck.Name,
                        Description: deck.Description,
                        Tags: deck.Tags ?? Array.Empty<string>(),
                        SortOrder: i,
                        LastStudied: deck.LastStudied,
                        CreatedAt: now,
                        UpdatedAt: now), ct).ConfigureAwait(false);

                    var isFsrs = deck.SchedulingAlgorithm == LegacyFsrsAlgorithm;
                    foreach (var card in deck.Cards ?? new List<LegacyCard>())
                    {
                        FlashcardSourceInfo? source = card.SourceInfo is { } s && s.SourceType is not null && s.SourceId is not null
                            ? new FlashcardSourceInfo(s.SourceType, s.SourceId, s.DisplayLabel)
                            : null;

                        // Convert legacy embedded image tokens (`![alt](path){align=...}`) into
                        // attachment records so no downstream renderer needs to regex-parse card text.
                        var conversion = FlashcardImageTokenConverter.Convert(card.Id, card.Front, card.Back);
                        foreach (var warning in conversion.Warnings)
                            _logger.Warning("Flashcards", warning.Message);

                        await _cards.UpsertAsync(conn, tx, new Flashcard(
                            Id: card.Id,
                            DeckId: deck.Id,
                            Type: (FlashcardType)card.Type,
                            Front: conversion.CleanFront,
                            Back: conversion.CleanBack,
                            Tags: card.Tags ?? Array.Empty<string>(),
                            State: FlashcardCardState.Active,
                            IsFlagged: false,
                            Attachments: conversion.Attachments,
                            SourceInfo: source,
                            FrontBlocks: null,
                            BackBlocks: null,
                            CreatedAt: now,
                            UpdatedAt: now), ct).ConfigureAwait(false);

                        var schedule = isFsrs
                            ? new FlashcardSchedule(card.Id, card.DueDate, card.Stability, card.Difficulty,
                                card.ReviewCount ?? 0, card.LapseCount ?? 0,
                                (FlashcardFsrsState)(card.FsrsState ?? 0), 0, card.LastReviewedAt)
                            : FlashcardSchedule.NewFor(card.Id, now); // SM2/Leitner/Baseline → reset to New
                        await _schedules.UpsertAsync(conn, tx, schedule, ct).ConfigureAwait(false);
                    }
                }

                // The imported cards arrive with no material behind them, and the upgrade step that
                // gives a card its fact runs on a version crossing the store had already made before
                // the first of them was written. Without this the whole imported collection stays
                // factless for good, which leaves burying inert and editing a card's material
                // answering that there is none.
                await FlashcardFactBackfill
                    .ApplyAsync(new FlashcardMigrationContext(conn, tx, _time, ct))
                    .ConfigureAwait(false);

                foreach (var session in legacy.SessionHistory ?? new List<LegacySession>())
                {
                    if (session.SessionConfig?.SessionType != 0) // 0 = Review; only Review fed the schedule
                        continue;
                    var sessionId = Guid.NewGuid().ToString("N");
                    // The blob kept no per-review stability, difficulty or starting state, so those
                    // stay null rather than being invented from the card's current values.
                    foreach (var result in session.CardResults ?? new List<LegacyCardResult>())
                        await _reviews.AppendAsync(conn, tx, new FlashcardReviewLog(
                            FlashcardReviewLog.Unassigned, result.CardId, session.DeckId, sessionId,
                            (FlashcardReviewGrade)result.Grade, result.ReviewedAt, 0, 0, null, null,
                            null, FlashcardFsrsState.Review), ct).ConfigureAwait(false);
                }
            }, cancellationToken).ConfigureAwait(false);

            await _storage.SaveAsync(BackupKey, legacy).ConfigureAwait(false);
            await _storage.DeleteAsync(LegacyKey).ConfigureAwait(false);
            _logger.Info("Flashcards", $"Imported {legacy.Decks?.Count ?? 0} legacy deck(s) into the relational store.");
        }
        catch (Exception ex)
        {
            _logger.Error("Flashcards", "Flashcard import failed; legacy blob left intact for retry.", ex);
            throw;
        }
    }

    private static async Task ClearReviewsAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> deckIds, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        var names = new string[deckIds.Count];
        for (var i = 0; i < deckIds.Count; i++)
        {
            names[i] = "$d" + i;
            cmd.Parameters.AddWithValue(names[i], deckIds[i]);
        }
        cmd.CommandText = $"DELETE FROM FlashcardReviews WHERE DeckId IN ({string.Join(", ", names)});";
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    // --- Private DTOs mirroring the legacy blob (default System.Text.Json: PascalCase, enums as ints). ---

    private sealed class LegacyState
    {
        public List<LegacyFolder>? Folders { get; set; }
        public List<LegacyDeck>? Decks { get; set; }
        public List<LegacySession>? SessionHistory { get; set; }
    }

    private sealed class LegacyFolder
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? ParentId { get; set; }
        public int Order { get; set; }
    }

    private sealed class LegacyDeck
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? FolderId { get; set; }
        public string? Description { get; set; }
        public string[]? Tags { get; set; }
        public DateTimeOffset? LastStudied { get; set; }
        public List<LegacyCard>? Cards { get; set; }
        public int SchedulingAlgorithm { get; set; }
    }

    private sealed class LegacyCard
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
        public int? ReviewCount { get; set; }
        public int? LapseCount { get; set; }
        public DateTimeOffset? LastReviewedAt { get; set; }
        public int? FsrsState { get; set; }
        public LegacySource? SourceInfo { get; set; }
    }

    private sealed class LegacySource
    {
        public string? SourceType { get; set; }
        public string? SourceId { get; set; }
        public string? DisplayLabel { get; set; }
    }

    private sealed class LegacySession
    {
        public string DeckId { get; set; } = string.Empty;
        public LegacySessionConfig? SessionConfig { get; set; }
        public List<LegacyCardResult>? CardResults { get; set; }
    }

    private sealed class LegacySessionConfig
    {
        public int SessionType { get; set; }
    }

    private sealed class LegacyCardResult
    {
        public string CardId { get; set; } = string.Empty;
        public int Grade { get; set; }
        public DateTimeOffset ReviewedAt { get; set; }
    }
}
