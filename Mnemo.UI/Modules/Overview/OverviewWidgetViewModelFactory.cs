using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Modules.Overview;

namespace Mnemo.UI.Modules.Overview;

/// <summary>
/// Builds the board content for each widget Mnemo ships. The manifests are shared data and
/// live outside this project; this is the one place that says which view model draws which of
/// them, so the board and the widget library both go through it.
/// </summary>
public sealed class OverviewWidgetViewModelFactory : IWidgetViewModelFactory
{
    private static readonly Dictionary<string, Func<WidgetManifest, WidgetInstance, IWidgetContext, IWidgetViewModel>> ByWidgetId =
        new(StringComparer.Ordinal)
        {
            [OverviewWidgetManifests.FlashcardStats.WidgetId] =
                (manifest, instance, context) => new Widgets.FlashcardStats.FlashcardStatsWidgetViewModel(manifest, instance, context),
            [OverviewWidgetManifests.FlashcardMemory.WidgetId] =
                (manifest, instance, context) => new Widgets.FlashcardMemory.FlashcardMemoryWidgetViewModel(manifest, instance, context),
            [OverviewWidgetManifests.FlashcardTests.WidgetId] =
                (manifest, instance, context) => new Widgets.FlashcardTests.FlashcardTestsWidgetViewModel(manifest, instance, context),
            [OverviewWidgetManifests.RecentDecks.WidgetId] =
                (manifest, instance, context) => new Widgets.RecentDecks.RecentDecksWidgetViewModel(manifest, instance, context),
            [OverviewWidgetManifests.RecentNotes.WidgetId] =
                (manifest, instance, context) => new Widgets.RecentNotes.RecentNotesWidgetViewModel(manifest, instance, context),
            [OverviewWidgetManifests.StudyGoals.WidgetId] =
                (manifest, instance, context) => new Widgets.StudyGoals.StudyGoalsWidgetViewModel(manifest, instance, context),
            [OverviewWidgetManifests.UsageSummary.WidgetId] =
                (manifest, instance, context) => new Widgets.UsageSummary.UsageSummaryWidgetViewModel(manifest, instance, context),
        };

    public Task<IWidgetViewModel> CreateAsync(
        WidgetManifest manifest,
        WidgetInstance instance,
        IWidgetContext context,
        CancellationToken cancellationToken = default)
    {
        if (!ByWidgetId.TryGetValue(manifest.WidgetId, out var create))
            throw new NotSupportedException($"No overview widget draws '{manifest.WidgetId}'.");

        return Task.FromResult(create(manifest, instance, context));
    }
}
