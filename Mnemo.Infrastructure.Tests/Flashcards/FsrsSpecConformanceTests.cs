using System;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Checks <see cref="FsrsScheduler"/> against <see cref="FsrsReferenceOracle"/>, an independently
/// written FSRS-5. These are the tests with teeth: they fail if the scheduler drifts away from the
/// published algorithm, which a self-referential golden-vector test cannot detect.
///
/// Both UIs (the Avalonia reference app and the ported Host) resolve the same
/// <c>IFsrsScheduler</c> out of shared Infrastructure, so conformance proven here holds for both.
/// </summary>
public sealed class FsrsSpecConformanceTests
{
    private static readonly FlashcardPreset Preset = FlashcardPreset.CreateStandard(DateTimeOffset.UtcNow);
    private static readonly double[] W = FsrsReferenceOracle.DefaultWeights;
    private const int Precision = 9;

    private readonly FsrsScheduler _scheduler = new();

    private static FlashcardSchedule ReviewCard(double stability, double difficulty, double elapsedDays, DateTimeOffset now) =>
        new("c", now.AddDays(-elapsedDays), stability, difficulty, 5, 0,
            FlashcardFsrsState.Review, 0, now.AddDays(-elapsedDays));

    [Fact]
    public void DecayAndFactor_MatchFsrs5Constants()
    {
        // FSRS-5 pins DECAY at -0.5, which makes FACTOR exactly 19/81.
        Assert.Equal(-0.5d, FsrsReferenceOracle.Decay(W), Precision);
        Assert.Equal(19d / 81d, FsrsReferenceOracle.Factor(W), Precision);
    }

    [Theory]
    [InlineData(FlashcardReviewGrade.Again)]
    [InlineData(FlashcardReviewGrade.Hard)]
    [InlineData(FlashcardReviewGrade.Good)]
    [InlineData(FlashcardReviewGrade.Easy)]
    public void NewCard_UsesSpecInitialStabilityAndDifficulty(FlashcardReviewGrade grade)
    {
        var now = DateTimeOffset.UtcNow;
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
        var now = DateTimeOffset.UtcNow;
        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsedDays, now), grade, now, Preset);

        var r = FsrsReferenceOracle.Retrievability(elapsedDays, stability, W);
        var expectedStability = FsrsReferenceOracle.RecallStability(difficulty, stability, r, (int)grade, W);
        var expectedDifficulty = FsrsReferenceOracle.NextDifficulty(difficulty, (int)grade, W);
        var expectedInterval = FsrsReferenceOracle.NextInterval(expectedStability, Preset.DesiredRetention, W);

        Assert.Equal(FlashcardFsrsState.Review, next.FsrsState);
        Assert.Equal(expectedStability, next.Stability!.Value, Precision);
        Assert.Equal(expectedDifficulty, next.Difficulty!.Value, Precision);
        Assert.Equal(expectedInterval, (int)Math.Round((next.DueDate - now).TotalDays));
    }

    [Theory]
    [InlineData(10.0, 5.0, 8.0)]
    [InlineData(50.0, 9.0, 60.0)]
    [InlineData(5.0, 5.0, 60.0)]
    public void ReviewCard_Lapse_DifficultyMatchesSpec(double stability, double difficulty, double elapsedDays)
    {
        var now = DateTimeOffset.UtcNow;
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
        var now = DateTimeOffset.UtcNow;
        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsedDays, now), FlashcardReviewGrade.Again, now, Preset);

        var r = FsrsReferenceOracle.Retrievability(elapsedDays, stability, W);
        var expected = FsrsReferenceOracle.ForgetStability(difficulty, stability, r, W);

        Assert.Equal(expected, next.Stability!.Value, Precision);
    }

    [Theory]
    // Weak cards left overdue: without the ceiling these are the ones that overshoot.
    [InlineData(1.0, 5.0, 30.0)]
    [InlineData(0.5, 3.0, 10.0)]
    [InlineData(2.0, 5.0, 30.0)]
    public void ReviewCard_Lapse_HoldsTheCap_WhereTheRawTermWouldOvershoot(double stability, double difficulty, double elapsedDays)
    {
        var now = DateTimeOffset.UtcNow;
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
        var now = DateTimeOffset.UtcNow;
        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsedDays, now), FlashcardReviewGrade.Again, now, Preset);

        Assert.True(next.Stability!.Value < stability,
            $"lapse raised stability from {stability} to {next.Stability!.Value}");
    }

    [Theory]
    [InlineData(FlashcardReviewGrade.Hard)]
    [InlineData(FlashcardReviewGrade.Good)]
    public void LearningCard_SameDay_UsesSpecShortTermStability(FlashcardReviewGrade grade)
    {
        var now = DateTimeOffset.UtcNow;
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
        var now = DateTimeOffset.UtcNow;
        var preset = Preset with { DesiredRetention = retention };
        const double stability = 10.0d;
        const double difficulty = 5.0d;
        const double elapsed = 8.0d;

        var next = _scheduler.ApplyGrade(ReviewCard(stability, difficulty, elapsed, now), FlashcardReviewGrade.Good, now, preset);

        var r = FsrsReferenceOracle.Retrievability(elapsed, stability, W);
        var expectedStability = FsrsReferenceOracle.RecallStability(difficulty, stability, r, 3, W);
        var expectedInterval = FsrsReferenceOracle.NextInterval(expectedStability, retention, W);

        Assert.Equal(expectedInterval, (int)Math.Round((next.DueDate - now).TotalDays));
    }

    [Fact]
    public void DesiredRetention_IsClampedToTheSchedulerRange()
    {
        // The scheduler clamps to [0.70, 0.99] while the preset editor offers [0.80, 0.97]
        // (PresetEndpoints), so these bounds are only reachable by an imported or seeded preset.
        var now = DateTimeOffset.UtcNow;
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
    public void CustomWeights_AreHonouredOnlyAtTheExpectedLength()
    {
        var now = DateTimeOffset.UtcNow;
        var custom = (double[])W.Clone();
        custom[0] = 1.5d; // initial stability for Again

        var honoured = Preset with { Weights = custom };
        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Again, now, honoured);
        Assert.Equal(1.5d, next.Stability!.Value, Precision);

        // A 19-slot vector is the shape the upstream FSRS-5 optimizer emits; the scheduler requires 21
        // and silently falls back to defaults for anything else.
        var nineteen = new double[19];
        Array.Copy(W, nineteen, 19);
        nineteen[0] = 1.5d;
        var ignored = Preset with { Weights = nineteen };
        var fallback = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Again, now, ignored);
        Assert.Equal(W[0], fallback.Stability!.Value, Precision);
    }
}
