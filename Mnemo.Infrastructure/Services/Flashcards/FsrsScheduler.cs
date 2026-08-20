using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// FSRS-6 implementation. The stability/difficulty math is the standard FSRS-6 model; New/Learning/
/// Relearning cards additionally walk the preset's minute-based learning steps before graduating to
/// Review. Again resets to step 0, Good advances a step (graduating past the last step), Hard repeats
/// the current step, Easy graduates immediately.
///
/// Intervals measured in days land on the start of a study day; only the minute-scale learning
/// steps stay exact instants, because those are meant to come back within the sitting.
/// </summary>
public sealed class FsrsScheduler : IFsrsScheduler
{
    private readonly FlashcardClock _clock;

    public FsrsScheduler(FlashcardClock clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        _clock = clock;
    }

    private const int WeightCount = 21;
    private const int Fsrs5WeightCount = 19;
    private const double MinStability = 0.001d;
    private const double MaxStability = 36500d;
    private const double MaxInterval = 36500d;
    private const double MinRetention = 0.70d;
    private const double MaxRetention = 0.99d;

    // FSRS-5 pinned the forgetting curve's decay at -0.5. Padding a 19-slot vector with these two
    // reproduces that exactly under FSRS-6's decay = -w20 parameterisation.
    private const double Fsrs5ShortTermDamping = 0.0d;
    private const double Fsrs5Decay = 0.5d;

    // The range FSRS-6's own parameter clipper holds w20 to.
    private const double MinDecay = 0.1d;
    private const double MaxDecay = 0.8d;

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
                    due = DayScaleDue(reviewedAt, NextInterval(stability, retention, weights), preset);
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
                (nextState, stepIndex, due) = StepThrough(current.FsrsState, current.LearningStepIndex, grade, steps, stability, retention, weights, reviewedAt, preset);
                break;
            }

            default: // Review
            {
                var elapsed = ElapsedDays(current, reviewedAt);
                var baseStability = Math.Max(MinStability, current.Stability ?? InitialStability(grade, weights));
                var baseDifficulty = Clamp(current.Difficulty ?? InitialDifficulty(grade, weights), 1d, 10d);
                var r = Forgetting(elapsed, baseStability, weights);
                difficulty = NextDifficulty(baseDifficulty, grade, weights);

                // A re-review on the same day is the short-term regime whatever state the card is
                // in, so this mirrors the Learning/Relearning branch above. Only the state and due
                // date differ by grade.
                stability = elapsed < 1d
                    ? ShortTermStability(baseStability, grade, weights)
                    : grade == FlashcardReviewGrade.Again
                        ? ForgetStability(baseDifficulty, baseStability, r, weights)
                        : RecallStability(baseDifficulty, baseStability, r, grade, weights);

                if (grade == FlashcardReviewGrade.Again)
                {
                    lapseIncrement = 1;
                    var relearn = Steps(preset.RelearnSteps);
                    nextState = FlashcardFsrsState.Relearning;
                    stepIndex = 0;
                    due = reviewedAt.AddMinutes(relearn.Length > 0 ? relearn[0] : 10);
                }
                else
                {
                    nextState = FlashcardFsrsState.Review;
                    stepIndex = 0;
                    due = DayScaleDue(reviewedAt, NextInterval(stability, retention, weights), preset);
                }
                break;
            }
        }

        return current with
        {
            DueDate = due,
            Stability = Clamp(stability, MinStability, MaxStability),
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
        ArgumentNullException.ThrowIfNull(preset);
        var next = ApplyGrade(current, grade, now, preset);

        if (next.FsrsState == FlashcardFsrsState.Review)
        {
            // A graduated card is due at the start of a study day, so the honest answer is how many
            // days away that day is rather than how many hours until it opens. Answering late in the
            // evening and seeing the card the morning after next is two days out, even though fewer
            // than forty eight hours separate the two instants.
            var days = _clock.DaysBetween(now, next.DueDate, preset.DayStartHour);
            return $"{Math.Max(1, days)}d";
        }

        // A learning or relearning step is an exact wait rather than a day, so it is reported as one.
        var delta = next.DueDate - now;
        if (delta.TotalDays >= 1d)
            return $"{Math.Round(delta.TotalDays, MidpointRounding.AwayFromZero):0}d";
        if (delta.TotalHours >= 1d)
            return $"{Math.Round(delta.TotalHours, MidpointRounding.AwayFromZero):0}h";
        return $"{Math.Max(1, Math.Round(delta.TotalMinutes, MidpointRounding.AwayFromZero)):0}m";
    }

    /// <summary>
    /// Where a whole number of days from now lands. Snapping to the start of the target study day
    /// is what makes a day mean the same thing to the scheduler, the daily caps and the forecast.
    /// </summary>
    private DateTimeOffset DayScaleDue(DateTimeOffset reviewedAt, int intervalDays, FlashcardPreset preset) =>
        _clock.DueAfterDays(reviewedAt, intervalDays, preset.DayStartHour);

    // Learning/Relearning step machine. Returns (nextState, nextStepIndex, due).
    private (FlashcardFsrsState, int, DateTimeOffset) StepThrough(
        FlashcardFsrsState state, int stepIndex, FlashcardReviewGrade grade, int[] steps,
        double stability, double retention, double[] weights, DateTimeOffset now, FlashcardPreset preset)
    {
        DateTimeOffset Graduate() => DayScaleDue(now, NextInterval(stability, retention, weights), preset);

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
            default: // Good: advance a step, graduating past the last
            {
                var next = stepIndex + 1;
                if (next >= steps.Length)
                    return (FlashcardFsrsState.Review, 0, Graduate());
                return (state, next, now.AddMinutes(steps[next]));
            }
        }
    }

    /// <summary>
    /// Accepts Mnemo's 21-slot FSRS-6 vector, or the 19-slot vector the FSRS-5 optimizer emits.
    /// Padding the latter is exact rather than approximate: no short-term damping and a decay of 0.5
    /// are precisely what FSRS-5 pinned. Any other length is a mistake (a truncated paste, or a
    /// vector from a different algorithm), and quietly scheduling every future review on substituted
    /// weights would bury it, so it throws instead.
    /// </summary>
    private static double[] ResolveWeights(FlashcardPreset preset)
    {
        if (preset.Weights is not { } w)
            return FlashcardFsrsParameters.Default.Weights;

        double[] resolved;
        switch (w.Count)
        {
            case WeightCount:
                resolved = w.ToArray();
                break;

            case Fsrs5WeightCount:
                resolved = new double[WeightCount];
                for (var i = 0; i < Fsrs5WeightCount; i++)
                    resolved[i] = w[i];
                resolved[19] = Fsrs5ShortTermDamping;
                resolved[20] = Fsrs5Decay;
                break;

            default:
                throw new ArgumentException(
                    $"FSRS weights must hold {Fsrs5WeightCount} or {WeightCount} values, but the preset has {w.Count}.",
                    nameof(preset));
        }

        // Decay is a divisor, so a zero here takes the whole forgetting curve to infinity. The trainer
        // is held to this same range, which makes anything outside it a bad paste rather than a taste.
        resolved[20] = Clamp(resolved[20], MinDecay, MaxDecay);
        return resolved;
    }

    private static int[] Steps(IReadOnlyList<int> steps) =>
        steps is null ? Array.Empty<int>() : steps.Where(s => s > 0).ToArray();

    /// <inheritdoc />
    public double ElapsedDays(FlashcardSchedule current, DateTimeOffset now) =>
        Math.Max(0d, (now - (current.LastReviewedAt ?? current.DueDate)).TotalDays);

    // --- FSRS-6 core ---

    /// <summary>FSRS-6 fits the forgetting curve's decay rather than pinning it; it is -w20.</summary>
    private static double Decay(double[] weights) => -weights[20];

    /// <summary>FACTOR = 0.9^(1/DECAY) - 1, the constant that puts R = 0.9 exactly at t = S.</summary>
    private static double Factor(double[] weights) => Math.Pow(0.9d, 1d / Decay(weights)) - 1d;

    private static int NextInterval(double stability, double desiredRetention, double[] weights)
    {
        var interval = stability / Factor(weights) * (Math.Pow(desiredRetention, 1d / Decay(weights)) - 1d);

        // Clamped before the cast, not after: at a low retention target the raw interval can run far
        // past int range, where the conversion is undefined rather than merely large.
        return (int)Clamp(Math.Round(interval, MidpointRounding.AwayFromZero), 1d, MaxInterval);
    }

    private static double Forgetting(double elapsedDays, double stability, double[] weights) =>
        Math.Pow(1d + Factor(weights) * elapsedDays / Math.Max(MinStability, stability), Decay(weights));

    private static double InitialStability(FlashcardReviewGrade grade, double[] weights) =>
        Math.Max(weights[(int)grade - 1], MinStability);

    /// <summary>D_0(G) = w4 - e^(w5 * (G-1)) + 1. Clamped for a card's starting difficulty.</summary>
    private static double InitialDifficulty(FlashcardReviewGrade grade, double[] weights) =>
        Clamp(RawInitialDifficulty(grade, weights), 1d, 10d);

    /// <summary>
    /// The same curve without the clamp. Mean reversion pulls toward the unclamped D_0(Easy), which
    /// under the FSRS-6 defaults is negative. Clamping it here would move the target by nearly six
    /// difficulty points and flatten the spread the model is trying to produce.
    /// </summary>
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

        // A same-day answer that was recalled at all must not shrink stability; only Again may.
        // The reference implementations split here: py-fsrs floors Good and Easy only, while
        // ts-fsrs, go-fsrs and the fsrs-rs engine Anki ships all floor from Hard up. Following the
        // latter, both because it is the majority and because Hard is a pass, not a lapse.
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

        // Without this ceiling the term above overtakes the stability the card already had, so a
        // card forgotten after a long absence comes back scheduled further out than if it had never
        // lapsed. It bites hardest on weak cards: at a stability of one day, a month away is enough.
        var cap = stability / Math.Exp(weights[17] * weights[18]);
        return Math.Max(Math.Min(updated, cap), MinStability);
    }

    private static double Clamp(double value, double min, double max) => Math.Min(max, Math.Max(min, value));
}
