namespace Mnemo.Core.Models.Statistics;

/// <summary>
/// Stable namespace identifiers used by built-in modules. Extensions are encouraged to use
/// the <c>"ext."</c> prefix to avoid collisions with first-party namespaces.
/// </summary>
public static class StatisticsNamespaces
{
    public const string Flashcards = "flashcards";
    public const string Notes = "notes";

    /// <summary>Cross-app usage (launches, route dwell time). Key for daily: <c>yyyy-MM-dd</c> UTC.</summary>
    public const string App = "app";

    /// <summary>Recommended prefix for extension namespaces (e.g. <c>"ext.acme"</c>).</summary>
    public const string ExtensionPrefix = "ext.";
}

/// <summary>
/// Stable record kinds for built-in flashcard statistics.
/// </summary>
public static class FlashcardStatKinds
{
    /// <summary>Aggregated daily flashcard activity. Key: <c>yyyy-MM-dd</c> (UTC).</summary>
    public const string DailySummary = "daily.summary";

    /// <summary>Per-deck rolling state (last practiced, totals). Key: <c>deck:{deckId}</c>.</summary>
    public const string DeckSummary = "deck.summary";

    /// <summary>Single completed practice session. Key: <c>session:{startedAtTicks}:{deckId}</c>.</summary>
    public const string SessionLog = "session.log";

    /// <summary>Lifetime totals for the user. Key: <c>"all"</c>.</summary>
    public const string LifetimeTotals = "totals";
}

/// <summary>
/// Stable record kinds for notes statistics.
/// </summary>
public static class NoteStatKinds
{
    public const string DailySummary = "daily.summary";
    public const string LifetimeTotals = "totals";
}

/// <summary>
/// Application-wide statistics (foreground route dwell time, launches).
/// </summary>
public static class AppStatKinds
{
    public const string DailySummary = "daily.summary";
    public const string LifetimeTotals = "totals";
}
