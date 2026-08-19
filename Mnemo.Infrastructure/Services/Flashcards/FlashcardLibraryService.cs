using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <inheritdoc />
public sealed class FlashcardLibraryService : IFlashcardLibraryService
{
    private const int RetentionWindowDays = 30;

    private readonly IFlashcardStore _store;
    private readonly IFolderRepository _folders;
    private readonly IDeckRepository _decks;
    private readonly ICardRepository _cards;
    private readonly IScheduleRepository _schedules;
    private readonly IReviewRepository _reviews;
    private readonly IDailyStatsRepository _dailyStats;
    private readonly IPresetRepository _presets;
    private readonly FlashcardClock _clock;

    public FlashcardLibraryService(
        IFlashcardStore store,
        IFolderRepository folders,
        IDeckRepository decks,
        ICardRepository cards,
        IScheduleRepository schedules,
        IReviewRepository reviews,
        IDailyStatsRepository dailyStats,
        IPresetRepository presets,
        FlashcardClock clock)
    {
        _store = store;
        _folders = folders;
        _decks = decks;
        _cards = cards;
        _schedules = schedules;
        _reviews = reviews;
        _dailyStats = dailyStats;
        _presets = presets;
        _clock = clock;
    }

    public Task<IReadOnlyList<FlashcardFolder>> ListFoldersAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _folders.ListAsync(conn, ct), cancellationToken);

    public Task<IReadOnlyList<FlashcardDeckSummary>> ListDecksAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync(async (conn, ct) =>
        {
            var headers = await _decks.ListHeadersAsync(conn, ct).ConfigureAwait(false);
            var presets = await _presets.ListAsync(conn, ct).ConfigureAwait(false);
            var byId = new Dictionary<string, FlashcardPreset>(StringComparer.Ordinal);
            foreach (var p in presets)
                byId[p.Id] = p;

            var now = _clock.Now;
            var today = _clock.TodayKey();
            var summaries = new List<FlashcardDeckSummary>(headers.Count);
            foreach (var header in headers)
            {
                var preset = byId.TryGetValue(header.PresetId, out var p) ? p : FlashcardPreset.CreateStandard(now);
                summaries.Add(await BuildSummaryAsync(conn, header, preset, now, today, ct).ConfigureAwait(false));
            }
            return (IReadOnlyList<FlashcardDeckSummary>)summaries;
        }, cancellationToken);

    public Task<FlashcardDeckSummary?> GetDeckAsync(string deckId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync(async (conn, ct) =>
        {
            var header = await _decks.GetHeaderAsync(conn, deckId, ct).ConfigureAwait(false);
            if (header is null)
                return null;
            var now = _clock.Now;
            var preset = await _presets.GetAsync(conn, header.PresetId, ct).ConfigureAwait(false)
                         ?? FlashcardPreset.CreateStandard(now);
            return await BuildSummaryAsync(conn, header, preset, now, _clock.TodayKey(), ct).ConfigureAwait(false);
        }, cancellationToken);

    public Task SaveFolderAsync(FlashcardFolder folder, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(folder);
        return _store.WriteAsync((conn, tx, ct) => _folders.UpsertAsync(conn, tx, folder, _clock.Now, ct), cancellationToken);
    }

    public async Task<FlashcardDeckHeader> CreateDeckAsync(string name, string? folderId = null, string? presetId = null, CancellationToken cancellationToken = default)
    {
        var now = _clock.Now;
        var effectivePreset = presetId;
        if (string.IsNullOrEmpty(effectivePreset))
        {
            // Ensure the shared Standard preset exists so the deck's foreign key is satisfiable.
            await _store.WriteAsync(async (conn, tx, ct) =>
            {
                if (!await _presets.ExistsAsync(conn, FlashcardPreset.StandardPresetId, ct).ConfigureAwait(false))
                    await _presets.UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(now), ct).ConfigureAwait(false);
            }, cancellationToken).ConfigureAwait(false);
            effectivePreset = FlashcardPreset.StandardPresetId;
        }

        var header = new FlashcardDeckHeader(
            Id: Guid.NewGuid().ToString("N"),
            FolderId: folderId,
            PresetId: effectivePreset,
            Name: name,
            Description: null,
            Tags: Array.Empty<string>(),
            SortOrder: 0,
            LastStudied: null,
            CreatedAt: now,
            UpdatedAt: now);
        await _store.WriteAsync((conn, tx, ct) => _decks.UpsertAsync(conn, tx, header, ct), cancellationToken).ConfigureAwait(false);
        return header;
    }

    public Task SaveDeckAsync(FlashcardDeckHeader deck, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(deck);
        return _store.WriteAsync((conn, tx, ct) => _decks.UpsertAsync(conn, tx, deck, ct), cancellationToken);
    }

    public Task MoveDeckAsync(string deckId, string? folderId, int sortOrder, CancellationToken cancellationToken = default) =>
        _store.WriteAsync((conn, tx, ct) => _decks.MoveAsync(conn, tx, deckId, folderId, sortOrder, _clock.Now, ct), cancellationToken);

    public Task ReorderAsync(IReadOnlyList<FlashcardOrderEntry> entries, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(entries);
        var now = _clock.Now;
        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            foreach (var e in entries)
                await _decks.MoveAsync(conn, tx, e.DeckId, e.FolderId, e.SortOrder, now, ct).ConfigureAwait(false);
        }, cancellationToken);
    }

    public Task<bool> DeleteDeckAsync(string deckId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync((conn, tx, ct) => _decks.DeleteAsync(conn, tx, deckId, ct), cancellationToken);

    public Task<bool> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync((conn, tx, ct) => _folders.DeleteAsync(conn, tx, folderId, ct), cancellationToken);

    private async Task<FlashcardDeckSummary> BuildSummaryAsync(
        SqliteConnection conn, FlashcardDeckHeader header, FlashcardPreset preset,
        DateTimeOffset now, string today, CancellationToken cancellationToken)
    {
        var counts = await _cards.GetCountsAsync(conn, header.Id, cancellationToken).ConfigureAwait(false);
        var raw = await _schedules.GetRawDueCountsAsync(conn, header.Id, now, cancellationToken).ConfigureAwait(false);
        var stat = await _dailyStats.GetAsync(conn, header.Id, today, cancellationToken).ConfigureAwait(false);
        var due = FlashcardDueCalculator.Cap(raw, preset, stat);
        var sample = await _reviews.GetRetentionSampleAsync(conn, header.Id, now.AddDays(-RetentionWindowDays), cancellationToken).ConfigureAwait(false);
        var retention = sample.Total == 0 ? 0 : (int)Math.Round(100.0 * sample.Passed / sample.Total, MidpointRounding.AwayFromZero);
        return new FlashcardDeckSummary(
            header, counts.Total, counts.Active, counts.Suspended, due, retention, sample.Total);
    }
}
