using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.Widgets;

namespace Mnemo.UI.Modules.Overview.Widgets.RecentNotes;

public sealed class RecentNotesWidget : IWidget
{
    public WidgetMetadata Metadata { get; }
    private readonly INoteService _notes;
    private readonly INavigationService _navigation;
    private readonly ILoggerService _logger;
    private readonly ILocalizationService _localization;
    private readonly IDateDisplayService _dateDisplay;

    public RecentNotesWidget(
        INoteService notes,
        INavigationService navigation,
        ILoggerService logger,
        ILocalizationService localization,
        IDateDisplayService dateDisplay)
    {
        _notes = notes;
        _navigation = navigation;
        _logger = logger;
        _localization = localization;
        _dateDisplay = dateDisplay;
        Metadata = new WidgetMetadata(
            id: "recent-notes",
            title: "Recent notes",
            description: "Notes you edited most recently",
            category: WidgetCategory.Activity,
            icon: WidgetIconAvares.Uri("RecentNotes"),
            defaultSize: new WidgetSize(colSpan: 3, rowSpan: 2),
            translationNamespace: "RecentNotes",
            galleryFilter: WidgetGalleryFilterCategory.Productivity,
            galleryTagKeys: ["TagNotes", "TagRecent"]);
    }

    public IWidgetViewModel CreateViewModel(IWidgetSettings? settings = null)
        => new RecentNotesWidgetViewModel(_notes, _navigation, _logger, _localization, _dateDisplay);
}
