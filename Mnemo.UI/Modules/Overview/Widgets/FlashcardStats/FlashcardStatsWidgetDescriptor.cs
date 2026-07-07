using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Widgets.FlashcardStats;

/// <summary>
/// Descriptor for the flashcard <b>Activity</b> widget: reps, minutes, sessions and streak,
/// counted across all study modes. Isolated from the Memory
/// (retention) and Test (score) buckets. Manifest id kept as <c>mnemo.flashcard-stats</c> so
/// existing board layouts survive the rename.
/// </summary>
public sealed class FlashcardStatsWidgetDescriptor : IWidgetDescriptor
{
    public WidgetManifest Manifest { get; } = new()
    {
        WidgetId = "mnemo.flashcard-stats",
        TranslationNamespace = "FlashcardStats",
        Author = "Mnemo",
        Category = WidgetCategory.Statistics,
        IconUri = WidgetIconAvares.Uri("FlashcardStats"),
        SupportedSizes = [new WidgetSize(2, 1), new WidgetSize(4, 1), new WidgetSize(1, 2)],
        DefaultSize = new WidgetSize(2, 1)
    };

    public Task<IWidgetViewModel> CreateViewModelAsync(WidgetInstance instance, IWidgetContext context, CancellationToken cancellationToken = default)
        => Task.FromResult<IWidgetViewModel>(new FlashcardStatsWidgetViewModel(Manifest, instance, context));
}
