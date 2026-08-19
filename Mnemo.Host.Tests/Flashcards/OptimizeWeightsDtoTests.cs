using Mnemo.Core.Models.Flashcards;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The optimizer result as it crosses the wire. The endpoint is a pass-through; what a reader can
/// get wrong is here.
/// </summary>
public class OptimizeWeightsDtoTests
{
    private static readonly double[] Fitted = FlashcardFsrsParameters.Default.Weights;

    private static FlashcardWeightOptimization Model(
        FlashcardOptimizationStatus status, double lossBefore, double lossAfter) =>
        new(status, Fitted, Fitted, 900, 820, 640, 400, lossBefore, lossAfter);

    [Fact]
    public void AFittedResultCarriesBothScores()
    {
        var dto = OptimizeWeightsDto.FromModel(Model(FlashcardOptimizationStatus.Fitted, 0.42, 0.37));

        Assert.Equal(OptimizeWeightsDto.FittedStatus, dto.Status);
        Assert.Equal(0.42, dto.LossBefore);
        Assert.Equal(0.37, dto.LossAfter);
        Assert.Equal(640, dto.ReviewsScored);
        Assert.Equal(400, dto.MinimumReviews);
    }

    [Fact]
    public void AScoreThatCouldNotBeMeasuredCrossesAsNothing()
    {
        // JSON has no NaN, and the serializer refuses to write one rather than inventing a spelling.
        var dto = OptimizeWeightsDto.FromModel(
            Model(FlashcardOptimizationStatus.NotEnoughReviews, double.NaN, double.NaN));

        Assert.Equal(OptimizeWeightsDto.NotEnoughReviewsStatus, dto.Status);
        Assert.Null(dto.LossBefore);
        Assert.Null(dto.LossAfter);
    }

    [Fact]
    public void TheVectorInUseCrossesSoItCanBePutBack()
    {
        var current = new double[] { 1, 2, 3 };
        var fitted = new double[] { 4, 5, 6 };
        var dto = OptimizeWeightsDto.FromModel(new FlashcardWeightOptimization(
            FlashcardOptimizationStatus.Fitted, current, fitted, 10, 10, 10, 400, 1, 1));

        Assert.Equal(current, dto.CurrentWeights);
        Assert.Equal(fitted, dto.Weights);
    }

    [Fact]
    public void APresetOnTheDefaultsCarriesNoVector()
    {
        var dto = PresetDto.FromModel(FlashcardPreset.CreateStandard(DateTimeOffset.UtcNow), deckCount: 1);

        Assert.Null(dto.Weights);
    }

    [Fact]
    public void APresetCarriesTheVectorItSchedulesOn()
    {
        var preset = FlashcardPreset.CreateStandard(DateTimeOffset.UtcNow) with { Weights = Fitted };

        Assert.Equal(Fitted, PresetDto.FromModel(preset, deckCount: 1).Weights);
    }
}
