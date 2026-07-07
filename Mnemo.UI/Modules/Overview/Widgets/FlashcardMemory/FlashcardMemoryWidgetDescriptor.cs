using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Widgets.FlashcardMemory;

/// <summary>
/// Descriptor for the flashcard <b>Memory</b> widget: true retention sourced only from Review,
/// isolated from Test scores and Activity effort counters.
/// </summary>
public sealed class FlashcardMemoryWidgetDescriptor : IWidgetDescriptor
{
    public WidgetManifest Manifest { get; } = new()
    {
        WidgetId = "mnemo.flashcard-memory",
        TranslationNamespace = "FlashcardMemory",
        Author = "Mnemo",
        Category = WidgetCategory.Statistics,
        IconUri = WidgetIconAvares.Uri("FlashcardMemory"),
        SupportedSizes = [new WidgetSize(1, 1), new WidgetSize(2, 1)],
        DefaultSize = new WidgetSize(2, 1)
    };

    public Task<IWidgetViewModel> CreateViewModelAsync(WidgetInstance instance, IWidgetContext context, CancellationToken cancellationToken = default)
        => Task.FromResult<IWidgetViewModel>(new FlashcardMemoryWidgetViewModel(Manifest, instance, context));
}
