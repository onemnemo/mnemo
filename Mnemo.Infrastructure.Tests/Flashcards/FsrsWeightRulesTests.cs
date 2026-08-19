using System;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// The gate that stands between a weight vector and the scheduler. A vector that reaches the store
/// unchecked can take a card's memory state to NaN, which SQLite cannot hold, so the card comes
/// back as if it had never been studied.
/// </summary>
public sealed class FsrsWeightRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 4, 2, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public void The_published_defaults_pass()
    {
        Assert.True(FsrsWeightRules.TryValidate(FlashcardFsrsParameters.Default.Weights, out var error));
        Assert.Null(error);
    }

    [Fact]
    public void No_vector_at_all_passes_and_means_the_defaults()
    {
        Assert.True(FsrsWeightRules.TryValidate(null, out _));
    }

    [Fact]
    public void A_nineteen_slot_vector_passes_and_pads_the_way_the_scheduler_pads_it()
    {
        var fsrs5 = FlashcardFsrsParameters.Default.Weights.Take(19).ToArray();

        Assert.True(FsrsWeightRules.TryValidate(fsrs5, out _));

        var expanded = FsrsWeightRules.Expand(fsrs5);
        Assert.Equal(21, expanded.Length);
        Assert.Equal(0d, expanded[19]);
        Assert.Equal(0.5d, expanded[20]);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(18)]
    [InlineData(20)]
    [InlineData(22)]
    public void A_vector_of_the_wrong_length_is_refused(int count)
    {
        Assert.False(FsrsWeightRules.TryValidate(new double[count], out var error));
        Assert.NotNull(error);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void A_slot_that_is_not_a_number_is_refused(double value)
    {
        var weights = FsrsWeightRules.Defaults();
        weights[1] = value;

        Assert.False(FsrsWeightRules.TryValidate(weights, out var error));
        Assert.NotNull(error);
    }

    [Fact]
    public void A_zero_decay_is_refused()
    {
        var weights = FsrsWeightRules.Defaults();
        weights[20] = 0d;

        Assert.False(FsrsWeightRules.TryValidate(weights, out _));
    }

    [Fact]
    public void A_slot_outside_its_range_is_refused()
    {
        var weights = FsrsWeightRules.Defaults();
        weights[4] = 25d;

        Assert.False(FsrsWeightRules.TryValidate(weights, out _));
    }

    [Fact]
    public void Clipping_pulls_every_slot_back_into_range()
    {
        var weights = FsrsWeightRules.Defaults();
        weights[4] = 25d;
        weights[9] = -3d;
        weights[20] = double.NaN;

        var clipped = FsrsWeightRules.Clip(weights);

        Assert.True(FsrsWeightRules.TryValidate(clipped, out _));
        Assert.Equal(FsrsWeightRules.UpperBound(4), clipped[4]);
        Assert.Equal(FsrsWeightRules.LowerBound(9), clipped[9]);
        Assert.Equal(FlashcardFsrsParameters.Default.Weights[20], clipped[20]);
    }

    /// <summary>
    /// Why the gate exists. The scheduler's clamp passes a NaN straight through, so a vector one
    /// slot wide of sane is enough to leave a card with no memory state at all.
    /// </summary>
    [Fact]
    public void An_unchecked_vector_takes_a_card_to_a_stability_of_NaN()
    {
        // Slot 2 is the stability a card starts with when its first answer is Good.
        var weights = FsrsWeightRules.Defaults();
        weights[2] = double.NaN;
        var preset = FlashcardPreset.CreateStandard(Now) with { Weights = weights, LearningSteps = Array.Empty<int>() };
        var scheduler = new FsrsScheduler(new FlashcardClock(new TestTimeProvider(Now)));

        var next = scheduler.ApplyGrade(FlashcardSchedule.NewFor("card-1", Now), FlashcardReviewGrade.Good, Now, preset);

        Assert.True(double.IsNaN(next.Stability ?? 0d));
        Assert.False(FsrsWeightRules.TryValidate(weights, out _));
    }

    [Fact]
    public async Task Saving_a_preset_refuses_a_vector_that_could_produce_NaN()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var presets = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var standard = await presets.GetOrCreateStandardAsync();

        var weights = FsrsWeightRules.Defaults();
        weights[8] = double.NaN;

        await Assert.ThrowsAsync<ArgumentException>(() => presets.SavePresetAsync(standard with { Weights = weights }));

        var stored = await presets.GetPresetAsync(FlashcardPreset.StandardPresetId);
        Assert.Null(stored!.Weights);
    }

    [Fact]
    public async Task A_fitted_vector_is_applied_and_can_be_put_back()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var presets = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var standard = await presets.GetOrCreateStandardAsync();

        var fitted = FsrsWeightRules.Defaults();
        fitted[0] = 0.5d;

        await presets.SavePresetAsync(standard with { Weights = fitted });
        var applied = await presets.GetPresetAsync(FlashcardPreset.StandardPresetId);
        Assert.Equal(fitted, applied!.Weights);

        await presets.SavePresetAsync(applied with { Weights = null });
        var rolledBack = await presets.GetPresetAsync(FlashcardPreset.StandardPresetId);
        Assert.Null(rolledBack!.Weights);
    }
}
