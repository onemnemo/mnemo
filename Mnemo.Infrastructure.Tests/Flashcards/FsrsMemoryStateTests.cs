using System;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

public sealed class FsrsMemoryStateTests
{
    private static readonly double[] Weights = FsrsWeightRules.Defaults();

    [Fact]
    public void Replay_uses_the_gaps_between_answer_times()
    {
        var start = new DateTimeOffset(2026, 1, 1, 8, 0, 0, TimeSpan.Zero);
        var answers = new[]
        {
            Answer(start, FlashcardReviewGrade.Good),
            Answer(start.AddDays(10), FlashcardReviewGrade.Good),
            Answer(start.AddDays(17), FlashcardReviewGrade.Good),
        };

        var expected = FsrsForwardModel.First(FlashcardReviewGrade.Good, Weights);
        expected = FsrsForwardModel.Next(expected, 10d, FlashcardReviewGrade.Good, Weights);
        expected = FsrsForwardModel.Next(expected, 7d, FlashcardReviewGrade.Good, Weights);

        var actual = FsrsMemoryReplay.Replay(answers, Weights);

        Assert.NotNull(actual);
        Assert.Equal(expected.Stability, actual.Value.Stability, 10);
        Assert.Equal(expected.Difficulty, actual.Value.Difficulty, 10);
    }

    [Fact]
    public void Sm2_approximation_keeps_the_interval_at_the_retention_fsrs_schedules_for()
    {
        var state = FsrsSm2Memory.Approximate(2.5d, 10d, 0.9d, Weights);

        Assert.NotNull(state);
        Assert.Equal(10d, state.Value.Stability, 5);
        Assert.Equal(6.9140563d, state.Value.Difficulty, 5);
    }

    // At any retention other than 0.9 the stability depends on the decay exponent, so this is the
    // case that notices a wrong sign or a wrong slot. The values are the closed form of the fsrs-rs
    // expression evaluated apart from the code under test.
    [Fact]
    public void Sm2_approximation_shortens_an_interval_scheduled_for_a_lower_retention()
    {
        var state = FsrsSm2Memory.Approximate(2.5d, 100d, 0.8d, Weights);

        Assert.NotNull(state);
        Assert.Equal(30.15718d, state.Value.Stability, 4);
        Assert.Equal(8.64224d, state.Value.Difficulty, 4);
    }

    [Theory]
    [InlineData(0d, 100d, 0.9d)]
    [InlineData(2.5d, 0d, 0.9d)]
    [InlineData(2.5d, 100d, 1d)]
    [InlineData(double.NaN, 100d, 0.9d)]
    public void Sm2_approximation_refuses_inputs_it_cannot_read(double ease, double interval, double retention)
    {
        Assert.Null(FsrsSm2Memory.Approximate(ease, interval, retention, Weights));
    }

    private static FlashcardReviewLog Answer(DateTimeOffset at, FlashcardReviewGrade grade) =>
        new(0, string.Empty, string.Empty, string.Empty, grade, at, 0d, 0d, null, null,
            FlashcardFsrsState.Review, FlashcardFsrsState.Review);
}
