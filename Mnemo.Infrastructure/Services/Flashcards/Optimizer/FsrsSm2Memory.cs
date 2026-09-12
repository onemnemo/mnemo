using System;

namespace Mnemo.Infrastructure.Services.Flashcards.Optimizer;

/// <summary>Approximates FSRS memory from a card's latest SM-2 ease and interval.</summary>
public static class FsrsSm2Memory
{
    /// <summary>
    /// Transcribed from fsrs-rs <c>src/inference.rs</c> at revision
    /// <c>b46226aae5ea03959c27cd81abb603bb6b744907</c>. Returns null for unusable inputs.
    /// </summary>
    public static FsrsForwardModel.MemoryState? Approximate(
        double easeFactor,
        double intervalDays,
        double sm2Retention,
        double[] weights)
    {
        ArgumentNullException.ThrowIfNull(weights);

        if (weights.Length < 21
            || !double.IsFinite(easeFactor)
            || !double.IsFinite(intervalDays)
            || !double.IsFinite(sm2Retention)
            || easeFactor <= 0d
            || intervalDays <= 0d
            || sm2Retention is <= 0d or >= 1d)
        {
            return null;
        }

        var decay = -weights[20];
        var factor = Math.Pow(0.9d, 1d / decay) - 1d;
        var stability = Math.Max(intervalDays, FsrsForwardModel.MinStability)
            * factor
            / (Math.Pow(sm2Retention, 1d / decay) - 1d);
        var difficulty = 11d
            - (easeFactor - 1d)
            / (Math.Exp(weights[8])
               * Math.Pow(stability, -weights[9])
               * (Math.Exp((1d - sm2Retention) * weights[10]) - 1d));

        if (!double.IsFinite(stability) || !double.IsFinite(difficulty))
            return null;

        return new FsrsForwardModel.MemoryState(
            Math.Clamp(stability, FsrsForwardModel.MinStability, FsrsForwardModel.MaxStability),
            Math.Clamp(difficulty, 1d, 10d));
    }
}
