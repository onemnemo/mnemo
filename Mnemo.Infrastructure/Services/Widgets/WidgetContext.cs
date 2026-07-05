using System;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Widgets;

/// <summary>
/// Default widget context: a fixed, curated bundle of services resolved once via DI.
/// Widgets receive this instead of the container so their capability surface stays explicit.
/// </summary>
public sealed class WidgetContext : IWidgetContext
{
    public IStatisticsManager Statistics { get; }
    public IFlashcardDeckService Decks { get; }
    public INoteService Notes { get; }
    public INavigationService Navigation { get; }
    public IOverlayService Overlays { get; }
    public ILocalizationService Localization { get; }
    public IDateDisplayService DateDisplay { get; }
    public ILoggerService Logger { get; }

    public WidgetContext(
        IStatisticsManager statistics,
        IFlashcardDeckService decks,
        INoteService notes,
        INavigationService navigation,
        IOverlayService overlays,
        ILocalizationService localization,
        IDateDisplayService dateDisplay,
        ILoggerService logger)
    {
        Statistics = statistics ?? throw new ArgumentNullException(nameof(statistics));
        Decks = decks ?? throw new ArgumentNullException(nameof(decks));
        Notes = notes ?? throw new ArgumentNullException(nameof(notes));
        Navigation = navigation ?? throw new ArgumentNullException(nameof(navigation));
        Overlays = overlays ?? throw new ArgumentNullException(nameof(overlays));
        Localization = localization ?? throw new ArgumentNullException(nameof(localization));
        DateDisplay = dateDisplay ?? throw new ArgumentNullException(nameof(dateDisplay));
        Logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }
}
