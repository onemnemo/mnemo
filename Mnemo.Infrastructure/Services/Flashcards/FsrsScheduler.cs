using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// FSRS-5 implementation. The stability/difficulty math is the standard FSRS-5 model; New/Learning/
/// Relearning cards additionally walk the preset's minute-based learning steps before graduating to
/// Review. Again resets to step 0, Good advances a step (graduating past the last step), Hard repeats
/// the current step, Easy graduates immediately.
/// </summary>
public sealed class FsrsScheduler : IFsrsScheduler
{
    private const double MinStability = 0.1d;
    private const double MinRetention = 0.70d;
    private const double MaxRetention = 0.99d;

    public FlashcardSchedule ApplyGrade(FlashcardSchedule current, FlashcardReviewGrade grade, DateTimeOffset reviewedAt, FlashcardPreset preset)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(preset);

        var weights = ResolveWeights(preset);
        var retention = Math.Clamp(preset.DesiredRetention, MinRetention, MaxRetention);

        double stability;
        double difficulty;
        int stepIndex;
        int lapseIncrement = 0;
        FlashcardFsrsState nextState;
        DateTimeOffset due;

        switch (current.FsrsState)
        {
            case FlashcardFsrsState.New:
            {
                stability = InitialStability(grade, weights);
                difficulty = InitialDifficulty(grade, weights);
                var steps = Steps(preset.LearningSteps);
                if (grade == FlashcardReviewGrade.Easy || steps.Length == 0)
                {
                    nextState = FlashcardFsrsState.Review;
                    stepIndex = 0;
                    due = reviewedAt.AddDays(NextInterval(stability, retention, weights));
                }
                else
                {
                    nextState = FlashcardFsrsState.Learning;
                    stepIndex = 0;
                    due = reviewedAt.AddMinutes(steps[0]);
                }
                break;
            }

            case FlashcardFsrsState.Learning:
            case FlashcardFsrsState.Relearning:
            {
                var elapsed = ElapsedDays(current, reviewedAt);
                var baseStability = Math.Max(MinStability, current.Stability ?? InitialStability(grade, weights));
                var baseDifficulty = Clamp(current.Difficulty ?? InitialDifficulty(grade, weights), 1d, 10d);
                var r = Forgetting(elapsed, baseStability, weights);

                stability = elapsed < 1d
                    ? ShortTermStability(baseStability, grade, weights)
                    : grade == FlashcardReviewGrade.Again
                        ? ForgetStability(baseDifficulty, baseStability, r, weights)
                        : RecallStability(baseDifficulty, baseStability, r, grade, weights);
                difficulty = NextDifficulty(baseDifficulty, grade, weights);

                var steps = Steps(current.FsrsState == FlashcardFsrsState.Relearning ? preset.RelearnSteps : preset.LearningSteps);
                (nextState, stepIndex, due) = StepThrough(current.FsrsState, current.LearningStepIndex, grade, steps, stability, retention, weights, reviewedAt);
                break;
            }

            default: // Review
            {
                var elapsed = ElapsedDays(current, reviewedAt);
                var baseStability = Math.Max(MinStability, current.Stability ?? InitialStability(grade, weights));
                var baseDifficulty = Clamp(current.Difficulty ?? InitialDifficulty(grade, weights), 1d, 10d);
                var r = Forgetting(elapsed, baseStability, weights);
                difficulty = NextDifficulty(baseDifficulty, grade, weights);

                if (grade == FlashcardReviewGrade.Again)
                {
                    lapseIncrement = 1;
                    stability = ForgetStability(baseDifficulty, baseStability, r, weights);
                    var relearn = Steps(preset.RelearnSteps);
                    nextState = FlashcardFsrsState.Relearning;
                    stepIndex = 0;
                    due = reviewedAt.AddMinutes(relearn.Length > 0 ? relearn[0] : 10);
                }
                else
                {
                    stability = RecallStability(baseDifficulty, baseStability, r, grade, weights);
                    nextState = FlashcardFsrsState.Review;
                    stepIndex = 0;
                    due = reviewedAt.AddDays(NextInterval(stability, retention, weights));
                }
                break;
            }
        }

        return current with
        {
            DueDate = due,
            Stability = Math.Max(MinStability, stability),
            Difficulty = Clamp(difficulty, 1d, 10d),
            Reps = current.Reps + 1,
            Lapses = current.Lapses + lapseIncrement,
            FsrsState = nextState,
            LearningStepIndex = stepIndex,
            LastReviewedAt = reviewedAt
        };
    }

    public string DescribeInterval(FlashcardSchedule current, FlashcardReviewGrade grade, DateTimeOffset now, FlashcardPreset preset)
    {
        var next = ApplyGrade(current, grade, now, preset).DueDate;
        var delta = next - now;
        if (delta.TotalDays >= 1d)
            return $"{Math.Round(delta.TotalDays, MidpointRounding.AwayFromZero):0}d";
        if (delta.TotalHours >= 1d)
            return $"{Math.Round(delta.TotalHours, MidpointRounding.AwayFromZero):0}h";
        return $"{Math.Max(1, Math.Round(delta.TotalMinutes, MidpointRounding.AwayFromZero)):0}m";
    }

    // Learning/Relearning step machine. Returns (nextState, nextStepIndex, due).
    private static (FlashcardFsrsState, int, DateTimeOffset) StepThrough(
        FlashcardFsrsState state, int stepIndex, FlashcardReviewGrade grade, int[] steps,
        double stability, double retention, double[] weights, DateTimeOffset now)
    {
        DateTimeOffset Graduate() => now.AddDays(NextInterval(stability, retention, weights));

        switch (grade)
        {
            case FlashcardReviewGrade.Easy:
                return (FlashcardFsrsState.Review, 0, Graduate());
            case FlashcardReviewGrade.Again:
                return (state, 0, now.AddMinutes(steps.Length > 0 ? steps[0] : 1));
            case FlashcardReviewGrade.Hard:
            {
                var idx = steps.Length > 0 ? Math.Min(stepIndex, steps.Length - 1) : 0;
                return (state, idx, now.AddMinutes(steps.Length > 0 ? steps[idx] : 1));
            }
            default: // Good — advance a step, graduating past the last
            {
                var next = stepIndex + 1;
                if (next >= steps.Length)
                    return (FlashcardFsrsState.Review, 0, Graduate());
                return (state, next, now.AddMinutes(steps[next]));
            }
        }
    }

    private static double[] ResolveWeights(FlashcardPreset preset)
    {
        if (preset.Weights is { Count: 21 } w)
            return w.ToArray();
        return FlashcardFsrsParameters.Default.Weights;
    }

    private static int[] Steps(IReadOnlyList<int> steps) =>
        steps is null ? Array.Empty<int>() : steps.Where(s => s > 0).ToArray();

    private static double ElapsedDays(FlashcardSchedule current, DateTimeOffset now) =>
        Math.Max(0d, (now - (current.LastReviewedAt ?? current.DueDate)).TotalDays);

    // --- FSRS-5 core (ported from the retired Core FlashcardScheduling) ---

    private static int NextInterval(double stability, double desiredRetention, double[] weights)
    {
        var decay = -(weights[20] + 0.5d);
        var factor = Math.Pow(0.9d, 1d / decay) - 1d;
        var interval = stability / factor * (Math.Pow(desiredRetention, 1d / decay) - 1d);
        return Math.Max(1, (int)Math.Round(interval, MidpointRounding.AwayFromZero));
    }

    private static double Forgetting(double elapsedDays, double stability, double[] weights)
    {
        var decay = -(weights[20] + 0.5d);
        var factor = Math.Pow(0.9d, 1d / decay) - 1d;
        return Math.Pow(1d + factor * elapsedDays / Math.Max(MinStability, stability), decay);
    }

    private static double InitialStability(FlashcardReviewGrade grade, double[] weights) =>
        Math.Max(weights[(int)grade - 1], MinStability);

    private static double InitialDifficulty(FlashcardReviewGrade grade, double[] weights)
    {
        var d = weights[4] - Math.Exp(weights[5] * ((int)grade - 1)) + 1d;
        return Clamp(d, 1d, 10d);
    }

    private static double NextDifficulty(double difficulty, FlashcardReviewGrade grade, double[] weights)
    {
        var delta = -weights[6] * ((int)grade - 3);
        var raw = difficulty + delta * (10d - difficulty) / 9d;
        raw = weights[7] * InitialDifficulty(FlashcardReviewGrade.Easy, weights) + (1d - weights[7]) * raw;
        return Clamp(raw, 1d, 10d);
    }

    private static double ShortTermStability(double stability, FlashcardReviewGrade grade, double[] weights)
    {
        var updated = stability * Math.Exp(weights[17] * ((int)grade - 3 + weights[18]));
        return Math.Max(updated, MinStability);
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

        // Without this ceiling the term above overtakes the stability the card already had, so a
        // card forgotten after a long absence comes back scheduled further out than if it had never
        // lapsed. It bites hardest on weak cards: at a stability of one day, a month away is enough.
        var cap = stability / Math.Exp(weights[17] * weights[18]);
        return Math.Max(Math.Min(updated, cap), MinStability);
    }

    private static double Clamp(double value, double min, double max) => Math.Min(max, Math.Max(min, value));
}
