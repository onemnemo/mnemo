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
    public void Sm2_approximation_matches_the_pinned_reference_case()
    {
        var state = FsrsSm2Memory.Approximate(2.5d, 10d, 0.9d, Weights);

        Assert.NotNull(state);
        Assert.Equal(10d, state.Value.Stability, 5);
        Assert.Equal(6.9140563d, state.Value.Difficulty, 5);
    }

    private static FlashcardReviewLog Answer(DateTimeOffset at, FlashcardReviewGrade grade) =>
        new(0, string.Empty, string.Empty, string.Empty, grade, at, 0d, 0d, null, null,
            FlashcardFsrsState.Review, FlashcardFsrsState.Review);
}
