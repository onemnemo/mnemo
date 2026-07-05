using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Widgets.UsageSummary;

/// <summary>
/// Descriptor for the Usage widget: lifetime launches/notes plus per-area screen time over a
/// configurable period, led by the configured headline metric.
/// </summary>
public sealed class UsageSummaryWidgetDescriptor : IWidgetDescriptor
{
    public WidgetManifest Manifest { get; } = new()
    {
        WidgetId = "mnemo.usage-summary",
        TranslationNamespace = "UsageSummary",
        Author = "Mnemo",
        Category = WidgetCategory.Statistics,
        IconUri = WidgetIconAvares.Uri("UsageSummary"),
        SupportedSizes = [new WidgetSize(1, 2), new WidgetSize(2, 1), new WidgetSize(2, 2)],
        DefaultSize = new WidgetSize(1, 2),
        Settings =
        [
            new WidgetSettingSchema
            {
                Key = "period_days",
                LabelKey = "SettingPeriod",
                Type = WidgetSettingType.Choice,
                DefaultValue = "7",
                Options =
                [
                    new WidgetSettingOption("7", "SettingPeriod7"),
                    new WidgetSettingOption("14", "SettingPeriod14"),
                    new WidgetSettingOption("30", "SettingPeriod30"),
                    new WidgetSettingOption("90", "SettingPeriod90")
                ]
            },
            new WidgetSettingSchema
            {
                Key = "metric",
                LabelKey = "SettingMetric",
                Type = WidgetSettingType.Choice,
                DefaultValue = "review_count",
                Options =
                [
                    new WidgetSettingOption("review_count", "SettingMetricReviews"),
                    new WidgetSettingOption("time_spent", "SettingMetricTime")
                ]
            }
        ]
    };

    public Task<IWidgetViewModel> CreateViewModelAsync(WidgetInstance instance, IWidgetContext context, CancellationToken cancellationToken = default)
        => Task.FromResult<IWidgetViewModel>(new UsageSummaryWidgetViewModel(Manifest, instance, context));
}
