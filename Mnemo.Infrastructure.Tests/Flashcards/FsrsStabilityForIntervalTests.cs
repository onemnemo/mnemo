using System;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Rewriting a card's spacing without grading it needs the scheduler's interval formula run
/// backwards: the stability at which retrievability sinks to the preset's target exactly the
/// asked number of days out.
/// </summary>
public sealed class FsrsStabilityForIntervalTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);
    private static readonly FlashcardPreset Standard = FlashcardPreset.CreateStandard(Now);
    private readonly FsrsScheduler _scheduler = new(new FlashcardClock(new TestTimeProvider(Now)));

    [Theory]
    [InlineData(1d)]
    [InlineData(7d)]
    [InlineData(30d)]
    [InlineData(365d)]
    public void At_ninety_percent_retention_the_stability_is_the_interval(double days)
    {
        // FSRS defines stability as the interval at which R = 0.9, so the standard preset's target
        // makes the inverse the identity.
        Assert.Equal(days, _scheduler.StabilityForInterval(days, Standard), precision: 9);
    }

    [Theory]
    [InlineData(0.80d, 10d)]
    [InlineData(0.85d, 45d)]
    [InlineData(0.95d, 3d)]
    [InlineData(0.97d, 120d)]
    public void Retrievability_at_the_interval_is_the_desired_retention(double retention, double days)
    {
        var preset = Standard with { DesiredRetention = retention };
        var stability = _scheduler.StabilityForInterval(days, preset);

        Assert.Equal(retention, Retrievability(days, stability, preset), precision: 9);
    }

    [Fact]
    public void The_stability_stays_inside_the_scheduler_range()
    {
        Assert.Equal(0.001d, _scheduler.StabilityForInterval(0d, Standard), precision: 9);
        Assert.Equal(36500d, _scheduler.StabilityForInterval(1_000_000d, Standard), precision: 9);
    }

    [Fact]
    public void A_review_answered_at_the_rewritten_interval_is_graded_on_the_curve_it_was_given()
    {
        // A card whose spacing was rewritten to a week, answered Good a week later, must be
        // scheduled as a card that sat at R = 0.9, which is further out than a week.
        var stability = _scheduler.StabilityForInterval(7d, Standard);
        var reviewedAt = Now.AddDays(7);
        var card = new FlashcardSchedule("c", reviewedAt, stability, 5d, 3, 0, FlashcardFsrsState.Review, 0, Now);

        var next = _scheduler.ApplyGrade(card, FlashcardReviewGrade.Good, reviewedAt, Standard);

        Assert.True(next.Stability > stability);
        Assert.True((next.DueDate - reviewedAt).TotalDays > 7d);
    }

    /// <summary>The FSRS-6 forgetting curve, written out so the test does not trust the code under test for it.</summary>
    private static double Retrievability(double elapsedDays, double stability, FlashcardPreset preset)
    {
        var weights = FsrsWeightRules.Resolve(preset);
        var decay = -weights[20];
        var factor = Math.Pow(0.9d, 1d / decay) - 1d;
        return Math.Pow(1d + factor * elapsedDays / stability, decay);
    }
}
