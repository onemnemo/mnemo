using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Widgets.FlashcardStats;

/// <summary>
/// Descriptor for the Flashcard Statistics widget: lifetime totals, streak, and today's count.
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
