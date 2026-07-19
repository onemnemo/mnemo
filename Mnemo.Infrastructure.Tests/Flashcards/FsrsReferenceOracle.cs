using System;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// An FSRS-6 implementation transcribed from the published algorithm rather than from
/// <c>FsrsScheduler</c>. Keeping a second, independently-written copy is the point: a golden-vector
/// test only proves the scheduler still does what it did last week, while comparing against this
/// proves it still does what FSRS-6 says. Grades are 1-4 (Again..Easy), matching the weight layout.
/// </summary>
internal static class FsrsReferenceOracle
{
    /// <summary>
    /// FSRS-6 fits the forgetting curve's decay instead of pinning it, and it is -w20. FSRS-5's
    /// fixed -0.5 is the special case w20 = 0.5.
    /// </summary>
    public static double Decay(double[] w) => -w[20];

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
        Clamp(RawInitialDifficulty(grade, w), 1d, 10d);

    /// <summary>
    /// D_0(G) before the clamp. Mean reversion targets the unclamped D_0(Easy), which the FSRS-6
    /// defaults put well below 1 — clamping it would silently retarget the whole difficulty model.
    /// </summary>
    public static double RawInitialDifficulty(int grade, double[] w) =>
        w[4] - Math.Exp(w[5] * (grade - 1)) + 1d;

    /// <summary>Linear damping then mean reversion toward the unclamped D_0(Easy).</summary>
    public static double NextDifficulty(double difficulty, int grade, double[] w)
    {
        var delta = -w[6] * (grade - 3);
        var damped = difficulty + delta * (10d - difficulty) / 9d;
        var reverted = w[7] * RawInitialDifficulty(4, w) + (1d - w[7]) * damped;
        return Clamp(reverted, 1d, 10d);
    }

    /// <summary>
    /// Same-day review: S' = S * e^(w17 * (G - 3 + w18)) * S^(-w19). FSRS-6 adds the w19 damping
    /// term and floors the multiplier at 1 from Hard up, so only Again can lose stability same-day.
    /// </summary>
    public static double ShortTermStability(double stability, int grade, double[] w)
    {
        var increase = Math.Exp(w[17] * (grade - 3 + w[18])) * Math.Pow(stability, -w[19]);
        if (grade >= 2)
            increase = Math.Max(increase, 1d);
        return stability * increase;
    }

    /// <summary>Stability after a successful recall. Unchanged from FSRS-5.</summary>
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
    /// Stability after a lapse, including the ceiling at S / e^(w17 * w18) that stops a lapse from
    /// raising stability above its pre-lapse value.
    /// </summary>
    public static double ForgetStability(double difficulty, double stability, double retrievability, double[] w) =>
        Math.Min(ForgetStabilityUncapped(difficulty, stability, retrievability, w), PostLapseCap(stability, w));

    /// <summary>The uncapped long-term term.</summary>
    public static double ForgetStabilityUncapped(double difficulty, double stability, double retrievability, double[] w) =>
        w[11]
        * Math.Pow(difficulty, -w[12])
        * (Math.Pow(stability + 1d, w[13]) - 1d)
        * Math.Exp(w[14] * (1d - retrievability));

    /// <summary>The ceiling on post-lapse stability.</summary>
    public static double PostLapseCap(double stability, double[] w) => stability / Math.Exp(w[17] * w[18]);

    /// <summary>The weight vector Mnemo ships as its default.</summary>
    public static double[] DefaultWeights => FlashcardFsrsParameters.Default.Weights;

    /// <summary>
    /// The published FSRS-5 defaults, padded into the 21-slot shape. Used to prove that a 19-slot
    /// vector still schedules as FSRS-5 did once padded.
    /// </summary>
    public static double[] Fsrs5Defaults { get; } =
    {
        0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604,
        0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605,
        2.2698, 0.2315, 2.9898, 0.51655, 0.6621, 0.0, 0.5
    };

    private static double Clamp(double value, double min, double max) => Math.Min(max, Math.Max(min, value));
}
