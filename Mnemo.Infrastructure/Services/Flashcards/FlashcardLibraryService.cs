using System;
using System.Collections.Generic;
using System.Linq;
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
    private readonly IFactRepository _facts;
    private readonly IScheduleRepository _schedules;
    private readonly IReviewRepository _reviews;
    private readonly IDailyStatsRepository _dailyStats;
    private readonly IPresetRepository _presets;
    private readonly FlashcardClock _clock;
    private readonly IImageAssetService? _images;

    public FlashcardLibraryService(
        IFlashcardStore store,
        IFolderRepository folders,
        IDeckRepository decks,
        ICardRepository cards,
        IFactRepository facts,
        IScheduleRepository schedules,
        IReviewRepository reviews,
        IDailyStatsRepository dailyStats,
        IPresetRepository presets,
        FlashcardClock clock,
        IImageAssetService? images = null)
    {
        _store = store;
        _folders = folders;
        _decks = decks;
        _cards = cards;
        _facts = facts;
        _schedules = schedules;
        _reviews = reviews;
        _dailyStats = dailyStats;
        _presets = presets;
        _clock = clock;
        _images = images;
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
            var summaries = new List<FlashcardDeckSummary>(headers.Count);
            foreach (var header in headers)
            {
                var preset = byId.TryGetValue(header.PresetId, out var p) ? p : FlashcardPreset.CreateStandard(now);
                // Each deck's preset decides when its day turns over, so the key is per deck.
                summaries.Add(await BuildSummaryAsync(conn, header, preset, now, _clock.TodayKey(preset.DayStartHour), ct).ConfigureAwait(false));
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
            return await BuildSummaryAsync(conn, header, preset, now, _clock.TodayKey(preset.DayStartHour), ct).ConfigureAwait(false);
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

    /// <summary>
    /// Deletes a deck. Its cards cascade away on their own foreign key, but material has none -
    /// without this, a fact whose cards all lived here would survive its deck forever, unreachable
    /// and still counted as "in use" against a card type. A card moved to another deck before the
    /// delete keeps its material alive; only material left with nothing behind it is removed.
    /// </summary>
    public async Task<bool> DeleteDeckAsync(string deckId, CancellationToken cancellationToken = default)
    {
        var owned = new List<string>();
        var deleted = await _store.WriteAsync(async (conn, tx, ct) =>
        {
            // Freeform cards own their attachment files outright; cards made from material share
            // theirs with it, so only the freeform ones are gathered before the cascade takes them.
            var cards = await _cards.ListByDeckAsync(conn, deckId, ct).ConfigureAwait(false);
            owned.AddRange(cards.Where(c => c.FactId is null).SelectMany(c => c.Attachments).Select(a => a.FilePath));

            var homeFacts = await _facts.ListByDeckAsync(conn, deckId, ct).ConfigureAwait(false);
            var result = await _decks.DeleteAsync(conn, tx, deckId, ct).ConfigureAwait(false);
            if (!result)
                return false;

            foreach (var fact in homeFacts)
            {
                var remaining = await _facts.GetCardKeysAsync(conn, fact.Id, ct).ConfigureAwait(false);
                if (remaining.Count > 0)
                    continue;

                owned.AddRange(fact.Media.Values.SelectMany(list => list).Select(a => a.FilePath));
                await _facts.DeleteManyAsync(conn, tx, new[] { fact.Id }, ct).ConfigureAwait(false);
            }

            return true;
        }, cancellationToken).ConfigureAwait(false);

        if (deleted)
            await FlashcardAttachmentCleanup.DeleteAsync(_images, owned, cancellationToken).ConfigureAwait(false);

        return deleted;
    }

    /// <summary>
    /// Deletes a folder. Its direct child folders and decks are lifted to the root rather than
    /// cascading, and that reparenting happens in the same transaction as the delete, so a failure
    /// partway through cannot leave some of the folder's contents reparented, or any of them still
    /// pointing at a folder that is about to stop existing.
    /// </summary>
    public Task<bool> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (conn, tx, ct) =>
        {
            var folders = await _folders.ListAsync(conn, ct).ConfigureAwait(false);
            if (!folders.Any(f => f.Id == folderId))
                return false;

            var now = _clock.Now;
            var nextRootOrder = folders.Where(f => f.ParentId is null).Select(f => f.Order).DefaultIfEmpty(-1).Max() + 1;
            var orphanedFolders = folders
                .Where(f => f.ParentId == folderId)
                .OrderBy(f => f.Order)
                .ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();

            for (var i = 0; i < orphanedFolders.Count; i++)
            {
                await _folders.UpsertAsync(conn, tx, orphanedFolders[i] with { ParentId = null, Order = nextRootOrder + i }, now, ct)
                    .ConfigureAwait(false);
            }

            var decks = await _decks.ListHeadersAsync(conn, ct).ConfigureAwait(false);
            foreach (var deck in decks.Where(d => d.FolderId == folderId))
                await _decks.MoveAsync(conn, tx, deck.Id, null, deck.SortOrder, now, ct).ConfigureAwait(false);

            return await _folders.DeleteAsync(conn, tx, folderId, ct).ConfigureAwait(false);
        }, cancellationToken);

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
