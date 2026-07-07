namespace Mnemo.Core.Services;

/// <summary>
/// Curated service surface handed to widgets. Widgets read application data and request UI
/// affordances exclusively through this context — they never see the DI container, which keeps
/// extension widgets sandboxable to exactly this surface.
/// </summary>
public interface IWidgetContext
{
    /// <summary>Read access to recorded statistics (practice activity, usage).</summary>
    IStatisticsManager Statistics { get; }

    /// <summary>Read access to flashcard deck summaries (counts only, never full card lists).</summary>
    IFlashcardLibraryService Decks { get; }

    /// <summary>Read access to the three isolated flashcard stat buckets (Memory retention + Test scores).</summary>
    IFlashcardStatsService Stats { get; }

    /// <summary>Read access to notes.</summary>
    INoteService Notes { get; }

    /// <summary>Navigation to app routes (e.g. opening a note or deck from a widget row).</summary>
    INavigationService Navigation { get; }

    /// <summary>Overlay/dialog affordances.</summary>
    IOverlayService Overlays { get; }

    /// <summary>String localization for code-side text.</summary>
    ILocalizationService Localization { get; }

    /// <summary>Culture-aware date formatting for list rows and metadata.</summary>
    IDateDisplayService DateDisplay { get; }

    /// <summary>Structured logging; widgets log failures instead of throwing into the board.</summary>
    ILoggerService Logger { get; }
}
