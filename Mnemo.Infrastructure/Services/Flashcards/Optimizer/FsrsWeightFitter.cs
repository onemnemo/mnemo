using System;
using System.Collections.Generic;
using System.Threading;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Optimizer;

/// <summary>Outcome of a fit: the vector to offer, and what it scored against the one in use.</summary>
public sealed record FsrsFitResult(double[] Weights, double LossBefore, double LossAfter, int Evaluations);

/// <summary>
/// Fits an FSRS-6 weight vector to a collection's own review history.
/// </summary>
/// <remarks>
/// The search is a projected coordinate pattern search: probe one parameter at a time, keep a
/// probe only when it lowers the loss, and halve the step once a whole sweep finds nothing. It
/// needs no derivatives of the FSRS equations, which keeps the forward model the single place the
/// model is written down, and it draws no random numbers, so the same history and the same
/// starting vector always produce the same result.
///
/// Every probe is projected back into the parameter box before it is scored, so no vector the
/// search can reach is capable of producing a NaN memory state.
/// </remarks>
public static class FsrsWeightFitter
{
    /// <summary>Largest number of scored answers a fit reads. Bounds how long a fit can run.</summary>
    public const int ScoredReviewBudget = 10_000;

    /// <summary>Scored answers a collection needs before a fit is worth offering.</summary>
    public const int MinimumScoredReviews = 400;

    private const int MaxEvaluations = 1_500;
    private const double StartStepFraction = 0.05d;
    private const double MinStepFraction = 0.0002d;
    private const double MinImprovement = 1e-9d;

    // Keeps a certain answer from scoring an infinite loss when the model happens to be sure and
    // wrong. Matches the guard the reference trainers put on their own log loss.
    private const double ProbabilityFloor = 1e-6d;

    /// <summary>
    /// Mean log loss of the model's recall predictions over the scored answers.
    /// </summary>
    /// <remarks>
    /// Returns <see cref="double.NaN"/> when nothing in the set is scored, which the caller should
    /// have refused before getting here.
    /// </remarks>
    public static double Loss(FsrsTrainingSet set, double[] weights)
    {
        ArgumentNullException.ThrowIfNull(set);
        ArgumentNullException.ThrowIfNull(weights);

        var total = 0d;
        var scored = 0;

        foreach (var chain in set.Chains)
        {
            var reviews = chain.Reviews;
            if (reviews.Length == 0)
                continue;

            var state = FsrsForwardModel.First(reviews[0].Grade, weights);
            for (var i = 1; i < reviews.Length; i++)
            {
                var review = reviews[i];
                if (review.Scored)
                {
                    var recalled = FsrsForwardModel.Retrievability(review.ElapsedDays, state.Stability, weights);
                    recalled = Math.Min(1d - ProbabilityFloor, Math.Max(ProbabilityFloor, recalled));
                    total += review.Grade == FlashcardReviewGrade.Again
                        ? -Math.Log(1d - recalled)
                        : -Math.Log(recalled);
                    scored++;
                }

                state = FsrsForwardModel.Next(state, review.ElapsedDays, review.Grade, weights);
            }
        }

        return scored == 0 ? double.NaN : total / scored;
    }

    /// <summary>
    /// Searches for a vector that scores better than <paramref name="inUse"/> on this history.
    /// </summary>
    /// <remarks>
    /// The published defaults are tried as a second starting point, so a collection carrying a
    /// poor vector from an earlier fit is not held to it. The result is never worse than the
    /// vector in use: if nothing beats it, it is returned unchanged.
    /// </remarks>
    public static FsrsFitResult Fit(FsrsTrainingSet set, IReadOnlyList<double> inUse, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(set);
        ArgumentNullException.ThrowIfNull(inUse);

        var current = FsrsWeightRules.Clip(inUse);
        var lossBefore = Loss(set, current);
        var evaluations = 1;

        var best = current;
        var bestLoss = lossBefore;

        var defaults = FsrsWeightRules.Defaults();
        var defaultsLoss = Loss(set, defaults);
        evaluations++;
        if (defaultsLoss < bestLoss - MinImprovement)
        {
            best = defaults;
            bestLoss = defaultsLoss;
        }

        var scale = new double[FsrsWeightRules.Fsrs6Count];
        var direction = new int[FsrsWeightRules.Fsrs6Count];
        for (var i = 0; i < scale.Length; i++)
        {
            scale[i] = FsrsWeightRules.UpperBound(i) - FsrsWeightRules.LowerBound(i);
            direction[i] = 1;
        }

        var fraction = StartStepFraction;
        while (fraction >= MinStepFraction && evaluations < MaxEvaluations)
        {
            var improved = false;

            for (var i = 0; i < FsrsWeightRules.Fsrs6Count && evaluations < MaxEvaluations; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                for (var attempt = 0; attempt < 2; attempt++)
                {
                    var sign = attempt == 0 ? direction[i] : -direction[i];
                    var moved = Math.Min(
                        FsrsWeightRules.UpperBound(i),
                        Math.Max(FsrsWeightRules.LowerBound(i), best[i] + sign * fraction * scale[i]));
                    if (moved == best[i])
                        continue;

                    var trial = (double[])best.Clone();
                    trial[i] = moved;
                    var loss = Loss(set, trial);
                    evaluations++;

                    if (loss < bestLoss - MinImprovement)
                    {
                        best = trial;
                        bestLoss = loss;
                        direction[i] = sign;
                        improved = true;
                        break;
                    }
                }
            }

            if (!improved)
                fraction *= 0.5d;
        }

        return new FsrsFitResult(best, lossBefore, bestLoss, evaluations);
    }
}
