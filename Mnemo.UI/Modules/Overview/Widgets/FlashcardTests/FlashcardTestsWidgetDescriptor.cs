using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Widgets.FlashcardTests;

/// <summary>
/// Descriptor for the flashcard <b>Test</b> widget: most recently tested deck's score, isolated
/// from Memory (retention) and Activity (effort) counters.
/// </summary>
public sealed class FlashcardTestsWidgetDescriptor : IWidgetDescriptor
{
    public WidgetManifest Manifest { get; } = new()
    {
        WidgetId = "mnemo.flashcard-tests",
        TranslationNamespace = "FlashcardTests",
        Author = "Mnemo",
        Category = WidgetCategory.Statistics,
        IconUri = WidgetIconAvares.Uri("FlashcardTests"),
        SupportedSizes = [new WidgetSize(1, 1), new WidgetSize(2, 1)],
        DefaultSize = new WidgetSize(2, 1)
    };

    public Task<IWidgetViewModel> CreateViewModelAsync(WidgetInstance instance, IWidgetContext context, CancellationToken cancellationToken = default)
        => Task.FromResult<IWidgetViewModel>(new FlashcardTestsWidgetViewModel(Manifest, instance, context));
}
