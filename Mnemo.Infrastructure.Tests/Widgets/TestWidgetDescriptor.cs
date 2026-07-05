using System.Threading;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Widgets;

/// <summary>
/// Manifest-only descriptor for registry and store tests; creating a ViewModel is unsupported.
/// </summary>
internal sealed class TestWidgetDescriptor : IWidgetDescriptor
{
    public WidgetManifest Manifest { get; }

    public TestWidgetDescriptor(WidgetManifest manifest)
    {
        Manifest = manifest;
    }

    public static TestWidgetDescriptor Create(
        string widgetId,
        WidgetSize defaultSize,
        IReadOnlyList<WidgetSize>? supportedSizes = null,
        IReadOnlyList<WidgetSettingSchema>? settings = null)
        => new(new WidgetManifest
        {
            WidgetId = widgetId,
            TranslationNamespace = "Test",
            Author = "Test",
            IconUri = "avares://test/icon.svg",
            DefaultSize = defaultSize,
            SupportedSizes = supportedSizes ?? [defaultSize],
            Settings = settings ?? []
        });

    public Task<IWidgetViewModel> CreateViewModelAsync(WidgetInstance instance, IWidgetContext context, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("Test descriptor does not create ViewModels.");
}
