using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Statistics;

/// <summary>
/// Helpers for first-party modules to record well-known stats without repeating the
/// schema-aware boilerplate. Failures are swallowed and logged; statistics never block
/// user-facing flows (a session save must not be aborted by a stats outage).
/// </summary>
public static class StatisticsRecorder
{
    /// <summary>
    /// Records one finished study session into the <b>Activity</b> stat bucket (reps, minutes,
    /// streak): the daily summary, per-deck rolling summary and lifetime totals the overview widgets
    /// and topbar read. This is mode-agnostic effort tracking: Review, Cram and Test all feed it,
    /// labelled by <paramref name="mode"/>. It deliberately writes <i>nothing</i> to the Memory bucket
    /// (FSRS and retention), which comes only from the append-only review log written by the engine,
    /// so off-schedule practice can never poison the model.
    /// </summary>
    /// <param name="studyDay">Decides which day the session is filed under.</param>
    /// <param name="cardsReviewed">Number of cards graded this session (distinct grading actions).</param>
    /// <param name="minutes">Minutes spent, floored to at least 1 for any non-empty session.</param>
    /// <param name="completedAt">When the session ended (drives the daily key and streak day).</param>
    public static async Task RecordFlashcardActivityAsync(
        IStatisticsManager stats,
        ILoggerService logger,
        IStudyDayService studyDay,
        string deckId,
        string? deckName,
        string mode,
        int cardsReviewed,
        int minutes,
        DateTimeOffset completedAt)
    {
        if (stats == null || studyDay == null || cardsReviewed <= 0 || string.IsNullOrEmpty(deckId))
            return;

        try
        {
            var ns = StatisticsNamespaces.Flashcards;

            // The day a session is filed under is the study day, the same boundary the study screen
            // schedules and caps against, so an evening that runs past midnight is reported as one
            // day rather than split in two. Rows written before this changed are keyed by the UTC
            // date instead and are left as they are: history is not recomputed, so a window
            // spanning the change can hold one day recorded under each rule.
            var day = await studyDay.DayOfAsync(completedAt).ConfigureAwait(false);
            var dayKey = IStudyDayService.KeyOf(day);
            var safeMinutes = Math.Max(1, minutes);

            // Daily aggregate: merge counters (the StudyGoals / UsageSummary / FlashcardStats widgets
            // read cards_reviewed + minutes_studied here).
            var existingDaily = (await stats.GetAsync(ns, FlashcardStatKinds.DailySummary, dayKey).ConfigureAwait(false)).Value;
            await stats.UpsertAsync(new StatisticsRecordWrite
            {
                Namespace = ns,
                Kind = FlashcardStatKinds.DailySummary,
                Key = dayKey,
                SourceModule = ns,
                Fields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
                {
                    ["cards_reviewed"] = StatValue.FromInt(GetIntField(existingDaily, "cards_reviewed") + cardsReviewed),
                    ["minutes_studied"] = StatValue.FromInt(GetIntField(existingDaily, "minutes_studied") + safeMinutes),
                    ["sessions_completed"] = StatValue.FromInt(GetIntField(existingDaily, "sessions_completed") + 1),
                    ["last_deck_id"] = StatValue.FromString(deckId),
                    ["last_mode"] = StatValue.FromString(mode)
                }
            }).ConfigureAwait(false);

            // Per-deck rolling summary (RecentDecks widget reads last_practiced + total_reviewed).
            var deckKey = $"deck:{deckId}";
            var existingDeck = (await stats.GetAsync(ns, FlashcardStatKinds.DeckSummary, deckKey).ConfigureAwait(false)).Value;
            var deckFields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
            {
                ["total_reviewed"] = StatValue.FromInt(GetIntField(existingDeck, "total_reviewed") + cardsReviewed),
                ["last_practiced"] = StatValue.FromDateTime(completedAt)
            };
            if (!string.IsNullOrEmpty(deckName))
                deckFields["deck_name"] = StatValue.FromString(deckName);
            await stats.UpsertAsync(new StatisticsRecordWrite
            {
                Namespace = ns,
                Kind = FlashcardStatKinds.DeckSummary,
                Key = deckKey,
                SourceModule = ns,
                Fields = deckFields
            }).ConfigureAwait(false);

            // Lifetime totals + streak (FlashcardStats widget + topbar read total_cards_practiced +
            // current_streak_days).
            var totals = (await stats.GetAsync(ns, FlashcardStatKinds.LifetimeTotals, "all").ConfigureAwait(false)).Value;
            var streak = ComputeUpdatedStreak(totals, day);
            await stats.UpsertAsync(new StatisticsRecordWrite
            {
                Namespace = ns,
                Kind = FlashcardStatKinds.LifetimeTotals,
                Key = "all",
                SourceModule = ns,
                Fields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
                {
                    ["total_cards_practiced"] = StatValue.FromInt(GetIntField(totals, "total_cards_practiced") + cardsReviewed),
                    ["total_sessions"] = StatValue.FromInt(GetIntField(totals, "total_sessions") + 1),
                    ["current_streak_days"] = StatValue.FromInt(streak),
                    ["longest_streak_days"] = StatValue.FromInt(Math.Max(streak, GetIntField(totals, "longest_streak_days"))),
                    [LastPracticedDayField] = StatValue.FromDateTime(new DateTimeOffset(day, TimeOnly.MinValue, TimeSpan.Zero))
                }
            }).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger?.Error("Statistics", "Recording flashcard activity failed; ignoring.", ex);
        }
    }

    private static long GetIntField(StatisticsRecord? record, string field)
    {
        if (record == null) return 0L;
        return record.Fields.TryGetValue(field, out var v) && v.Type == StatValueType.Integer ? v.AsInt() : 0L;
    }

    /// <summary>The study day the last session was filed under, on the lifetime totals record.</summary>
    private const string LastPracticedDayField = "last_practiced_day";

    /// <summary>
    /// What the field was called while the day was a UTC date. Still read, so a streak running when
    /// the boundary changed carries on instead of restarting at one.
    /// </summary>
    private const string LegacyLastPracticedDayField = "last_practiced_utc_day";

    /// <summary>
    /// Advances the current streak: same day, unchanged (min 1); the day before, plus one; any other
    /// gap resets to 1. Days are study days, so a streak is not broken by an evening session that
    /// ran past midnight.
    /// </summary>
    private static int ComputeUpdatedStreak(StatisticsRecord? totals, DateOnly today)
    {
        var lastDay = ReadDay(totals, LastPracticedDayField) ?? ReadDay(totals, LegacyLastPracticedDayField);

        var current = (int)GetIntField(totals, "current_streak_days");
        if (lastDay == null || current <= 0)
            return 1;
        if (lastDay.Value == today)
            return Math.Max(current, 1);
        if (lastDay.Value == today.AddDays(-1))
            return current + 1;
        return 1;
    }

    /// <summary>The day part of a stored instant field, or null when the field is absent or another type.</summary>
    private static DateOnly? ReadDay(StatisticsRecord? record, string field)
    {
        if (record == null || !record.Fields.TryGetValue(field, out var value) || value.Type != StatValueType.DateTime)
            return null;
        return DateOnly.FromDateTime(value.AsDateTime().UtcDateTime);
    }

    /// <summary>
    /// Increments the requested counter on today's daily summary for the given namespace. Today is
    /// the study day, so every day-keyed kind lines up on one boundary and the overview can read a
    /// day across namespaces without asking which of them meant which day.
    /// </summary>
    public static async Task IncrementDailyCounterAsync(
        IStatisticsManager stats,
        ILoggerService logger,
        IStudyDayService studyDay,
        string ns,
        string kind,
        string fieldName,
        long delta = 1)
    {
        if (stats == null || studyDay == null) return;
        try
        {
            var dayKey = await studyDay.TodayKeyAsync().ConfigureAwait(false);
            await stats.IncrementAsync(ns, kind, dayKey, fieldName, delta, ns).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger?.Error("Statistics", $"Incrementing {ns}/{kind}/{fieldName} failed.", ex);
        }
    }

    /// <summary>Records one cold start / process launch (lifetime counter).</summary>
    public static async Task RecordAppLaunchAsync(IStatisticsManager stats, ILoggerService logger)
    {
        await IncrementLifetimeAsync(
            stats,
            logger,
            StatisticsNamespaces.App,
            AppStatKinds.LifetimeTotals,
            "app_launch_count").ConfigureAwait(false);
    }

    /// <summary>Increments lifetime XP on <see cref="AppStatKinds.LifetimeTotals"/> (<c>total_xp</c>). Safe no-op when stats is null.</summary>
    public static Task IncrementTotalXpAsync(IStatisticsManager stats, ILoggerService logger, long delta)
        => IncrementLifetimeAsync(stats, logger, StatisticsNamespaces.App, AppStatKinds.LifetimeTotals, "total_xp", delta);

    /// <summary>Increments a counter on the lifetime-totals record for a namespace (creating it on first use).</summary>
    public static async Task IncrementLifetimeAsync(
        IStatisticsManager stats,
        ILoggerService logger,
        string ns,
        string kind,
        string fieldName,
        long delta = 1)
    {
        if (stats == null) return;
        try
        {
            await stats.IncrementAsync(ns, kind, "all", fieldName, delta, ns).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger?.Error("Statistics", $"Incrementing lifetime {ns}/{kind}/{fieldName} failed.", ex);
        }
    }

}
