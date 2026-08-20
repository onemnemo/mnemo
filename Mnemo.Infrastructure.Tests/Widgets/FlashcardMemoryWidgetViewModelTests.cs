using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Widgets;
using Mnemo.Infrastructure.Modules.Overview;
using Mnemo.UI.Modules.Overview.Widgets.FlashcardMemory;

namespace Mnemo.Infrastructure.Tests.Widgets;

/// <summary>
/// Verifies the Memory widget's aggregate logic: a review-volume-weighted mean of true retention
/// across decks, skipping decks with no reviews in the window, and a trend line from the
/// highest-volume deck. Memory must never read Test or Activity data.
/// </summary>
public class FlashcardMemoryWidgetViewModelTests
{
    private static readonly WidgetManifest Manifest = OverviewWidgetManifests.FlashcardMemory;

    private static FlashcardDeckSummary MakeDeck(string id, string name) => new(
        new FlashcardDeckHeader(id, null, "preset", name, null, [], 0, null),
        TotalCards: 20,
        ActiveCards: 20,
        SuspendedCards: 0,
        DueCounts: new FlashcardDueCounts(0, 0, 0),
        RetentionPercent: 0);

    private static FlashcardMemoryWidgetViewModel CreateViewModel(FakeWidgetContext context)
    {
        var instance = new WidgetInstance
        {
            WidgetId = Manifest.WidgetId,
            Size = Manifest.DefaultSize,
            Settings = Manifest.CreateDefaultSettings()
        };
        return new FlashcardMemoryWidgetViewModel(Manifest, instance, context);
    }

    [Fact]
    public async Task Initialize_NoDecks_ShowsEmptyState()
    {
        var context = new FakeWidgetContext();
        var viewModel = CreateViewModel(context);

        await viewModel.InitializeAsync();

        Assert.True(viewModel.IsEmpty);
        Assert.Equal(0, viewModel.RetentionPercent);
        Assert.Empty(viewModel.TrendValues);
    }

    [Fact]
    public async Task Initialize_DecksWithNoReviews_ShowsEmptyState()
    {
        var context = new FakeWidgetContext();
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("d1", "Biology"));
        // No retention trend seeded for "d1" -> zero review volume -> skipped entirely.

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.True(viewModel.IsEmpty);
    }

    [Fact]
    public async Task Initialize_SingleDeckWithReviews_UsesItsRetentionAndTrend()
    {
        var context = new FakeWidgetContext();
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("d1", "Biology"));
        context.StatsService.RetentionByDeck["d1"] = 87;
        context.StatsService.RetentionTrendByDeck["d1"] =
        [
            new FlashcardRetentionTrendPoint(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)), 80, 5),
            new FlashcardRetentionTrendPoint(DateOnly.FromDateTime(DateTime.UtcNow), 90, 5)
        ];

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.False(viewModel.IsEmpty);
        Assert.Equal(87, viewModel.RetentionPercent);
        Assert.Equal("Biology", viewModel.TrendDeckName);
        Assert.Equal(new double[] { 80, 90 }, viewModel.TrendValues);
    }

    [Fact]
    public async Task Initialize_MultipleDecks_WeightsByReviewVolumeAndSkipsZeroVolumeDecks()
    {
        var context = new FakeWidgetContext();
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("busy", "Chemistry"));
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("quiet", "History"));
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("untouched", "Unused"));

        // Busy deck: 90 reviews at 100% retention.
        context.StatsService.RetentionByDeck["busy"] = 100;
        context.StatsService.RetentionTrendByDeck["busy"] =
            [new FlashcardRetentionTrendPoint(DateOnly.FromDateTime(DateTime.UtcNow), 100, 90)];

        // Quiet deck: 10 reviews at 0% retention.
        context.StatsService.RetentionByDeck["quiet"] = 0;
        context.StatsService.RetentionTrendByDeck["quiet"] =
            [new FlashcardRetentionTrendPoint(DateOnly.FromDateTime(DateTime.UtcNow), 0, 10)];

        // "untouched" has no seeded trend -> zero volume -> excluded from both the mean and the pick.

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        // Weighted mean: (100*90 + 0*10) / 100 = 90.
        Assert.Equal(90, viewModel.RetentionPercent);
        // Busiest deck (90 reviews) drives the trend line/label.
        Assert.Equal("Chemistry", viewModel.TrendDeckName);
    }
}
