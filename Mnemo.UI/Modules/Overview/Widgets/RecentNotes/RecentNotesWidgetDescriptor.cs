using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Widgets.RecentNotes;

/// <summary>
/// Descriptor for the Recent Notes widget: the most recently created/edited notes, with a
/// configurable window, sort field, and row limit.
/// </summary>
public sealed class RecentNotesWidgetDescriptor : IWidgetDescriptor
{
    public WidgetManifest Manifest { get; } = new()
    {
        WidgetId = "mnemo.recent-notes",
        TranslationNamespace = "RecentNotes",
        Author = "Mnemo",
        Category = WidgetCategory.Activity,
        IconUri = WidgetIconAvares.Uri("RecentNotes"),
        SupportedSizes = [new WidgetSize(2, 1), new WidgetSize(2, 2)],
        DefaultSize = new WidgetSize(2, 2),
        Settings =
        [
            new WidgetSettingSchema
            {
                Key = "days_to_show",
                LabelKey = "SettingDaysToShow",
                Type = WidgetSettingType.Range,
                DefaultValue = "7",
                Minimum = 1,
                Maximum = 90
            },
            new WidgetSettingSchema
            {
                Key = "sort_by",
                LabelKey = "SettingSortBy",
                Type = WidgetSettingType.Choice,
                DefaultValue = "date",
                Options =
                [
                    new WidgetSettingOption("date", "SettingSortByDate"),
                    new WidgetSettingOption("modified", "SettingSortByModified")
                ]
            },
            new WidgetSettingSchema
            {
                Key = "limit",
                LabelKey = "SettingLimit",
                Type = WidgetSettingType.Range,
                DefaultValue = "5",
                Minimum = 1,
                Maximum = 10
            }
        ]
    };

    public Task<IWidgetViewModel> CreateViewModelAsync(WidgetInstance instance, IWidgetContext context, CancellationToken cancellationToken = default)
        => Task.FromResult<IWidgetViewModel>(new RecentNotesWidgetViewModel(Manifest, instance, context));
}
