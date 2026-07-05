using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.Widgets.RecentDecks;

/// <summary>
/// Descriptor for the Recent Decks widget: recently practiced decks joined with live deck
/// metadata, with a configurable window, sort field, and row limit.
/// </summary>
public sealed class RecentDecksWidgetDescriptor : IWidgetDescriptor
{
    public WidgetManifest Manifest { get; } = new()
    {
        WidgetId = "mnemo.recent-decks",
        TranslationNamespace = "RecentDecks",
        Author = "Mnemo",
        Category = WidgetCategory.Activity,
        IconUri = WidgetIconAvares.Uri("RecentDecks"),
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
                    new WidgetSettingOption("study_count", "SettingSortByStudyCount")
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
        => Task.FromResult<IWidgetViewModel>(new RecentDecksWidgetViewModel(Manifest, instance, context));
}
