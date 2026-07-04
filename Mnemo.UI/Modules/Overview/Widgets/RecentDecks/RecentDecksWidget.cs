using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.Widgets;

namespace Mnemo.UI.Modules.Overview.Widgets.RecentDecks;

/// <summary>
/// Factory for the Recent Decks widget. Reads from <see cref="IStatisticsManager"/> per-deck
/// summaries for "last practiced" data and joins against <see cref="IFlashcardDeckService"/> for
/// metadata (deck name, card count, subject) so the widget stays in sync with renames/deletes.
/// </summary>
public class RecentDecksWidget : IWidget
{
    public WidgetMetadata Metadata { get; }
    private readonly IStatisticsManager _statistics;
    private readonly IFlashcardDeckService _decks;
    private readonly INavigationService _navigation;
    private readonly ILoggerService _logger;
    private readonly ILocalizationService _localization;
    private readonly IDateDisplayService _dateDisplay;

    public RecentDecksWidget(
        IStatisticsManager statistics,
        IFlashcardDeckService decks,
        INavigationService navigation,
        ILoggerService logger,
        ILocalizationService localization,
        IDateDisplayService dateDisplay)
    {
        _statistics = statistics;
        _decks = decks;
        _navigation = navigation;
        _logger = logger;
        _localization = localization;
        _dateDisplay = dateDisplay;
        Metadata = new WidgetMetadata(
            id: "recent-decks",
            title: "Recent Decks",
            description: "View your recently practiced flashcard decks",
            category: WidgetCategory.Activity,
            icon: WidgetIconAvares.Uri("RecentDecks"),
            defaultSize: new WidgetSize(colSpan: 3, rowSpan: 2),
            translationNamespace: "RecentDecks",
            galleryFilter: WidgetGalleryFilterCategory.Flashcards,
            galleryTagKeys: ["TagDecks", "TagRecent"],
            isFeatured: true);
    }

    public IWidgetViewModel CreateViewModel(IWidgetSettings? settings = null)
    {
        return new RecentDecksWidgetViewModel(_statistics, _decks, _navigation, _logger, _localization, _dateDisplay);
    }
}
