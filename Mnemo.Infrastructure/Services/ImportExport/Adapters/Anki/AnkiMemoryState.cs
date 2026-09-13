using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

/// <summary>Reconstructs FSRS memory from the usable portion of an Anki review log.</summary>
internal static class AnkiMemoryState
{
    private const double HistoricalRetention = 0.9d;

    /// <summary>
    /// Follows Anki's incomplete-history handling at revision
    /// <c>2fae55543cfaa82880b84787b09b0ebf06ac9e29</c>. A learning row proves the
    /// history complete. Otherwise the first interday review becomes an SM-2 starting state.
    /// Cram answers are passed over the way that revision passes over them, and a filtered answer
    /// that rescheduled the card counts as the answer it was. Two measurements differ on purpose:
    /// the gap between answers is fractional days, as the scheduler here measures it, where Anki
    /// counts study-day rollovers; and an anchor interval stored in seconds is read as the days it
    /// spans, where Anki floors it at one day.
    /// </summary>
    public static FsrsForwardModel.MemoryState? Replay(
        IReadOnlyList<AnkiRevlogRow> rows,
        double[] weights)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(weights);

        if (rows.Count == 0)
            return null;

        var ordered = rows.OrderBy(row => row.Id).ToArray();
        var startAfterReset = 0;
        for (var index = 0; index < ordered.Length; index++)
        {
            if (AnkiRevlog.IsReset(ordered[index]))
                startAfterReset = index + 1;
        }

        if (startAfterReset == ordered.Length)
            return null;

        var lifecycle = ordered[startAfterReset..];
        var latestLearning = Array.FindLastIndex(
            lifecycle,
            row => AnkiRevlog.IsAnswer(row) && row.Type == AnkiRevlog.TypeLearn);

        if (latestLearning >= 0)
        {
            var firstLearning = latestLearning;
            for (var index = latestLearning - 1; index >= 0; index--)
            {
                var row = lifecycle[index];
                if (AnkiRevlog.IsCramming(row))
                    continue;
                if (AnkiRevlog.IsAnswer(row) && row.Type == AnkiRevlog.TypeLearn)
                {
                    firstLearning = index;
                    continue;
                }

                break;
            }

            return FsrsMemoryReplay.Replay(ReplayRows(lifecycle[firstLearning..]), weights);
        }

        var anchorIndex = Array.FindIndex(
            lifecycle,
            row => AnkiRevlog.MovesMemory(row) && AnkiRevlog.ToDays(row.Interval) >= 1d);
        if (anchorIndex < 0)
            return null;

        var anchor = lifecycle[anchorIndex];
        var easeFactor = AnkiRevlog.EaseFactor(anchor.Factor);
        var state = FsrsSm2Memory.Approximate(
            easeFactor,
            AnkiRevlog.ToDays(anchor.Interval),
            HistoricalRetention,
            weights);
        if (state is null)
            return null;

        if (easeFactor <= 1.1d)
        {
            state = state.Value with
            {
                Difficulty = Math.Clamp((easeFactor - 0.1d) * 9d + 1d, 1d, 10d),
            };
        }

        return FsrsMemoryReplay.ReplayFrom(
            state.Value,
            DateTimeOffset.FromUnixTimeMilliseconds(anchor.Id),
            ReplayRows(lifecycle[(anchorIndex + 1)..]),
            weights);
    }

    // The ids are blank because these rows exist only to be folded through the model. The rows
    // the collection keeps are written later, against the card that lands, by the history import.
    private static IReadOnlyList<FlashcardReviewLog> ReplayRows(
        IEnumerable<AnkiRevlogRow> rows) =>
        AnkiRevlog.ToReviewLogs(string.Empty, string.Empty, string.Empty, rows, AnkiRevlog.MovesMemory);
}
