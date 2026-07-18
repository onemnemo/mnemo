using System;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// An FSRS-5 implementation transcribed from the published algorithm rather than from
/// <c>FsrsScheduler</c>. Keeping a second, independently-written copy is the point: a golden-vector
/// test only proves the scheduler still does what it did last week, while comparing against this
/// proves it still does what FSRS-5 says. Grades are 1-4 (Again..Easy), matching the weight layout.
/// </summary>
internal static class FsrsReferenceOracle
{
    /// <summary>
    /// FSRS-5 fixes decay at -0.5. Mnemo carries a 21-slot weight vector and derives decay from
    /// w20, so w20 = 0 reproduces FSRS-5 exactly; the slot exists to leave room for FSRS-6.
    /// </summary>
    public static double Decay(double[] w) => -(w[20] + 0.5d);

    /// <summary>FACTOR = 0.9^(1/DECAY) - 1, which is 19/81 at the FSRS-5 decay.</summary>
    public static double Factor(double[] w) => Math.Pow(0.9d, 1d / Decay(w)) - 1d;

    /// <summary>R(t, S) = (1 + FACTOR * t / S)^DECAY.</summary>
    public static double Retrievability(double elapsedDays, double stability, double[] w) =>
        Math.Pow(1d + Factor(w) * elapsedDays / stability, Decay(w));

    /// <summary>I(r, S) = S / FACTOR * (r^(1/DECAY) - 1), rounded and floored at one day.</summary>
    public static int NextInterval(double stability, double desiredRetention, double[] w)
    {
        var interval = stability / Factor(w) * (Math.Pow(desiredRetention, 1d / Decay(w)) - 1d);
        return Math.Max(1, (int)Math.Round(interval, MidpointRounding.AwayFromZero));
    }

    /// <summary>S_0(G) = w[G-1].</summary>
    public static double InitialStability(int grade, double[] w) => w[grade - 1];

    /// <summary>D_0(G) = w4 - e^(w5 * (G-1)) + 1, clamped to [1, 10].</summary>
    public static double InitialDifficulty(int grade, double[] w) =>
        Clamp(w[4] - Math.Exp(w[5] * (grade - 1)) + 1d, 1d, 10d);

    /// <summary>Linear damping then mean reversion toward D_0(Easy).</summary>
    public static double NextDifficulty(double difficulty, int grade, double[] w)
    {
        var delta = -w[6] * (grade - 3);
        var damped = difficulty + delta * (10d - difficulty) / 9d;
        var reverted = w[7] * InitialDifficulty(4, w) + (1d - w[7]) * damped;
        return Clamp(reverted, 1d, 10d);
    }

    /// <summary>Same-day review: S' = S * e^(w17 * (G - 3 + w18)).</summary>
    public static double ShortTermStability(double stability, int grade, double[] w) =>
        stability * Math.Exp(w[17] * (grade - 3 + w[18]));

    /// <summary>Stability after a successful recall.</summary>
    public static double RecallStability(double difficulty, double stability, double retrievability, int grade, double[] w)
    {
        var hardPenalty = grade == 2 ? w[15] : 1d;
        var easyBonus = grade == 4 ? w[16] : 1d;
        return stability * (
            Math.Exp(w[8]) *
            (11d - difficulty) *
            Math.Pow(stability, -w[9]) *
            (Math.Exp((1d - retrievability) * w[10]) - 1d) *
            hardPenalty * easyBonus + 1d);
    }

    /// <summary>
    /// Stability after a lapse, including the FSRS-5 cap at S / e^(w17 * w18). The cap is what stops
    /// a lapse from raising stability above its pre-lapse value; Mnemo's scheduler omits it, so this
    /// method and <see cref="ForgetStabilityUncapped"/> deliberately disagree in that regime.
    /// </summary>
    public static double ForgetStability(double difficulty, double stability, double retrievability, double[] w) =>
        Math.Min(ForgetStabilityUncapped(difficulty, stability, retrievability, w), PostLapseCap(stability, w));

    /// <summary>The uncapped term, matching what Mnemo currently computes.</summary>
    public static double ForgetStabilityUncapped(double difficulty, double stability, double retrievability, double[] w) =>
        w[11]
        * Math.Pow(difficulty, -w[12])
        * (Math.Pow(stability + 1d, w[13]) - 1d)
        * Math.Exp(w[14] * (1d - retrievability));

    /// <summary>The FSRS-5 ceiling on post-lapse stability.</summary>
    public static double PostLapseCap(double stability, double[] w) => stability / Math.Exp(w[17] * w[18]);

    /// <summary>The weight vector Mnemo ships as its default.</summary>
    public static double[] DefaultWeights => FlashcardFsrsParameters.Default.Weights;

    private static double Clamp(double value, double min, double max) => Math.Min(max, Math.Max(min, value));
}
