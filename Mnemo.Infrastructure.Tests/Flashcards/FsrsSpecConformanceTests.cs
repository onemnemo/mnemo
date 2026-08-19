using System;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Checks <see cref="FsrsScheduler"/> against <see cref="FsrsReferenceOracle"/>, an independently
/// written FSRS-6. These are the tests with teeth: they fail if the scheduler drifts away from the
/// published algorithm, which a self-referential golden-vector test cannot detect.
///
/// Both UIs (the Avalonia reference app and the ported Host) resolve the same
/// <c>IFsrsScheduler</c> out of shared Infrastructure, so conformance proven here holds for both.
/// </summary>
public sealed class FsrsSpecConformanceTests
{
    /// <summary>A fixed instant, so day snapping lands the same way on every machine and every run.</summary>
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    private static readonly FlashcardPreset Preset = FlashcardPreset.CreateStandard(Now);
    private static readonly double[] W = FsrsReferenceOracle.DefaultWeights;
    private static readonly FlashcardClock Clock = new(new TestTimeProvider(Now));
    private const int Precision = 9;

    private readonly FsrsScheduler _scheduler = new(Clock);

    /// <summary>
    /// The interval the scheduler chose, read back as a count of study days. Day-scale due dates are
    /// snapped to the start of a day, so elapsed time between the two instants is a partial day out
    /// and only the day count recovers the number the scheduler actually picked.
    /// </summary>
    private static int Days(DateTimeOffset from, DateTimeOffset to) =>
        Clock.DaysBetween(from, to, Preset.DayStartHour);

    private static FlashcardSchedule ReviewCard(double stability, double difficulty, double elapsedDays, DateTimeOffset now) =>
        new("c", now.AddDays(-elapsedDays), stability, difficulty, 5, 0,
            FlashcardFsrsState.Review, 0, now.AddDays(-elapsedDays));

    [Fact]
    public void Decay_IsTakenFromTheWeightVector()
    {
        // FSRS-6 fits decay per collection as -w20, where FSRS-5 pinned it at -0.5.
        Assert.Equal(-W[20], FsrsReferenceOracle.Decay(W), Precision);
        Assert.Equal(Math.Pow(0.9d, 1d / -W[20]) - 1d, FsrsReferenceOracle.Factor(W), Precision);
    }

    [Fact]
    public void Decay_AtTheFsrs5Value_ReproducesFsrs5Constants()
    {
        // w20 = 0.5 is exactly FSRS-5's pinned decay, which makes FACTOR 19/81.
        var w = FsrsReferenceOracle.Fsrs5Defaults;
        Assert.Equal(-0.5d, FsrsReferenceOracle.Decay(w), Precision);
        Assert.Equal(19d / 81d, FsrsReferenceOracle.Factor(w), Precision);
    }

    [Fact]
    public void DesiredRetentionOfNinePercent_PutsTheIntervalAtStability()
    {
        // FACTOR is defined so that R = 0.9 lands exactly at t = S, whatever decay is in force.
        foreach (var w in new[] { W, FsrsReferenceOracle.Fsrs5Defaults })
            Assert.Equal(10, FsrsReferenceOracle.NextInterval(10d, 0.9d, w));
    }

    [Fact]
    public void MeanReversion_TargetsTheUnclampedInitialDifficulty()
    {
        // Under the FSRS-6 defaults D_0(Easy) is about -4.77, so clamping the target to 1 would shift
        // it by nearly six points. The shipped w7 is small enough that the difference is slight, but
        // the optimizer is free to fit w7 up to 0.75, where the same error would be large.
        var target = FsrsReferenceOracle.RawInitialDifficulty(4, W);
        Assert.True(target < 1d, $"expected the FSRS-6 default D_0(Easy) to sit below the clamp, got {target}");

        var now = Now;
        var next = _scheduler.ApplyGrade(ReviewCard(10d, 5d, 8d, now), FlashcardReviewGrade.Hard, now, Preset);

        var damped = 5d + W[6] * (10d - 5d) / 9d; // delta = -w6 * (2 - 3) = +w6
        var expected = W[7] * target + (1d - W[7]) * damped;
        Assert.Equal(expected, next.Difficulty!.Value, Precision);
    }

    [Fact]
    public void MeanReversion_WithALargeW7_DivergesFromTheClampedTarget()
    {
        // Proves the unclamped target is load-bearing rather than a rounding detail: at a w7 the
        // optimizer could legitimately produce, clamping would land somewhere visibly different.
        var w = (double[])W.Clone();
        w[7] = 0.5d;

        var unclamped = FsrsReferenceOracle.NextDifficulty(5d, 3, w);
        var clampedTarget = Math.Min(Math.Max(FsrsReferenceOracle.RawInitialDifficulty(4, w), 1d), 10d);
        var wrong = w[7] * clampedTarget + (1d - w[7]) * 5d;

        Assert.True(Math.Abs(unclamped - wrong) > 1d,
            $"expected a material gap between the unclamped and clamped targets, got {unclamped} and {wrong}");

        var now = Now;
        var next = _scheduler.ApplyGrade(ReviewCard(10d, 5d, 8d, now), FlashcardReviewGrade.Good, now, Preset with { Weights = w });
        Assert.Equal(unclamped, next.Difficulty!.Value, Precision);
    }

    [Theory]
    // Each grade needs enough stability for the w19 damping to push the raw multiplier under 1,
    // which is where the floor bites. That threshold rises steeply with the grade.
    [InlineData(FlashcardReviewGrade.Hard, 1d)]
    [InlineData(FlashcardReviewGrade.Good, 100d)]
    [InlineData(FlashcardReviewGrade.Easy, 20000d)]
    public void ShortTermStability_NeverShrinksOnAPassingGrade(FlashcardReviewGrade grade, double stability)
    {
        var now = Now;
        var learning = new FlashcardSchedule("c", now, stability, 5d, 1, 0, FlashcardFsrsState.Learning, 0, now.AddHours(-2));

        var raw = Math.Exp(W[17] * ((int)grade - 3 + W[18])) * Math.Pow(stability, -W[19]);
        Assert.True(raw < 1d, $"expected this row to exercise the floor, raw multiplier was {raw}");

        var next = _scheduler.ApplyGrade(learning, grade, now, Preset);
        Assert.Equal(stability, next.Stability!.Value, Precision);
    }

    [Fact]
    public void ShortTermStability_StillShrinksOnAgain()
    {
        // Again is the one same-day grade the floor does not cover.
        const double stability = 100d;
        var now = Now;
        var learning = new FlashcardSchedule("c", now, stability, 5d, 1, 0, FlashcardFsrsState.Learning, 0, now.AddHours(-2));

        var next = _scheduler.ApplyGrade(learning, FlashcardReviewGrade.Again, now, Preset);
        Assert.True(next.Stability!.Value < stability,
            $"expected a same-day Again to lose stability, got {next.Stability!.Value}");
    }

    [Theory]
    [InlineData(FlashcardReviewGrade.Hard)]
    [InlineData(FlashcardReviewGrade.Good)]
    [InlineData(FlashcardReviewGrade.Easy)]
    public void ReviewCard_ReReviewedSameDay_UsesShortTermStability(FlashcardReviewGrade grade)
    {
        // The short-term regime is about elapsed time, not card state, so a Review card graded again
        // the same day takes the same path a Learning card would.
        const double stability = 20d;
        var now = Now;
        var card = new FlashcardSchedule("c", now, stability, 5d, 5, 0, FlashcardFsrsState.Review, 0, now.AddHours(-3));

        var next = _scheduler.ApplyGrade(card, grade, now, Preset);

        Assert.Equal(FsrsReferenceOracle.ShortTermStability(stability, (int)grade, W), next.Stability!.Value, Precision);
    }

    [Fact]
    public void ReviewCard_LapsedSameDay_UsesShortTermStabilityAndStillCountsTheLapse()
    {
        const double stability = 20d;
        var now = Now;
        var card = new FlashcardSchedule("c", now, stability, 5d, 5, 0, FlashcardFsrsState.Review, 0, now.AddHours(-3));

        var next = _scheduler.ApplyGrade(card, FlashcardReviewGrade.Again, now, Preset);

        Assert.Equal(FsrsReferenceOracle.ShortTermStability(stability, 1, W), next.Stability!.Value, Precision);
        Assert.Equal(FlashcardFsrsState.Relearning, next.FsrsState);
        Assert.Equal(1, next.Lapses);
    }

    [Fact]
    public void NextInterval_IsClampedToTheReferenceMaximum()
    {
        // A very mature card at the lowest allowed retention is where the raw interval runs away.
        var now = Now;
        var card = ReviewCard(30000d, 1d, 1d, now);

        var next = _scheduler.ApplyGrade(card, FlashcardReviewGrade.Easy, now, Preset with { DesiredRetention = 0.70d });

        Assert.InRange(Days(now, next.DueDate), 1, 36500);
        Assert.InRange(next.Stability!.Value, 0.001d, 36500d);
    }

    [Fact]
    public void ShortTermStability_AppliesTheW19Damping()
    {
        // w19 shrinks the relative move as stability grows, so the multiplier must fall with S.
        // Again, because the passing-grade floor pins every other multiplier at 1 and hides it.
        var low = FsrsReferenceOracle.ShortTermStability(1d, 1, W) / 1d;
        var high = FsrsReferenceOracle.ShortTermStability(100d, 1, W) / 100d;
        Assert.True(high < low, $"expected w19 to damp the multiplier as stability grows, got {low} then {high}");

        // Zeroing w19 is what FSRS-5 did, and removes the damping entirely.
        var w = (double[])W.Clone();
        w[19] = 0d;
        Assert.Equal(
            FsrsReferenceOracle.ShortTermStability(1d, 1, w) / 1d,
            FsrsReferenceOracle.ShortTermStability(100d, 1, w) / 100d,
            Precision);
    }

    [Theory]
    [InlineData(FlashcardReviewGrade.Again)]
    [InlineData(FlashcardReviewGrade.Hard)]
    [InlineData(FlashcardReviewGrade.Good)]
    [InlineData(FlashcardReviewGrade.Easy)]
    public void NewCard_UsesSpecInitialStabilityAndDifficulty(FlashcardReviewGrade grade)
    {
        var now = Now;
        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), grade, now, Preset);

        Assert.Equal(FsrsReferenceOracle.InitialStability((int)grade, W), next.Stability!.Value, Precision);
        Assert.Equal(FsrsReferenceOracle.InitialDifficulty((int)grade, W), next.Difficulty!.Value, Precision);
    }

    [Theory]
    [InlineData(FlashcardReviewGrade.Hard, 10.0, 5.0, 8.0)]
    [InlineData(FlashcardReviewGrade.Good, 10.0, 5.0, 8.0)]
    [InlineData(FlashcardReviewGrade.Easy, 10.0, 5.0, 8.0)]
    [InlineData(FlashcardReviewGrade.Good, 1.0, 2.0, 1.0)]
    [InlineData(FlashcardReviewGrade.Good, 50.0, 9.0, 60.0)]
    [InlineData(FlashcardReviewGrade.Hard, 3.5, 7.25, 20.0)]
    [InlineData(FlashcardReviewGrade.Easy, 0.5, 1.0, 30.0)]
    [InlineData(FlashcardReviewGrade.Good, 200.0, 4.0, 150.0)]
    public void ReviewCard_SuccessfulRecall_MatchesSpec(
        FlashcardReviewGrade grade, double stability, double difficulty, double elapsedDays)
    {
        var now = Now;
        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsedDays, now), grade, now, Preset);

        var r = FsrsReferenceOracle.Retrievability(elapsedDays, stability, W);
        var expectedStability = FsrsReferenceOracle.RecallStability(difficulty, stability, r, (int)grade, W);
        var expectedDifficulty = FsrsReferenceOracle.NextDifficulty(difficulty, (int)grade, W);
        var expectedInterval = FsrsReferenceOracle.NextInterval(expectedStability, Preset.DesiredRetention, W);

        Assert.Equal(FlashcardFsrsState.Review, next.FsrsState);
        Assert.Equal(expectedStability, next.Stability!.Value, Precision);
        Assert.Equal(expectedDifficulty, next.Difficulty!.Value, Precision);
        Assert.Equal(expectedInterval, Days(now, next.DueDate));
    }

    [Theory]
    [InlineData(10.0, 5.0, 8.0)]
    [InlineData(50.0, 9.0, 60.0)]
    [InlineData(5.0, 5.0, 60.0)]
    public void ReviewCard_Lapse_DifficultyMatchesSpec(double stability, double difficulty, double elapsedDays)
    {
        var now = Now;
        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsedDays, now), FlashcardReviewGrade.Again, now, Preset);

        Assert.Equal(FlashcardFsrsState.Relearning, next.FsrsState);
        Assert.Equal(FsrsReferenceOracle.NextDifficulty(difficulty, 1, W), next.Difficulty!.Value, Precision);
        Assert.Equal(1, next.Lapses);
    }

    [Theory]
    // Rows above the ceiling and below it, so both branches of the cap are exercised.
    [InlineData(5.0, 5.0, 60.0)]
    [InlineData(10.0, 5.0, 180.0)]
    [InlineData(30.0, 5.0, 365.0)]
    [InlineData(1.0, 5.0, 30.0)]
    [InlineData(0.5, 3.0, 10.0)]
    [InlineData(2.0, 5.0, 30.0)]
    public void ReviewCard_Lapse_StabilityMatchesSpec(double stability, double difficulty, double elapsedDays)
    {
        var now = Now;
        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsedDays, now), FlashcardReviewGrade.Again, now, Preset);

        var r = FsrsReferenceOracle.Retrievability(elapsedDays, stability, W);
        var expected = FsrsReferenceOracle.ForgetStability(difficulty, stability, r, W);

        Assert.Equal(expected, next.Stability!.Value, Precision);
    }

    [Theory]
    // Very weak cards left long overdue. FSRS-6's lapse weights are small enough that this is the
    // only regime where the raw term still overshoots, so the rows sit further out than FSRS-5's did.
    [InlineData(0.1, 1.0, 120.0)]
    [InlineData(0.1, 1.0, 365.0)]
    [InlineData(0.2, 2.0, 365.0)]
    [InlineData(0.05, 1.0, 60.0)]
    [InlineData(0.1, 3.0, 730.0)]
    public void ReviewCard_Lapse_HoldsTheCap_WhereTheRawTermWouldOvershoot(double stability, double difficulty, double elapsedDays)
    {
        var now = Now;
        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsedDays, now), FlashcardReviewGrade.Again, now, Preset);

        var r = FsrsReferenceOracle.Retrievability(elapsedDays, stability, W);
        var cap = FsrsReferenceOracle.PostLapseCap(stability, W);

        // Guards the rows themselves: if these ever stop exercising the cap, the assertion below
        // would pass for the wrong reason.
        Assert.True(FsrsReferenceOracle.ForgetStabilityUncapped(difficulty, stability, r, W) > cap,
            "expected this row to exercise the cap regime");
        Assert.Equal(cap, next.Stability!.Value, Precision);
    }

    [Theory]
    [InlineData(0.5, 3.0, 10.0)]
    [InlineData(1.0, 5.0, 30.0)]
    [InlineData(2.0, 5.0, 30.0)]
    [InlineData(10.0, 5.0, 180.0)]
    [InlineData(30.0, 5.0, 365.0)]
    public void ReviewCard_Lapse_NeverRaisesStabilityAboveItsPreLapseValue(double stability, double difficulty, double elapsedDays)
    {
        // Forgetting a card must not leave it more durable than it was before the lapse.
        var now = Now;
        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsedDays, now), FlashcardReviewGrade.Again, now, Preset);

        Assert.True(next.Stability!.Value < stability,
            $"lapse raised stability from {stability} to {next.Stability!.Value}");
    }

    [Theory]
    [InlineData(FlashcardReviewGrade.Hard)]
    [InlineData(FlashcardReviewGrade.Good)]
    public void LearningCard_SameDay_UsesSpecShortTermStability(FlashcardReviewGrade grade)
    {
        var now = Now;
        // Learning state with elapsed < 1 day is the short-term regime.
        var learning = new FlashcardSchedule("c", now, 3.0d, 5.0d, 1, 0, FlashcardFsrsState.Learning, 0, now.AddHours(-2));

        var next = _scheduler.ApplyGrade(learning, grade, now, Preset);

        Assert.Equal(FsrsReferenceOracle.ShortTermStability(3.0d, (int)grade, W), next.Stability!.Value, Precision);
    }

    [Theory]
    [InlineData(0.9)]
    [InlineData(0.8)]
    [InlineData(0.95)]
    public void DesiredRetention_DrivesIntervalPerSpec(double retention)
    {
        var now = Now;
        var preset = Preset with { DesiredRetention = retention };
        const double stability = 10.0d;
        const double difficulty = 5.0d;
        const double elapsed = 8.0d;

        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsed, now), FlashcardReviewGrade.Good, now, preset);

        var r = FsrsReferenceOracle.Retrievability(elapsed, stability, W);
        var expectedStability = FsrsReferenceOracle.RecallStability(difficulty, stability, r, 3, W);
        var expectedInterval = FsrsReferenceOracle.NextInterval(expectedStability, retention, W);

        Assert.Equal(expectedInterval, Days(now, next.DueDate));
    }

    [Fact]
    public void DesiredRetention_IsClampedToTheSchedulerRange()
    {
        // The scheduler clamps to [0.70, 0.99] while the preset editor offers [0.80, 0.97]
        // (PresetEndpoints), so these bounds are only reachable by an imported or seeded preset.
        var now = Now;
        var card = ReviewCard(10d, 5d, 8d, now);

        var belowFloor = _scheduler.ApplyGrade(card, FlashcardReviewGrade.Good, now, Preset with { DesiredRetention = 0.1d });
        var atFloor = _scheduler.ApplyGrade(card, FlashcardReviewGrade.Good, now, Preset with { DesiredRetention = 0.70d });
        Assert.Equal(atFloor.DueDate, belowFloor.DueDate);

        var aboveCeiling = _scheduler.ApplyGrade(card, FlashcardReviewGrade.Good, now, Preset with { DesiredRetention = 1.5d });
        var atCeiling = _scheduler.ApplyGrade(card, FlashcardReviewGrade.Good, now, Preset with { DesiredRetention = 0.99d });
        Assert.Equal(atCeiling.DueDate, aboveCeiling.DueDate);

        // Higher retention must never mean a longer interval.
        Assert.True(atCeiling.DueDate < atFloor.DueDate);
    }

    [Fact]
    public void CustomWeights_AreHonouredAtTwentyOne()
    {
        var now = Now;
        var custom = (double[])W.Clone();
        custom[0] = 1.5d; // initial stability for Again

        var honoured = Preset with { Weights = custom };
        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Again, now, honoured);
        Assert.Equal(1.5d, next.Stability!.Value, Precision);
    }

    [Fact]
    public void CustomWeights_AreHonouredAtNineteen()
    {
        // 19 is what the FSRS-5 optimizer emits, so a user pasting one must not be ignored.
        var now = Now;
        var nineteen = new double[19];
        Array.Copy(FsrsReferenceOracle.Fsrs5Defaults, nineteen, 19);
        nineteen[0] = 1.5d;

        var preset = Preset with { Weights = nineteen };
        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Again, now, preset);
        Assert.Equal(1.5d, next.Stability!.Value, Precision);
    }

    [Fact]
    public void PaddedNineteen_SchedulesAsFsrs5()
    {
        // The padding has to be exact, not merely accepted: a 19-slot vector is an FSRS-5 one, and
        // w19 = 0 with w20 = 0.5 is precisely the FSRS-5 model expressed in FSRS-6's parameterisation.
        var now = Now;
        var fsrs5 = FsrsReferenceOracle.Fsrs5Defaults;
        var nineteen = new double[19];
        Array.Copy(fsrs5, nineteen, 19);
        var twentyOne = (double[])fsrs5.Clone();

        var card = ReviewCard(12d, 6d, 20d, now);

        foreach (var grade in new[] { FlashcardReviewGrade.Again, FlashcardReviewGrade.Hard, FlashcardReviewGrade.Good, FlashcardReviewGrade.Easy })
        {
            var padded = _scheduler.ApplyGrade(card, grade, now, Preset with { Weights = nineteen });
            var explicitly = _scheduler.ApplyGrade(card, grade, now, Preset with { Weights = twentyOne });
            Assert.Equal(explicitly.Stability!.Value, padded.Stability!.Value, Precision);
            Assert.Equal(explicitly.Difficulty!.Value, padded.Difficulty!.Value, Precision);
            Assert.Equal(explicitly.DueDate, padded.DueDate);
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(17)]
    [InlineData(18)]
    [InlineData(20)]
    [InlineData(22)]
    public void CustomWeights_OfAnyOtherLength_Throw(int count)
    {
        var now = Now;
        var preset = Preset with { Weights = new double[count] };
        Assert.Throws<ArgumentException>(() =>
            _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Good, now, preset));
    }

    [Fact]
    public void NullWeights_FallBackToDefaults()
    {
        var now = Now;
        var preset = Preset with { Weights = null };
        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Again, now, preset);
        Assert.Equal(W[0], next.Stability!.Value, Precision);
    }
}
