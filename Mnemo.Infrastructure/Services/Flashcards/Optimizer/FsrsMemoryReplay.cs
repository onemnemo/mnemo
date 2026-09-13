using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Optimizer;

/// <summary>Derives a card's current memory state by replaying its answered review history.</summary>
public static class FsrsMemoryReplay
{
    /// <summary>Returns null for an empty history, otherwise the state after its last answer.</summary>
    public static FsrsForwardModel.MemoryState? Replay(
        IReadOnlyList<FlashcardReviewLog> answers,
        double[] weights)
    {
        ArgumentNullException.ThrowIfNull(answers);
        ArgumentNullException.ThrowIfNull(weights);

        if (answers.Count == 0)
            return null;

        var ordered = answers.OrderBy(answer => answer.ReviewedAt).ToArray();
        var state = FsrsForwardModel.First(ordered[0].Grade, weights);
        for (var index = 1; index < ordered.Length; index++)
        {
            var elapsedDays = Math.Max(0d, (ordered[index].ReviewedAt - ordered[index - 1].ReviewedAt).TotalDays);
            state = FsrsForwardModel.Next(state, elapsedDays, ordered[index].Grade, weights);
        }

        return state;
    }

    /// <summary>Replays later answers from a memory state reconstructed at an earlier answer.</summary>
    public static FsrsForwardModel.MemoryState ReplayFrom(
        FsrsForwardModel.MemoryState state,
        DateTimeOffset previousReviewedAt,
        IReadOnlyList<FlashcardReviewLog> answers,
        double[] weights)
    {
        ArgumentNullException.ThrowIfNull(answers);
        ArgumentNullException.ThrowIfNull(weights);

        foreach (var answer in answers.OrderBy(answer => answer.ReviewedAt))
        {
            var elapsedDays = Math.Max(0d, (answer.ReviewedAt - previousReviewedAt).TotalDays);
            state = FsrsForwardModel.Next(state, elapsedDays, answer.Grade, weights);
            previousReviewedAt = answer.ReviewedAt;
        }

        return state;
    }
}
