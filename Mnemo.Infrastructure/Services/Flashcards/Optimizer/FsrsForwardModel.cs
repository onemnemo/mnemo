using System;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Optimizer;

/// <summary>
/// Replays a card's memory state under a candidate weight vector, and says how likely the card was
/// to be recalled at each answer. This is the trainer's view of the FSRS-6 model: stability,
/// difficulty and the forgetting curve, with no learning steps, due dates or day boundaries.
/// </summary>
/// <remarks>
/// The stability and difficulty recurrences are the same ones the scheduler applies. They are
/// written out here rather than reached through the scheduler because fitting needs the
/// retrievability the scheduler never exposes, and needs to run millions of steps without
/// constructing a schedule and a preset per answer. A conformance test replays the same sequence
/// through both and requires them to agree, so the two cannot drift apart unnoticed.
/// </remarks>
public static class FsrsForwardModel
{
    /// <summary>Floor the scheduler holds stability to.</summary>
    public const double MinStability = 0.001d;

    /// <summary>Ceiling the scheduler holds stability to.</summary>
    public const double MaxStability = 36500d;

    /// <summary>Memory state after one answer.</summary>
    public readonly record struct MemoryState(double Stability, double Difficulty);

    /// <summary>The state a card enters on its first ever answer, which has no prior memory.</summary>
    public static MemoryState First(FlashcardReviewGrade grade, double[] weights) => new(
        Clamp(InitialStability(grade, weights), MinStability, MaxStability),
        Clamp(InitialDifficulty(grade, weights), 1d, 10d));

    /// <summary>The state a card enters after answering <paramref name="grade"/> following a gap.</summary>
    public static MemoryState Next(MemoryState current, double elapsedDays, FlashcardReviewGrade grade, double[] weights)
    {
        var baseStability = Math.Max(MinStability, current.Stability);
        var baseDifficulty = Clamp(current.Difficulty, 1d, 10d);
        var r = Retrievability(elapsedDays, baseStability, weights);

        var stability = elapsedDays < 1d
            ? ShortTermStability(baseStability, grade, weights)
            : grade == FlashcardReviewGrade.Again
                ? ForgetStability(baseDifficulty, baseStability, r, weights)
                : RecallStability(baseDifficulty, baseStability, r, grade, weights);

        return new MemoryState(
            Clamp(stability, MinStability, MaxStability),
            Clamp(NextDifficulty(baseDifficulty, grade, weights), 1d, 10d));
    }

    /// <summary>Probability the card is still recalled <paramref name="elapsedDays"/> after it was last seen.</summary>
    public static double Retrievability(double elapsedDays, double stability, double[] weights) =>
        Math.Pow(1d + Factor(weights) * elapsedDays / Math.Max(MinStability, stability), Decay(weights));

    private static double Decay(double[] weights) => -weights[20];

    private static double Factor(double[] weights) => Math.Pow(0.9d, 1d / Decay(weights)) - 1d;

    private static double InitialStability(FlashcardReviewGrade grade, double[] weights) =>
        Math.Max(weights[(int)grade - 1], MinStability);

    private static double InitialDifficulty(FlashcardReviewGrade grade, double[] weights) =>
        Clamp(RawInitialDifficulty(grade, weights), 1d, 10d);

    private static double RawInitialDifficulty(FlashcardReviewGrade grade, double[] weights) =>
        weights[4] - Math.Exp(weights[5] * ((int)grade - 1)) + 1d;

    private static double NextDifficulty(double difficulty, FlashcardReviewGrade grade, double[] weights)
    {
        var delta = -weights[6] * ((int)grade - 3);
        var damped = difficulty + delta * (10d - difficulty) / 9d;
        var reverted = weights[7] * RawInitialDifficulty(FlashcardReviewGrade.Easy, weights)
                       + (1d - weights[7]) * damped;
        return Clamp(reverted, 1d, 10d);
    }

    private static double ShortTermStability(double stability, FlashcardReviewGrade grade, double[] weights)
    {
        var increase = Math.Exp(weights[17] * ((int)grade - 3 + weights[18]))
                       * Math.Pow(stability, -weights[19]);

        if (grade != FlashcardReviewGrade.Again)
            increase = Math.Max(increase, 1d);

        return Math.Max(stability * increase, MinStability);
    }

    private static double RecallStability(double difficulty, double stability, double retrievability, FlashcardReviewGrade grade, double[] weights)
    {
        var hardPenalty = grade == FlashcardReviewGrade.Hard ? weights[15] : 1d;
        var easyBonus = grade == FlashcardReviewGrade.Easy ? weights[16] : 1d;
        var updated = stability * (
            Math.Exp(weights[8]) *
            (11d - difficulty) *
            Math.Pow(stability, -weights[9]) *
            (Math.Exp((1d - retrievability) * weights[10]) - 1d) *
            hardPenalty * easyBonus + 1d);
        return Math.Max(updated, MinStability);
    }

    private static double ForgetStability(double difficulty, double stability, double retrievability, double[] weights)
    {
        var updated = weights[11]
            * Math.Pow(difficulty, -weights[12])
            * (Math.Pow(stability + 1d, weights[13]) - 1d)
            * Math.Exp(weights[14] * (1d - retrievability));

        var cap = stability / Math.Exp(weights[17] * weights[18]);
        return Math.Max(Math.Min(updated, cap), MinStability);
    }

    private static double Clamp(double value, double min, double max) => Math.Min(max, Math.Max(min, value));
}
