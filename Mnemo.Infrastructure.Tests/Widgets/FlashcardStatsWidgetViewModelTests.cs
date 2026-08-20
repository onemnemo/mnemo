using System.Globalization;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Models.Widgets;
using Mnemo.Infrastructure.Modules.Overview;
using Mnemo.UI.Modules.Overview.Widgets.FlashcardStats;

namespace Mnemo.Infrastructure.Tests.Widgets;

/// <summary>
/// Verifies the flashcard <b>Activity</b> widget: reps/minutes/sessions/streak sourced from the
/// mode-agnostic effort counters, never from Memory (retention) or Test (score) data.
/// </summary>
public class FlashcardStatsWidgetViewModelTests
{
    private static readonly WidgetManifest Manifest = OverviewWidgetManifests.FlashcardStats;

    private static FlashcardStatsWidgetViewModel CreateViewModel(FakeWidgetContext context)
    {
        var instance = new WidgetInstance
        {
            WidgetId = Manifest.WidgetId,
            Size = Manifest.DefaultSize,
            Settings = Manifest.CreateDefaultSettings()
        };
        return new FlashcardStatsWidgetViewModel(Manifest, instance, context);
    }

    [Fact]
    public async Task Initialize_NoActivityRecorded_AllZero()
    {
        var context = new FakeWidgetContext();
        var viewModel = CreateViewModel(context);

        await viewModel.InitializeAsync();

        Assert.Equal(0, viewModel.CardsToday);
        Assert.Equal(0, viewModel.MinutesToday);
        Assert.Equal(0, viewModel.SessionsToday);
        Assert.Equal(0, viewModel.StudyStreak);
    }

    [Fact]
    public async Task Initialize_WithRecordedActivity_ReadsAllFourCounters()
    {
        var context = new FakeWidgetContext();
        var dayKey = context.StudyDayService.TodayKey;
        context.StatisticsManager.Seed(StatisticsNamespaces.Flashcards, FlashcardStatKinds.DailySummary, dayKey, new Dictionary<string, StatValue>(StringComparer.Ordinal)
        {
            ["cards_reviewed"] = StatValue.FromInt(12),
            ["minutes_studied"] = StatValue.FromInt(9),
            ["sessions_completed"] = StatValue.FromInt(2)
        });
        context.StatisticsManager.Seed(StatisticsNamespaces.Flashcards, FlashcardStatKinds.LifetimeTotals, "all", new Dictionary<string, StatValue>(StringComparer.Ordinal)
        {
            ["current_streak_days"] = StatValue.FromInt(5)
        });

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.Equal(12, viewModel.CardsToday);
        Assert.Equal(9, viewModel.MinutesToday);
        Assert.Equal(2, viewModel.SessionsToday);
        Assert.Equal(5, viewModel.StudyStreak);
    }
}
