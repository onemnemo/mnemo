using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <inheritdoc />
public sealed class FlashcardStudyService : IFlashcardStudyService
{
    private readonly IFlashcardStore _store;
    private readonly IDeckRepository _decks;
    private readonly IScheduleRepository _schedules;
    private readonly IPresetRepository _presets;
    private readonly IReviewRepository _reviews;
    private readonly IDailyStatsRepository _dailyStats;
    private readonly ICardRepository _cards;
    private readonly IFsrsScheduler _scheduler;

    public FlashcardStudyService(
        IFlashcardStore store,
        IDeckRepository decks,
        IScheduleRepository schedules,
        IPresetRepository presets,
        IReviewRepository reviews,
        IDailyStatsRepository dailyStats,
        ICardRepository cards,
        IFsrsScheduler scheduler)
    {
        _store = store;
        _decks = decks;
        _schedules = schedules;
        _presets = presets;
        _reviews = reviews;
        _dailyStats = dailyStats;
        _cards = cards;
        _scheduler = scheduler;
    }

    public Task<FlashcardDueCounts> GetDueCountsAsync(string deckId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync(async (conn, ct) =>
        {
            var header = await _decks.GetHeaderAsync(conn, deckId, ct).ConfigureAwait(false);
            if (header is null)
                return FlashcardDueCounts.Empty;
            var now = DateTimeOffset.UtcNow;
            var raw = await _schedules.GetRawDueCountsAsync(conn, deckId, now, ct).ConfigureAwait(false);
            var preset = await _presets.GetAsync(conn, header.PresetId, ct).ConfigureAwait(false)
                         ?? FlashcardPreset.CreateStandard(now);
            var stat = await _dailyStats.GetAsync(conn, deckId, FlashcardLocalDay.Today(), ct).ConfigureAwait(false);
            return FlashcardDueCalculator.Cap(raw, preset, stat);
        }, cancellationToken);

    public Task<FlashcardDueCounts> GetAggregateDueCountsAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync(async (conn, ct) =>
        {
            var headers = await _decks.ListHeadersAsync(conn, ct).ConfigureAwait(false);
            var presets = await _presets.ListAsync(conn, ct).ConfigureAwait(false);
            var byId = new Dictionary<string, FlashcardPreset>(StringComparer.Ordinal);
            foreach (var p in presets)
                byId[p.Id] = p;

            var now = DateTimeOffset.UtcNow;
            var today = FlashcardLocalDay.Today();
            var total = FlashcardDueCounts.Empty;
            foreach (var header in headers)
            {
                var raw = await _schedules.GetRawDueCountsAsync(conn, header.Id, now, ct).ConfigureAwait(false);
                var preset = byId.TryGetValue(header.PresetId, out var p) ? p : FlashcardPreset.CreateStandard(now);
                var stat = await _dailyStats.GetAsync(conn, header.Id, today, ct).ConfigureAwait(false);
                total = total.Add(FlashcardDueCalculator.Cap(raw, preset, stat));
            }
            return total;
        }, cancellationToken);

    public async Task<IFlashcardSession> StartSessionAsync(FlashcardSessionRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Mode == FlashcardSessionMode.Test)
            throw new ArgumentException("Test is a separate typed-practice flow and does not use the FSRS session.", nameof(request));

        var (preset, queue) = await _store.ReadAsync(async (conn, ct) =>
        {
            var now = DateTimeOffset.UtcNow;
            var header = await _decks.GetHeaderAsync(conn, request.DeckId, ct).ConfigureAwait(false);
            var deckPreset = header is null
                ? FlashcardPreset.CreateStandard(now)
                : await _presets.GetAsync(conn, header.PresetId, ct).ConfigureAwait(false) ?? FlashcardPreset.CreateStandard(now);

            var items = new List<FlashcardView>();
            if (request.Mode == FlashcardSessionMode.Review)
            {
                var stat = await _dailyStats.GetAsync(conn, request.DeckId, FlashcardLocalDay.Today(), ct).ConfigureAwait(false);
                var newBudget = Math.Max(0, deckPreset.NewPerDay - stat.NewIntroduced);
                var reviewBudget = Math.Max(0, deckPreset.MaxReviewsPerDay - stat.ReviewsDone);

                items.AddRange(await _cards.GetActiveViewsAsync(conn, request.DeckId, new[] { 1, 3 }, now, int.MaxValue, ct).ConfigureAwait(false));
                items.AddRange(await _cards.GetActiveViewsAsync(conn, request.DeckId, new[] { 2 }, now, reviewBudget, ct).ConfigureAwait(false));
                items.AddRange(await _cards.GetActiveViewsAsync(conn, request.DeckId, new[] { 0 }, null, newBudget, ct).ConfigureAwait(false));
            }
            else // Cram
            {
                var due = request.Scope == FlashcardSessionScope.Due ? (DateTimeOffset?)now : null;
                items.AddRange(await _cards.GetActiveViewsAsync(conn, request.DeckId, null, due, int.MaxValue, ct).ConfigureAwait(false));
            }

            return (deckPreset, items);
        }, cancellationToken).ConfigureAwait(false);

        IReadOnlyList<FlashcardView> ordered = preset.ShuffleOrder
            ? queue.OrderBy(_ => Guid.NewGuid()).ToList()
            : queue;

        return new FlashcardStudySession(this, _scheduler, preset, request.Mode, request.DeckId, ordered);
    }

    public Task<long> RecordReviewAsync(FlashcardReviewEntry entry, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            await _schedules.UpsertAsync(conn, tx, entry.UpdatedSchedule, ct).ConfigureAwait(false);
            var reviewId = await _reviews.AppendAsync(conn, tx, entry.Review, ct).ConfigureAwait(false);
            await _dailyStats.IncrementAsync(conn, tx, entry.Review.DeckId, entry.LocalDay,
                entry.IntroducedNewCard ? 1 : 0, 1, ct).ConfigureAwait(false);
            return reviewId;
        }, cancellationToken);
    }

    public Task UndoReviewAsync(string deckId, FlashcardSchedule restoredSchedule, long reviewId, string localDay, bool wasNewIntroduction, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(restoredSchedule);
        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            await _schedules.UpsertAsync(conn, tx, restoredSchedule, ct).ConfigureAwait(false);
            await _reviews.DeleteAsync(conn, tx, reviewId, ct).ConfigureAwait(false);
            await _dailyStats.IncrementAsync(conn, tx, deckId, localDay,
                wasNewIntroduction ? -1 : 0, -1, ct).ConfigureAwait(false);
        }, cancellationToken);
    }
}
