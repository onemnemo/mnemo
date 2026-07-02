using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
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
    private const string SourceFlashcards = StatisticsNamespaces.Flashcards;

    /// <summary>
    /// Records a completed flashcard practice session. Updates daily/per-deck/lifetime aggregates
    /// and writes an immutable session log row.
    /// </summary>
    public static async Task RecordFlashcardSessionAsync(
        IStatisticsManager stats,
        ILoggerService logger,
        FlashcardSessionResult session,
        string? deckName = null,
        bool endedEarly = false)
    {
        if (stats == null || session == null) return;

        try
        {
            var dayKey = session.CompletedAt.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var duration = session.CompletedAt - session.StartedAt;
            var totalCards = session.CardResults.Count;
            int correct = 0, incorrect = 0, again = 0, hard = 0, good = 0, easy = 0;
            foreach (var r in session.CardResults)
            {
                switch (r.Grade)
                {
                    case FlashcardReviewGrade.Again: again++; incorrect++; break;
                    case FlashcardReviewGrade.Hard: hard++; incorrect++; break;
                    case FlashcardReviewGrade.Good: good++; correct++; break;
                    case FlashcardReviewGrade.Easy: easy++; correct++; break;
                }
            }

            var minutes = (int)Math.Max(1, Math.Round(duration.TotalMinutes, MidpointRounding.AwayFromZero));
            var accuracy = totalCards == 0 ? 0d : (double)correct / totalCards * 100d;

            var sessionKey = $"session:{session.StartedAt.UtcTicks}:{session.DeckId}";
            var sessionFields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
            {
                ["deck_id"] = StatValue.FromString(session.DeckId),
                ["session_type"] = StatValue.FromString(session.SessionConfig?.SessionType.ToString() ?? "unknown"),
                ["cards_reviewed"] = StatValue.FromInt(totalCards),
                ["correct_count"] = StatValue.FromInt(correct),
                ["incorrect_count"] = StatValue.FromInt(incorrect),
                ["again_count"] = StatValue.FromInt(again),
                ["hard_count"] = StatValue.FromInt(hard),
                ["good_count"] = StatValue.FromInt(good),
                ["easy_count"] = StatValue.FromInt(easy),
                ["accuracy"] = StatValue.FromDecimal(accuracy),
                ["duration_seconds"] = StatValue.FromInt((long)Math.Max(0, duration.TotalSeconds)),
                ["started_at"] = StatValue.FromDateTime(session.StartedAt),
                ["completed_at"] = StatValue.FromDateTime(session.CompletedAt),
                ["ended_early"] = StatValue.FromBool(endedEarly)
            };
            await stats.UpsertAsync(new StatisticsRecordWrite
            {
                Namespace = SourceFlashcards,
                Kind = FlashcardStatKinds.SessionLog,
                Key = sessionKey,
                SourceModule = SourceFlashcards,
                Fields = sessionFields
            }).ConfigureAwait(false);

            // Daily aggregate: merge counters
            var existingDaily = (await stats.GetAsync(SourceFlashcards, FlashcardStatKinds.DailySummary, dayKey).ConfigureAwait(false)).Value;
            var dailyFields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
            {
                ["cards_reviewed"] = StatValue.FromInt(GetIntField(existingDaily, "cards_reviewed") + totalCards),
                ["minutes_studied"] = StatValue.FromInt(GetIntField(existingDaily, "minutes_studied") + minutes),
                ["sessions_completed"] = StatValue.FromInt(GetIntField(existingDaily, "sessions_completed") + 1),
                ["correct_count"] = StatValue.FromInt(GetIntField(existingDaily, "correct_count") + correct),
                ["incorrect_count"] = StatValue.FromInt(GetIntField(existingDaily, "incorrect_count") + incorrect),
                ["last_deck_id"] = StatValue.FromString(session.DeckId)
            };
            await stats.UpsertAsync(new StatisticsRecordWrite
            {
                Namespace = SourceFlashcards,
                Kind = FlashcardStatKinds.DailySummary,
                Key = dayKey,
                SourceModule = SourceFlashcards,
                Fields = dailyFields
            }).ConfigureAwait(false);

            // Per-deck rolling summary
            var deckKey = $"deck:{session.DeckId}";
            var existingDeck = (await stats.GetAsync(SourceFlashcards, FlashcardStatKinds.DeckSummary, deckKey).ConfigureAwait(false)).Value;
            var deckFields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
            {
                ["total_reviewed"] = StatValue.FromInt(GetIntField(existingDeck, "total_reviewed") + totalCards),
                ["last_practiced"] = StatValue.FromDateTime(session.CompletedAt)
            };
            if (!string.IsNullOrEmpty(deckName))
                deckFields["deck_name"] = StatValue.FromString(deckName);
            await stats.UpsertAsync(new StatisticsRecordWrite
            {
                Namespace = SourceFlashcards,
                Kind = FlashcardStatKinds.DeckSummary,
                Key = deckKey,
                SourceModule = SourceFlashcards,
                Fields = deckFields
            }).ConfigureAwait(false);

            // Lifetime totals + streak
            var totals = (await stats.GetAsync(SourceFlashcards, FlashcardStatKinds.LifetimeTotals, "all").ConfigureAwait(false)).Value;
            var todayUtc = session.CompletedAt.UtcDateTime.Date;
            var streak = ComputeUpdatedStreak(totals, todayUtc);

            var totalsFields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
            {
                ["total_cards_practiced"] = StatValue.FromInt(GetIntField(totals, "total_cards_practiced") + totalCards),
                ["total_sessions"] = StatValue.FromInt(GetIntField(totals, "total_sessions") + 1),
                ["current_streak_days"] = StatValue.FromInt(streak.current),
                ["longest_streak_days"] = StatValue.FromInt(Math.Max(streak.current, GetIntField(totals, "longest_streak_days"))),
                ["last_practiced_utc_day"] = StatValue.FromDateTime(new DateTimeOffset(todayUtc, TimeSpan.Zero))
            };
            await stats.UpsertAsync(new StatisticsRecordWrite
            {
                Namespace = SourceFlashcards,
                Kind = FlashcardStatKinds.LifetimeTotals,
                Key = "all",
                SourceModule = SourceFlashcards,
                Fields = totalsFields
            }).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger?.Error("Statistics", "Recording flashcard session failed; ignoring.", ex);
        }
    }

    /// <summary>Increments the requested counter on today's daily summary for the given namespace.</summary>
    public static async Task IncrementDailyCounterAsync(
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
            var dayKey = DateTimeOffset.UtcNow.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
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

    private static long GetIntField(StatisticsRecord? record, string field)
    {
        if (record == null) return 0L;
        if (!record.Fields.TryGetValue(field, out var v)) return 0L;
        return v.Type == StatValueType.Integer ? v.AsInt() : 0L;
    }

    private static (int current, DateTime? lastDay) ComputeUpdatedStreak(StatisticsRecord? totals, DateTime todayUtc)
    {
        DateTime? lastDay = null;
        if (totals != null && totals.Fields.TryGetValue("last_practiced_utc_day", out var v) && v.Type == StatValueType.DateTime)
            lastDay = v.AsDateTime().UtcDateTime.Date;

        var current = (int)GetIntField(totals, "current_streak_days");
        if (lastDay == null || current <= 0)
            return (1, todayUtc);

        if (lastDay.Value == todayUtc)
            return (Math.Max(current, 1), todayUtc);
        if (lastDay.Value == todayUtc.AddDays(-1))
            return (current + 1, todayUtc);
        return (1, todayUtc);
    }
}
