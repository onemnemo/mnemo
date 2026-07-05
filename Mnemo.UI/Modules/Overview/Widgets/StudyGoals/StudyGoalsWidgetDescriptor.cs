using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Widgets.StudyGoals;

/// <summary>
/// Descriptor for the Study Goals widget: progress bars for practice targets over a daily or
/// weekly window, with the configured metric listed first.
/// </summary>
public sealed class StudyGoalsWidgetDescriptor : IWidgetDescriptor
{
    public WidgetManifest Manifest { get; } = new()
    {
        WidgetId = "mnemo.study-goals",
        TranslationNamespace = "StudyGoals",
        Author = "Mnemo",
        Category = WidgetCategory.Activity,
        IconUri = WidgetIconAvares.Uri("StudyGoals"),
        SupportedSizes = [new WidgetSize(1, 2), new WidgetSize(2, 1), new WidgetSize(2, 2)],
        DefaultSize = new WidgetSize(1, 2),
        Settings =
        [
            new WidgetSettingSchema
            {
                Key = "goal_type",
                LabelKey = "SettingGoalType",
                Type = WidgetSettingType.Choice,
                DefaultValue = "daily",
                Options =
                [
                    new WidgetSettingOption("daily", "SettingGoalTypeDaily"),
                    new WidgetSettingOption("weekly", "SettingGoalTypeWeekly")
                ]
            },
            new WidgetSettingSchema
            {
                Key = "metric",
                LabelKey = "SettingMetric",
                Type = WidgetSettingType.Choice,
                DefaultValue = "cards",
                Options =
                [
                    new WidgetSettingOption("cards", "SettingMetricCards"),
                    new WidgetSettingOption("minutes", "SettingMetricMinutes")
                ]
            }
        ]
    };

    public Task<IWidgetViewModel> CreateViewModelAsync(WidgetInstance instance, IWidgetContext context, CancellationToken cancellationToken = default)
        => Task.FromResult<IWidgetViewModel>(new StudyGoalsWidgetViewModel(Manifest, instance, context));
}
