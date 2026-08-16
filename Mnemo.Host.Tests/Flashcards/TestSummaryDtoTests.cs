using Mnemo.Core.Models.Flashcards;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The test-history contract as it crosses the wire. The endpoints around it are pass-throughs;
/// what a reader can get wrong is here, in what survives the mapping.
/// </summary>
public class TestSummaryDtoTests
{
    private static FlashcardTestAttempt Attempt(double scorePct) => new(
        "attempt-1",
        "deck-1",
        new DateTimeOffset(2026, 8, 8, 10, 0, 0, TimeSpan.Zero),
        new DateTimeOffset(2026, 8, 8, 10, 12, 0, TimeSpan.Zero),
        20,
        14,
        4,
        2,
        scorePct);

    [Fact]
    public void ADeckWithNoAttemptsCarriesNoLatestAndNoDelta()
    {
        var dto = TestSummaryDto.FromModel(FlashcardTestSummary.None);

        Assert.False(dto.HasAttempts);
        Assert.Null(dto.Latest);
        Assert.Null(dto.PreviousScorePct);
        Assert.Null(dto.DeltaVsPrevious);
        Assert.Equal(0, dto.AttemptCount);
    }

    [Fact]
    public void ASingleAttemptHasNothingToCompareAgainst()
    {
        // Null, not zero. "First attempt" and "exactly as well as last time" are different things
        // and the widget renders them differently.
        var dto = TestSummaryDto.FromModel(new FlashcardTestSummary(true, 80, null, 80, 1, Attempt(80)));

        Assert.Null(dto.DeltaVsPrevious);
        Assert.Equal(80, dto.LatestScorePct);
    }

    [Fact]
    public void TheDeltaIsCarriedRatherThanLeftToTheReaderToSubtract()
    {
        var dto = TestSummaryDto.FromModel(new FlashcardTestSummary(true, 80, 65, 92, 4, Attempt(80)));

        Assert.Equal(15, dto.DeltaVsPrevious);
        Assert.Equal(65, dto.PreviousScorePct);
        Assert.Equal(92, dto.BestScorePct);
    }

    [Fact]
    public void ADropIsANegativeDelta()
    {
        var dto = TestSummaryDto.FromModel(new FlashcardTestSummary(true, 55, 70, 90, 3, Attempt(55)));

        Assert.Equal(-15, dto.DeltaVsPrevious);
    }

    [Fact]
    public void ScoresCrossUnrounded()
    {
        // Every surface rounds differently, so rounding here would round twice for the ones that
        // want a decimal.
        var dto = TestSummaryDto.FromModel(new FlashcardTestSummary(true, 82.5, 79.5, 82.5, 2, Attempt(82.5)));

        Assert.Equal(82.5, dto.LatestScorePct);
        Assert.Equal(3, dto.DeltaVsPrevious);
    }

    [Fact]
    public void TheLatestAttemptKeepsEveryTally()
    {
        var dto = TestSummaryDto.FromModel(new FlashcardTestSummary(true, 80, null, 80, 1, Attempt(80)));

        var latest = Assert.IsType<TestAttemptDto>(dto.Latest);
        Assert.Equal("attempt-1", latest.Id);
        Assert.Equal("deck-1", latest.DeckId);
        Assert.Equal(20, latest.CardsTested);
        Assert.Equal(14, latest.GotItCount);
        Assert.Equal(4, latest.CloseCount);
        Assert.Equal(2, latest.MissedCount);
        Assert.Equal(new DateTimeOffset(2026, 8, 8, 10, 12, 0, TimeSpan.Zero), latest.CompletedAt);
    }
}
