using System;
using System.Collections.Generic;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards.Optimizer;

/// <summary>
/// Turns raw review rows into the memory chains a fit replays.
/// </summary>
/// <remarks>
/// Three rules do the work here.
///
/// A chain has to start where the model can start it, which is a card with no memory yet. An
/// answer whose starting state is anything else follows a history the log does not hold, so its
/// stability and difficulty are unknown and no candidate vector can reproduce them. Rows before
/// the first such answer are dropped, and a card whose schedule was reset back to New contributes
/// a second chain from that point.
///
/// The gap between two answers is measured from the timestamps rather than read from the logged
/// interval. The two agree for every row written by a scheduled session, and taking the timestamps
/// means a collection whose older rows logged a wrong interval still trains correctly.
///
/// Only answers separated from the previous one by a day or more are scored, for the reason on
/// <see cref="FsrsTrainingReview"/>.
/// </remarks>
public static class FsrsTrainingSetBuilder
{
    /// <summary>Shortest gap an answer may have and still be scored.</summary>
    public const double MinScoredGapDays = 1d;

    /// <summary>
    /// Builds the training set.
    /// </summary>
    /// <param name="rows">Review rows in any order. Undone answers are simply absent: undo deletes the row.</param>
    /// <param name="scoredReviewBudget">
    /// Largest number of scored answers to keep. Chains are taken most recently answered first, so
    /// a very large collection trains on its recent history rather than on all of it. Pass a
    /// non-positive value for no cap.
    /// </param>
    public static FsrsTrainingSet Build(IReadOnlyList<FlashcardReviewRow> rows, int scoredReviewBudget)
    {
        ArgumentNullException.ThrowIfNull(rows);

        var byCard = new Dictionary<string, List<FlashcardReviewRow>>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            if (!byCard.TryGetValue(row.CardId, out var list))
            {
                list = new List<FlashcardReviewRow>();
                byCard[row.CardId] = list;
            }
            list.Add(row);
        }

        var candidates = new List<Candidate>();
        foreach (var (cardId, cardRows) in byCard)
        {
            cardRows.Sort(static (a, b) =>
            {
                var byTime = a.ReviewedAt.CompareTo(b.ReviewedAt);
                return byTime != 0 ? byTime : a.Id.CompareTo(b.Id);
            });

            foreach (var chain in SplitIntoChains(cardId, cardRows))
                candidates.Add(chain);
        }

        candidates.Sort(static (a, b) =>
        {
            var byRecency = b.LastAnsweredAt.CompareTo(a.LastAnsweredAt);
            if (byRecency != 0)
                return byRecency;
            var byCardId = string.CompareOrdinal(a.Chain.CardId, b.Chain.CardId);
            return byCardId != 0 ? byCardId : a.FirstRowId.CompareTo(b.FirstRowId);
        });

        var taken = new List<Candidate>();
        var used = 0;
        var scored = 0;
        foreach (var candidate in candidates)
        {
            if (scoredReviewBudget > 0 && scored >= scoredReviewBudget)
                break;
            taken.Add(candidate);
            used += candidate.Chain.Reviews.Length;
            scored += candidate.ScoredCount;
        }

        // Replayed in a fixed order rather than in recency order, so the loss is summed the same
        // way every run and two fits of the same data cannot disagree in the last decimal.
        taken.Sort(static (a, b) =>
        {
            var byCardId = string.CompareOrdinal(a.Chain.CardId, b.Chain.CardId);
            return byCardId != 0 ? byCardId : a.FirstRowId.CompareTo(b.FirstRowId);
        });

        var chains = new List<FsrsTrainingChain>(taken.Count);
        foreach (var candidate in taken)
            chains.Add(candidate.Chain);

        return new FsrsTrainingSet(chains, rows.Count, used, scored);
    }

    private static IEnumerable<Candidate> SplitIntoChains(string cardId, List<FlashcardReviewRow> cardRows)
    {
        var start = -1;
        for (var i = 0; i <= cardRows.Count; i++)
        {
            var opensChain = i < cardRows.Count && cardRows[i].StateBefore == FlashcardFsrsState.New;
            if (!opensChain && i < cardRows.Count)
                continue;

            if (start >= 0)
            {
                var chain = BuildChain(cardId, cardRows, start, i);
                if (chain is not null)
                    yield return chain.Value;
            }

            start = i;
        }
    }

    private static Candidate? BuildChain(string cardId, List<FlashcardReviewRow> cardRows, int start, int end)
    {
        var length = end - start;
        var reviews = new FsrsTrainingReview[length];
        var scored = 0;
        for (var i = 0; i < length; i++)
        {
            var row = cardRows[start + i];
            var elapsed = i == 0
                ? 0d
                : Math.Max(0d, (row.ReviewedAt - cardRows[start + i - 1].ReviewedAt).TotalDays);
            var isScored = i > 0 && elapsed >= MinScoredGapDays;
            if (isScored)
                scored++;
            reviews[i] = new FsrsTrainingReview(elapsed, row.Grade, isScored);
        }

        if (scored == 0)
            return null;

        return new Candidate(
            new FsrsTrainingChain(cardId, reviews),
            scored,
            cardRows[end - 1].ReviewedAt,
            cardRows[start].Id);
    }

    private readonly record struct Candidate(
        FsrsTrainingChain Chain,
        int ScoredCount,
        DateTimeOffset LastAnsweredAt,
        long FirstRowId);
}
