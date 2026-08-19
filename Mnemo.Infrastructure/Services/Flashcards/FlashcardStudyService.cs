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
public sealed class FlashcardStudyService : IFlashcardStudyService
{
    /// <summary>
    /// The forecast spans every deck at once, and decks may roll their day over at different hours,
    /// so its columns are plain local calendar dates. A day-scale due date is snapped to the start
    /// of its own deck's day, which is an hour of the date that day is named after, so every deck's
    /// cards land on the column they are scheduled for whichever hour that deck uses.
    /// </summary>
    private const int ChartDayStartHour = 0;

    private readonly IFlashcardStore _store;
    private readonly IDeckRepository _decks;
    private readonly IScheduleRepository _schedules;
    private readonly IPresetRepository _presets;
    private readonly IReviewRepository _reviews;
    private readonly IDailyStatsRepository _dailyStats;
    private readonly ICardRepository _cards;
    private readonly IFactRepository _facts;
    private readonly IFsrsScheduler _scheduler;
    private readonly FlashcardClock _clock;

    public FlashcardStudyService(
        IFlashcardStore store,
        IDeckRepository decks,
        IScheduleRepository schedules,
        IPresetRepository presets,
        IReviewRepository reviews,
        IDailyStatsRepository dailyStats,
        ICardRepository cards,
        IFactRepository facts,
        IFsrsScheduler scheduler,
        FlashcardClock clock)
    {
        _store = store;
        _decks = decks;
        _schedules = schedules;
        _presets = presets;
        _reviews = reviews;
        _dailyStats = dailyStats;
        _cards = cards;
        _facts = facts;
        _scheduler = scheduler;
        _clock = clock;
    }

    public Task<FlashcardDueCounts> GetDueCountsAsync(string deckId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync(async (conn, ct) =>
        {
            var header = await _decks.GetHeaderAsync(conn, deckId, ct).ConfigureAwait(false);
            if (header is null)
                return FlashcardDueCounts.Empty;
            var now = _clock.Now;
            var raw = await _schedules.GetRawDueCountsAsync(conn, deckId, now, ct).ConfigureAwait(false);
            var preset = await _presets.GetAsync(conn, header.PresetId, ct).ConfigureAwait(false)
                         ?? FlashcardPreset.CreateStandard(now);
            var stat = await _dailyStats.GetAsync(conn, deckId, _clock.TodayKey(preset.DayStartHour), ct).ConfigureAwait(false);
            return FlashcardDueCalculator.Cap(raw, preset, stat);
        }, cancellationToken);

    public Task<FlashcardDueCounts> GetAggregateDueCountsAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync(AggregateDueCountsAsync, cancellationToken);

    public Task<IReadOnlyList<FlashcardForecastDay>> GetReviewForecastAsync(int days, CancellationToken cancellationToken = default) =>
        _store.ReadAsync<IReadOnlyList<FlashcardForecastDay>>(async (conn, ct) =>
        {
            // Ninety days is the ceiling because past it the projection stops describing a schedule
            // and starts describing FSRS's own interval growth.
            var span = Math.Clamp(days, 1, 90);

            var today = _clock.Today(ChartDayStartHour);

            // Today comes off the same cap-aware aggregate the due-today banner uses rather than off
            // the day query below, so the first column of the chart and the number beside it are one
            // fact instead of two that can disagree. It also folds in everything overdue, which the
            // day query cannot see: an overdue card's due date is in a day that is already past.
            var todayCounts = await AggregateDueCountsAsync(conn, ct).ConfigureAwait(false);

            var forecast = new List<FlashcardForecastDay>(span)
            {
                new(today, todayCounts.Learning + todayCounts.Due, todayCounts.New),
            };
            if (span == 1)
                return forecast;

            // One boundary per remaining day plus a closing one, so day i is the half-open window
            // between consecutive entries.
            var boundaries = new DateTimeOffset[span];
            for (var i = 0; i < span; i++)
                boundaries[i] = _clock.StartOf(today.AddDays(i + 1), ChartDayStartHour);
            var byWindow = await _schedules.GetScheduledCountsByWindowAsync(conn, boundaries, ct).ConfigureAwait(false);

            for (var offset = 1; offset < span; offset++)
                forecast.Add(new FlashcardForecastDay(today.AddDays(offset), byWindow[offset - 1], 0));
            return forecast;
        }, cancellationToken);

    private async Task<FlashcardDueCounts> AggregateDueCountsAsync(SqliteConnection conn, CancellationToken ct)
    {
        var headers = await _decks.ListHeadersAsync(conn, ct).ConfigureAwait(false);
        var presets = await _presets.ListAsync(conn, ct).ConfigureAwait(false);
        var byId = new Dictionary<string, FlashcardPreset>(StringComparer.Ordinal);
        foreach (var p in presets)
            byId[p.Id] = p;

        var now = _clock.Now;
        var total = FlashcardDueCounts.Empty;
        foreach (var header in headers)
        {
            var raw = await _schedules.GetRawDueCountsAsync(conn, header.Id, now, ct).ConfigureAwait(false);
            var preset = byId.TryGetValue(header.PresetId, out var p) ? p : FlashcardPreset.CreateStandard(now);
            // Each deck's preset decides when its day turns over, so the key is per deck.
            var stat = await _dailyStats.GetAsync(conn, header.Id, _clock.TodayKey(preset.DayStartHour), ct).ConfigureAwait(false);
            total = total.Add(FlashcardDueCalculator.Cap(raw, preset, stat));
        }
        return total;
    }

    public async Task<IFlashcardSession> StartSessionAsync(FlashcardSessionRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Mode == FlashcardSessionMode.Test)
            throw new ArgumentException("Test is a separate typed-practice flow and does not use the FSRS session.", nameof(request));

        var (preset, queue) = await _store.ReadAsync(async (conn, ct) =>
        {
            var now = _clock.Now;
            var header = await _decks.GetHeaderAsync(conn, request.DeckId, ct).ConfigureAwait(false);
            var deckPreset = header is null
                ? FlashcardPreset.CreateStandard(now)
                : await _presets.GetAsync(conn, header.PresetId, ct).ConfigureAwait(false) ?? FlashcardPreset.CreateStandard(now);

            var items = new List<FlashcardView>();
            if (request.Mode == FlashcardSessionMode.Review)
            {
                var stat = await _dailyStats.GetAsync(conn, request.DeckId, _clock.TodayKey(deckPreset.DayStartHour), ct).ConfigureAwait(false);
                var newBudget = Math.Max(0, deckPreset.NewPerDay - stat.NewIntroduced);
                var reviewBudget = Math.Max(0, deckPreset.MaxReviewsPerDay - stat.ReviewsDone);

                AddBand(items, await _cards.GetActiveViewsAsync(conn, request.DeckId, new[] { 1, 3 }, now, int.MaxValue, now, ct).ConfigureAwait(false), deckPreset.ShuffleOrder);
                AddBand(items, await _cards.GetActiveViewsAsync(conn, request.DeckId, new[] { 2 }, now, reviewBudget, now, ct).ConfigureAwait(false), deckPreset.ShuffleOrder);
                AddBand(items, await _cards.GetActiveViewsAsync(conn, request.DeckId, new[] { 0 }, null, newBudget, now, ct).ConfigureAwait(false), deckPreset.ShuffleOrder);
            }
            else // Cram
            {
                // Burying is a scheduling courtesy, and cram is a deliberate walk through the deck.
                // Someone who asked for the whole deck gets the whole deck.
                var due = request.Scope == FlashcardSessionScope.Due ? (DateTimeOffset?)now : null;
                AddBand(items, await _cards.GetActiveViewsAsync(conn, request.DeckId, null, due, int.MaxValue, null, ct).ConfigureAwait(false), deckPreset.ShuffleOrder);
            }

            return (deckPreset, items);
        }, cancellationToken).ConfigureAwait(false);

        return new FlashcardStudySession(this, _scheduler, _clock, preset, request.Mode, request.DeckId, queue);
    }

    /// <summary>
    /// Appends one band of the queue, shuffled when the preset asks for it.
    /// </summary>
    /// <remarks>
    /// Shuffling happens inside a band rather than across the whole queue, so the order between
    /// bands survives. Learning cards are already overdue and reviews are the day's plan; a
    /// shuffle of the concatenation would let a card being seen for the first time outrank both.
    /// </remarks>
    private static void AddBand(List<FlashcardView> queue, IReadOnlyList<FlashcardView> band, bool shuffle)
    {
        if (!shuffle)
        {
            queue.AddRange(band);
            return;
        }

        var shuffled = band.ToArray();
        Random.Shared.Shuffle(shuffled);
        queue.AddRange(shuffled);
    }

    public Task<long> RecordReviewAsync(FlashcardReviewEntry entry, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            await _schedules.UpsertAsync(conn, tx, entry.UpdatedSchedule, ct).ConfigureAwait(false);
            var reviewId = await _reviews.AppendAsync(conn, tx, entry.Review, ct).ConfigureAwait(false);
            await _dailyStats.IncrementAsync(conn, tx, entry.Review.DeckId, entry.LocalDay,
                entry.IntroducedNewCard ? 1 : 0, ChargesReviewCap(entry.Review.StateBefore) ? 1 : 0, ct).ConfigureAwait(false);
            await _decks.SetLastStudiedAsync(conn, tx, entry.Review.DeckId, entry.Review.ReviewedAt, ct).ConfigureAwait(false);
            if (entry.LeechedCard is { } leeched)
                await _cards.UpdateAsync(conn, tx, leeched, ct).ConfigureAwait(false);
            if (entry.BurySiblingsUntil is { } until)
                await SetSiblingsBuriedAsync(conn, tx, entry.Review.CardId, until, ct).ConfigureAwait(false);
            return reviewId;
        }, cancellationToken);
    }

    public Task UndoReviewAsync(string deckId, FlashcardSchedule restoredSchedule, long reviewId, string localDay, bool wasNewIntroduction, Flashcard? restoredCard = null, bool unburySiblings = false, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(restoredSchedule);
        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            await _schedules.UpsertAsync(conn, tx, restoredSchedule, ct).ConfigureAwait(false);
            await _reviews.DeleteAsync(conn, tx, reviewId, ct).ConfigureAwait(false);
            if (unburySiblings)
                await SetSiblingsBuriedAsync(conn, tx, restoredSchedule.CardId, null, ct).ConfigureAwait(false);
            // restoredSchedule is the card as it was before the grade, so its state is the same
            // one the grade was charged against.
            await _dailyStats.IncrementAsync(conn, tx, deckId, localDay,
                wasNewIntroduction ? -1 : 0, ChargesReviewCap(restoredSchedule.FsrsState) ? -1 : 0, ct).ConfigureAwait(false);
            if (restoredCard is not null)
                await _cards.UpdateAsync(conn, tx, restoredCard, ct).ConfigureAwait(false);
        }, cancellationToken);
    }

    /// <summary>
    /// Puts the rest of a card's material on hold, or lets it back in when <paramref name="until"/>
    /// is null. A card with no material has no siblings and nothing happens.
    /// </summary>
    private async Task SetSiblingsBuriedAsync(SqliteConnection conn, SqliteTransaction tx, string cardId, DateTimeOffset? until, CancellationToken ct)
    {
        var siblings = await _facts.GetSiblingIdsAsync(conn, cardId, ct).ConfigureAwait(false);
        if (siblings.Count > 0)
            await _schedules.SetBuriedAsync(conn, tx, siblings, until, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// The daily review cap limits how many cards due for review get shown, so only an answer
    /// on a card that was already in review spends it. Introducing a new card and stepping a
    /// learning or relearning card are counted elsewhere, and charging them here used to hide
    /// genuine reviews behind repetitions the user had not asked to be limited.
    /// </summary>
    private static bool ChargesReviewCap(FlashcardFsrsState? stateBefore) =>
        stateBefore == FlashcardFsrsState.Review;
}
