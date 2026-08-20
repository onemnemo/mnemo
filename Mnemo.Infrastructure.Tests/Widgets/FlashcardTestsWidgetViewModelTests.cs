using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Widgets;
using Mnemo.Infrastructure.Modules.Overview;
using Mnemo.UI.Modules.Overview.Widgets.FlashcardTests;

namespace Mnemo.Infrastructure.Tests.Widgets;

/// <summary>
/// Verifies the Test widget's "most recently tested deck" selection and delta/trend logic. Test
/// is isolated from Memory/Activity: this widget reads only
/// <see cref="Mnemo.Core.Services.IFlashcardStatsService.GetTestSummaryAsync"/> and
/// <see cref="Mnemo.Core.Services.IFlashcardStatsService.GetTestTrendAsync"/>.
/// </summary>
public class FlashcardTestsWidgetViewModelTests
{
    private static readonly WidgetManifest Manifest = OverviewWidgetManifests.FlashcardTests;

    private static FlashcardDeckSummary MakeDeck(string id, string name) => new(
        new FlashcardDeckHeader(id, null, "preset", name, null, [], 0, null),
        TotalCards: 20,
        ActiveCards: 20,
        SuspendedCards: 0,
        DueCounts: new FlashcardDueCounts(0, 0, 0),
        RetentionPercent: 0);

    private static FlashcardTestAttempt MakeAttempt(string id, string deckId, DateTimeOffset completedAt, double scorePct) => new(
        id, deckId, completedAt.AddMinutes(-5), completedAt, CardsTested: 10, GotItCount: 8, CloseCount: 1, MissedCount: 1, ScorePct: scorePct);

    private static FlashcardTestsWidgetViewModel CreateViewModel(FakeWidgetContext context)
    {
        var instance = new WidgetInstance
        {
            WidgetId = Manifest.WidgetId,
            Size = Manifest.DefaultSize,
            Settings = Manifest.CreateDefaultSettings()
        };
        return new FlashcardTestsWidgetViewModel(Manifest, instance, context);
    }

    [Fact]
    public async Task Initialize_NoDecks_ShowsEmptyState()
    {
        var context = new FakeWidgetContext();
        var viewModel = CreateViewModel(context);

        await viewModel.InitializeAsync();

        Assert.True(viewModel.IsEmpty);
        Assert.Equal(TestScoreTrend.None, viewModel.Trend);
    }

    [Fact]
    public async Task Initialize_DecksWithNoTestAttempts_ShowsEmptyState()
    {
        var context = new FakeWidgetContext();
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("d1", "Biology"));
        // No summary seeded -> FlashcardTestSummary.None (HasAttempts = false).

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.True(viewModel.IsEmpty);
    }

    [Fact]
    public async Task Initialize_PicksMostRecentlyTestedDeckAcrossDecks()
    {
        var context = new FakeWidgetContext();
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("older", "Old Deck"));
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("newer", "New Deck"));

        var olderAttempt = MakeAttempt("a1", "older", DateTimeOffset.UtcNow.AddDays(-5), 70);
        context.StatsService.TestSummaryByDeck["older"] = new FlashcardTestSummary(true, 70, null, 70, 1, olderAttempt);

        var newerAttempt = MakeAttempt("a2", "newer", DateTimeOffset.UtcNow, 85);
        context.StatsService.TestSummaryByDeck["newer"] = new FlashcardTestSummary(true, 85, 75, 90, 3, newerAttempt);

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.False(viewModel.IsEmpty);
        Assert.Equal("New Deck", viewModel.DeckName);
        Assert.Equal(85, viewModel.LatestScorePercent);
        Assert.Equal(90, viewModel.BestScorePercent);
    }

    [Fact]
    public async Task Initialize_ScoreImproved_SetsUpTrendWithPositiveDelta()
    {
        var context = new FakeWidgetContext();
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("d1", "Biology"));
        var latest = MakeAttempt("a2", "d1", DateTimeOffset.UtcNow, 90);
        context.StatsService.TestSummaryByDeck["d1"] = new FlashcardTestSummary(true, 90, 70, 90, 2, latest);

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.Equal(TestScoreTrend.Up, viewModel.Trend);
        Assert.True(viewModel.IsTrendUp);
        Assert.Equal(20, viewModel.DeltaPercent);
    }

    [Fact]
    public async Task Initialize_ScoreDropped_SetsDownTrendWithPositiveAbsoluteDelta()
    {
        var context = new FakeWidgetContext();
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("d1", "Biology"));
        var latest = MakeAttempt("a2", "d1", DateTimeOffset.UtcNow, 60);
        context.StatsService.TestSummaryByDeck["d1"] = new FlashcardTestSummary(true, 60, 80, 80, 2, latest);

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.Equal(TestScoreTrend.Down, viewModel.Trend);
        Assert.True(viewModel.IsTrendDown);
        Assert.Equal(20, viewModel.DeltaPercent);
    }

    [Fact]
    public async Task Initialize_FirstAttempt_ShowsNoTrend()
    {
        var context = new FakeWidgetContext();
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("d1", "Biology"));
        var latest = MakeAttempt("a1", "d1", DateTimeOffset.UtcNow, 75);
        context.StatsService.TestSummaryByDeck["d1"] = new FlashcardTestSummary(true, 75, null, 75, 1, latest);

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.Equal(TestScoreTrend.None, viewModel.Trend);
        Assert.True(viewModel.IsTrendNone);
        Assert.Equal(0, viewModel.DeltaPercent);
    }

    [Fact]
    public async Task Initialize_PopulatesSparklineFromTestTrend()
    {
        var context = new FakeWidgetContext();
        context.DeckLibraryService.DecksToReturn.Add(MakeDeck("d1", "Biology"));
        var latest = MakeAttempt("a3", "d1", DateTimeOffset.UtcNow, 88);
        context.StatsService.TestSummaryByDeck["d1"] = new FlashcardTestSummary(true, 88, 80, 88, 3, latest);
        context.StatsService.TestTrendByDeck["d1"] =
        [
            MakeAttempt("a1", "d1", DateTimeOffset.UtcNow.AddDays(-2), 70),
            MakeAttempt("a2", "d1", DateTimeOffset.UtcNow.AddDays(-1), 80),
            latest
        ];

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.Equal(new double[] { 70, 80, 88 }, viewModel.TrendValues);
    }
}
