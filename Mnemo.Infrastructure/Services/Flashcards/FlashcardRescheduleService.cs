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
public sealed class FlashcardRescheduleService : IFlashcardRescheduleService
{
    /// <summary>
    /// The shortest spacing a rewritten stability can stand for. The scheduler never hands out
    /// an interval under a day, and a card set due today an hour after its last review would
    /// otherwise be told its natural spacing is an hour.
    /// </summary>
    private const double MinIntervalDays = 1d;

    private readonly IFlashcardStore _store;
    private readonly ICardRepository _cards;
    private readonly IScheduleRepository _schedules;
    private readonly IDeckRepository _decks;
    private readonly IPresetRepository _presets;
    private readonly IFsrsScheduler _scheduler;
    private readonly FlashcardClock _clock;

    public FlashcardRescheduleService(
        IFlashcardStore store,
        ICardRepository cards,
        IScheduleRepository schedules,
        IDeckRepository decks,
        IPresetRepository presets,
        IFsrsScheduler scheduler,
        FlashcardClock clock)
    {
        _store = store;
        _cards = cards;
        _schedules = schedules;
        _decks = decks;
        _presets = presets;
        _scheduler = scheduler;
        _clock = clock;
    }

    public Task SetDueAsync(IReadOnlyList<string> cardIds, int daysFromNow, bool matchInterval, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(cardIds);
        ArgumentOutOfRangeException.ThrowIfNegative(daysFromNow);
        if (cardIds.Count == 0)
            return Task.CompletedTask;

        var now = _clock.Now;
        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            var presets = new PresetLookup(_decks, _presets, now);
            foreach (var (card, schedule) in await ActiveAsync(conn, cardIds, ct).ConfigureAwait(false))
            {
                var preset = await presets.ForDeckAsync(conn, card.DeckId, ct).ConfigureAwait(false);
                var due = _clock.DueAfterDays(now, daysFromNow, preset.DayStartHour);
                // A date asked for by name is a date to show the card on, so a hold a sibling's
                // answer put on it today is lifted; the other modes leave a hold where it is.
                var next = schedule with
                {
                    DueDate = due,
                    FsrsState = FlashcardFsrsState.Review,
                    LearningStepIndex = 0,
                    BuriedUntil = null,
                };

                if (matchInterval)
                {
                    var interval = Math.Max(MinIntervalDays, (due - (schedule.LastReviewedAt ?? now)).TotalDays);
                    next = next with { Stability = _scheduler.StabilityForInterval(interval, preset) };
                }

                await _schedules.UpsertAsync(conn, tx, next, ct).ConfigureAwait(false);
            }
        }, cancellationToken);
    }

    public Task ResetAsync(IReadOnlyList<string> cardIds, bool keepCounts, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(cardIds);
        if (cardIds.Count == 0)
            return Task.CompletedTask;

        var now = _clock.Now;
        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            foreach (var (_, schedule) in await ActiveAsync(conn, cardIds, ct).ConfigureAwait(false))
            {
                if (schedule.FsrsState == FlashcardFsrsState.New)
                    continue;

                var fresh = FlashcardSchedule.NewFor(schedule.CardId, now) with { BuriedUntil = schedule.BuriedUntil };
                var next = keepCounts
                    ? fresh with { Reps = schedule.Reps, Lapses = schedule.Lapses, LastReviewedAt = schedule.LastReviewedAt }
                    : fresh;
                await _schedules.UpsertAsync(conn, tx, next, ct).ConfigureAwait(false);
            }
        }, cancellationToken);
    }

    public Task RepositionAsync(IReadOnlyList<string> cardIds, FlashcardQueuePlacement placement, int position, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(cardIds);
        if (cardIds.Count == 0)
            return Task.CompletedTask;

        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            var moving = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            foreach (var (card, schedule) in await ActiveAsync(conn, cardIds, ct).ConfigureAwait(false))
            {
                if (schedule.FsrsState != FlashcardFsrsState.New)
                    continue;
                if (!moving.TryGetValue(card.DeckId, out var ids))
                    moving[card.DeckId] = ids = new HashSet<string>(StringComparer.Ordinal);
                ids.Add(card.Id);
            }

            foreach (var (deckId, ids) in moving)
            {
                var queue = await _schedules.ListNewQueueAsync(conn, deckId, ct).ConfigureAwait(false);
                var reordered = Reorder(queue, ids, placement, position);
                await _schedules.SetDueDatesAsync(conn, tx, Renumber(queue, reordered), ct).ConfigureAwait(false);
            }
        }, cancellationToken);
    }

    public Task<int> CountNewQueueAsync(string deckId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(deckId);
        return _store.ReadAsync((conn, ct) => _schedules.CountNewQueueAsync(conn, deckId, ct), cancellationToken);
    }

    /// <summary>
    /// The queue with the moving cards lifted out and put back at the requested place, in the
    /// order they already had among themselves.
    /// </summary>
    internal static IReadOnlyList<FlashcardQueueEntry> Reorder(
        IReadOnlyList<FlashcardQueueEntry> queue, ISet<string> movingIds, FlashcardQueuePlacement placement, int position)
    {
        var moving = queue.Where(entry => movingIds.Contains(entry.CardId)).ToList();
        var others = queue.Where(entry => !movingIds.Contains(entry.CardId)).ToList();
        var index = placement switch
        {
            FlashcardQueuePlacement.Start => 0,
            FlashcardQueuePlacement.End => others.Count,
            _ => Math.Clamp(position - 1, 0, others.Count),
        };
        others.InsertRange(index, moving);
        return others;
    }

    /// <summary>
    /// Due dates that spell out <paramref name="reordered"/>: the queue's earliest date, then one
    /// tick per place. Only the entries whose date actually changes are returned.
    /// </summary>
    /// <remarks>
    /// Rewriting every position rather than squeezing the moved cards between their neighbours,
    /// because a deck built in one go gives all its cards the same instant and ties are broken by
    /// id, so there is no room between two neighbours to squeeze into. Ticks keep the whole queue
    /// inside the microseconds after its first card, so a due date never lands in the future.
    /// </remarks>
    internal static IReadOnlyList<FlashcardQueueEntry> Renumber(
        IReadOnlyList<FlashcardQueueEntry> queue, IReadOnlyList<FlashcardQueueEntry> reordered)
    {
        if (queue.Count == 0)
            return Array.Empty<FlashcardQueueEntry>();

        var first = queue[0].DueDate;
        var changed = new List<FlashcardQueueEntry>();
        for (var i = 0; i < reordered.Count; i++)
        {
            var due = first.AddTicks(i);
            if (reordered[i].DueDate != due)
                changed.Add(reordered[i] with { DueDate = due });
        }
        return changed;
    }

    /// <summary>
    /// The live, unsuspended cards among <paramref name="cardIds"/> with their schedules, in the
    /// order asked for, each id once. Suspended cards are parked on purpose, so a batch that moves
    /// cards in time steps around them the way the queue does.
    /// </summary>
    private async Task<List<(Flashcard Card, FlashcardSchedule Schedule)>> ActiveAsync(
        SqliteConnection conn, IReadOnlyList<string> cardIds, CancellationToken ct)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var list = new List<(Flashcard, FlashcardSchedule)>();
        foreach (var id in cardIds)
        {
            if (!seen.Add(id))
                continue;
            var card = await _cards.GetAsync(conn, id, ct).ConfigureAwait(false);
            if (card is null || card.State == FlashcardCardState.Suspended)
                continue;
            var schedule = await _schedules.GetAsync(conn, id, ct).ConfigureAwait(false);
            if (schedule is null)
                continue;
            list.Add((card, schedule));
        }
        return list;
    }

    /// <summary>
    /// Presets by deck, read once per deck for a batch. A deck without a header or whose preset is
    /// gone schedules on the standard preset, the same fallback the study session uses.
    /// </summary>
    private sealed class PresetLookup
    {
        private readonly IDeckRepository _decks;
        private readonly IPresetRepository _presets;
        private readonly DateTimeOffset _now;
        private readonly Dictionary<string, FlashcardPreset> _byDeck = new(StringComparer.Ordinal);

        public PresetLookup(IDeckRepository decks, IPresetRepository presets, DateTimeOffset now)
        {
            _decks = decks;
            _presets = presets;
            _now = now;
        }

        public async Task<FlashcardPreset> ForDeckAsync(SqliteConnection conn, string deckId, CancellationToken ct)
        {
            if (_byDeck.TryGetValue(deckId, out var cached))
                return cached;

            var header = await _decks.GetHeaderAsync(conn, deckId, ct).ConfigureAwait(false);
            var preset = header is null
                ? null
                : await _presets.GetAsync(conn, header.PresetId, ct).ConfigureAwait(false);
            preset ??= FlashcardPreset.CreateStandard(_now);
            _byDeck[deckId] = preset;
            return preset;
        }
    }
}
