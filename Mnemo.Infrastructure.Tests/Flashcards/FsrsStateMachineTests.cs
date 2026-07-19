using System;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// The learning/relearning step walk is Mnemo's own policy layered on FSRS, so
/// <see cref="FsrsSpecConformanceTests"/> says nothing about it. These lock in the transitions a
/// reader actually feels - which step a grade lands on, and when the card comes back.
/// </summary>
public sealed class FsrsStateMachineTests
{
    private static readonly FlashcardPreset Preset = FlashcardPreset.CreateStandard(DateTimeOffset.UtcNow);
    private readonly FsrsScheduler _scheduler = new();

    private static int DueInMinutes(FlashcardSchedule s, DateTimeOffset now) =>
        (int)Math.Round((s.DueDate - now).TotalMinutes);

    private static FlashcardSchedule Learning(int stepIndex, DateTimeOffset now) =>
        new("c", now, 3.0d, 5.0d, 2, 0, FlashcardFsrsState.Learning, stepIndex, now.AddMinutes(-10));

    [Fact]
    public void Hard_RepeatsTheCurrentLearningStep()
    {
        var now = DateTimeOffset.UtcNow;
        // Standard steps are 1m then 10m; sitting on the second one.
        var next = _scheduler.ApplyGrade(Learning(1, now), FlashcardReviewGrade.Hard, now, Preset);

        Assert.Equal(FlashcardFsrsState.Learning, next.FsrsState);
        Assert.Equal(1, next.LearningStepIndex);
        Assert.Equal(10, DueInMinutes(next, now));
    }

    [Fact]
    public void Again_ResetsToTheFirstLearningStep()
    {
        var now = DateTimeOffset.UtcNow;
        var next = _scheduler.ApplyGrade(Learning(1, now), FlashcardReviewGrade.Again, now, Preset);

        Assert.Equal(FlashcardFsrsState.Learning, next.FsrsState);
        Assert.Equal(0, next.LearningStepIndex);
        Assert.Equal(1, DueInMinutes(next, now));
    }

    [Fact]
    public void Easy_GraduatesFromAnyLearningStep()
    {
        var now = DateTimeOffset.UtcNow;
        var next = _scheduler.ApplyGrade(Learning(0, now), FlashcardReviewGrade.Easy, now, Preset);

        Assert.Equal(FlashcardFsrsState.Review, next.FsrsState);
        Assert.Equal(0, next.LearningStepIndex);
        Assert.True((next.DueDate - now).TotalDays >= 1d);
    }

    [Fact]
    public void Relearning_GraduatesBackToReview_OnGood()
    {
        var now = DateTimeOffset.UtcNow;
        // Standard relearn steps are a single 10m step, so Good graduates straight out.
        var relearning = new FlashcardSchedule("c", now, 4.0d, 6.0d, 9, 1,
            FlashcardFsrsState.Relearning, 0, now.AddMinutes(-10));

        var next = _scheduler.ApplyGrade(relearning, FlashcardReviewGrade.Good, now, Preset);

        Assert.Equal(FlashcardFsrsState.Review, next.FsrsState);
        Assert.True((next.DueDate - now).TotalDays >= 1d);
        Assert.Equal(1, next.Lapses); // graduating does not add a lapse
    }

    [Fact]
    public void Relearning_Again_StaysInRelearning_WithoutCountingAnotherLapse()
    {
        var now = DateTimeOffset.UtcNow;
        var relearning = new FlashcardSchedule("c", now, 4.0d, 6.0d, 9, 1,
            FlashcardFsrsState.Relearning, 0, now.AddMinutes(-10));

        var next = _scheduler.ApplyGrade(relearning, FlashcardReviewGrade.Again, now, Preset);

        Assert.Equal(FlashcardFsrsState.Relearning, next.FsrsState);
        Assert.Equal(1, next.Lapses); // only the lapse out of Review counts
        Assert.Equal(10, DueInMinutes(next, now));
    }

    [Fact]
    public void LapseFromReview_IsTheOnlyThingThatIncrementsLapses()
    {
        var now = DateTimeOffset.UtcNow;
        var review = new FlashcardSchedule("c", now.AddDays(-1), 10d, 5d, 4, 3,
            FlashcardFsrsState.Review, 0, now.AddDays(-8));

        var lapsed = _scheduler.ApplyGrade(review, FlashcardReviewGrade.Again, now, Preset);
        Assert.Equal(4, lapsed.Lapses);

        var recalled = _scheduler.ApplyGrade(review, FlashcardReviewGrade.Good, now, Preset);
        Assert.Equal(3, recalled.Lapses);
    }

    [Fact]
    public void EveryGrade_IncrementsReps()
    {
        var now = DateTimeOffset.UtcNow;
        var schedule = FlashcardSchedule.NewFor("c", now);

        foreach (var grade in new[]
                 {
                     FlashcardReviewGrade.Good, FlashcardReviewGrade.Hard,
                     FlashcardReviewGrade.Again, FlashcardReviewGrade.Easy,
                 })
        {
            var before = schedule.Reps;
            schedule = _scheduler.ApplyGrade(schedule, grade, now, Preset);
            Assert.Equal(before + 1, schedule.Reps);
        }
    }

    [Fact]
    public void CustomLearningSteps_AreWalkedInOrder()
    {
        var now = DateTimeOffset.UtcNow;
        var preset = Preset with { LearningSteps = new[] { 5, 25, 120 } };

        var s0 = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Good, now, preset);
        Assert.Equal(5, DueInMinutes(s0, now));

        var s1 = _scheduler.ApplyGrade(s0, FlashcardReviewGrade.Good, now, preset);
        Assert.Equal(25, DueInMinutes(s1, now));

        var s2 = _scheduler.ApplyGrade(s1, FlashcardReviewGrade.Good, now, preset);
        Assert.Equal(120, DueInMinutes(s2, now));

        var graduated = _scheduler.ApplyGrade(s2, FlashcardReviewGrade.Good, now, preset);
        Assert.Equal(FlashcardFsrsState.Review, graduated.FsrsState);
    }

    [Fact]
    public void NoLearningSteps_SendsNewCardsStraightToReview()
    {
        var now = DateTimeOffset.UtcNow;
        var preset = Preset with { LearningSteps = Array.Empty<int>() };

        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Good, now, preset);

        Assert.Equal(FlashcardFsrsState.Review, next.FsrsState);
        Assert.True((next.DueDate - now).TotalDays >= 1d);
    }

    [Fact]
    public void NonPositiveSteps_AreDiscarded()
    {
        var now = DateTimeOffset.UtcNow;
        var preset = Preset with { LearningSteps = new[] { 0, -5, 15 } };

        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Good, now, preset);

        Assert.Equal(FlashcardFsrsState.Learning, next.FsrsState);
        Assert.Equal(15, DueInMinutes(next, now));
    }

    [Fact]
    public void ShorteningThePresetUnderACard_ClampsInsteadOfThrowing()
    {
        // Editing a preset re-schedules every deck bound to it, so a card can be sitting on a step
        // index the shortened list no longer has.
        var now = DateTimeOffset.UtcNow;
        var shortened = Preset with { LearningSteps = new[] { 7 } };

        var hard = _scheduler.ApplyGrade(Learning(4, now), FlashcardReviewGrade.Hard, now, shortened);
        Assert.Equal(FlashcardFsrsState.Learning, hard.FsrsState);
        Assert.Equal(0, hard.LearningStepIndex);
        Assert.Equal(7, DueInMinutes(hard, now));

        var good = _scheduler.ApplyGrade(Learning(4, now), FlashcardReviewGrade.Good, now, shortened);
        Assert.Equal(FlashcardFsrsState.Review, good.FsrsState);
    }

    [Theory]
    // The four strings a reader sees under the grade buttons. Asserted exactly, because the
    // existing coverage only checks the trailing unit - "1d" and "400d" both end in "d".
    [InlineData(FlashcardReviewGrade.Again, "1m")]
    [InlineData(FlashcardReviewGrade.Hard, "1m")]
    [InlineData(FlashcardReviewGrade.Good, "1m")]
    [InlineData(FlashcardReviewGrade.Easy, "8d")]
    public void DescribeInterval_NewCard_ProducesExactPreviews(FlashcardReviewGrade grade, string expected)
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(expected, _scheduler.DescribeInterval(FlashcardSchedule.NewFor("c", now), grade, now, Preset));
    }

    [Theory]
    [InlineData(FlashcardReviewGrade.Again, "10m")]
    [InlineData(FlashcardReviewGrade.Hard, "21d")]
    [InlineData(FlashcardReviewGrade.Good, "29d")]
    [InlineData(FlashcardReviewGrade.Easy, "45d")]
    public void DescribeInterval_ReviewCard_ProducesExactPreviews(FlashcardReviewGrade grade, string expected)
    {
        var now = DateTimeOffset.UtcNow;
        var review = new FlashcardSchedule("c", now.AddDays(-8), 10d, 5d, 5, 0,
            FlashcardFsrsState.Review, 0, now.AddDays(-8));

        Assert.Equal(expected, _scheduler.DescribeInterval(review, grade, now, Preset));
    }

    [Fact]
    public void GradingStampsLastReviewedAt()
    {
        var now = DateTimeOffset.UtcNow;
        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Good, now, Preset);

        Assert.Equal(now, next.LastReviewedAt);
    }

    [Fact]
    public void DifficultyStaysWithinBounds_UnderRepeatedExtremeGrades()
    {
        var now = DateTimeOffset.UtcNow;

        var easy = FlashcardSchedule.NewFor("c", now);
        for (var i = 0; i < 50; i++)
            easy = _scheduler.ApplyGrade(easy, FlashcardReviewGrade.Easy, now.AddDays(i), Preset);
        Assert.InRange(easy.Difficulty!.Value, 1d, 10d);

        var again = FlashcardSchedule.NewFor("c", now);
        for (var i = 0; i < 50; i++)
            again = _scheduler.ApplyGrade(again, FlashcardReviewGrade.Again, now.AddDays(i), Preset);
        Assert.InRange(again.Difficulty!.Value, 1d, 10d);
        Assert.True(again.Stability!.Value >= 0.001d);
    }
}
