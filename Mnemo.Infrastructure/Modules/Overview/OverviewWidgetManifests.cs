using System.Collections.Generic;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.Infrastructure.Modules.Overview;

/// <summary>
/// The manifests of the widgets Mnemo ships on the overview board. Pure data: ids, sizing
/// contracts and setting schemas. The board's legacy layout migration reads these to seed
/// default settings and snap rescaled sizes, so they have to be available to whichever process
/// performs that migration first, not only to the one that draws the board.
/// </summary>
/// <remarks>
/// The ids are persisted in real boards and are frozen. A widget renamed in the product keeps
/// the id it shipped with.
/// </remarks>
public static class OverviewWidgetManifests
{
    /// <summary>
    /// The flashcard <b>Activity</b> widget: reps, minutes, sessions and streak, counted across
    /// all study modes. Isolated from the Memory (retention) and Test (score) buckets. Manifest
    /// id kept as <c>mnemo.flashcard-stats</c> so existing board layouts survive the rename.
    /// </summary>
    public static WidgetManifest FlashcardStats { get; } = new()
    {
        WidgetId = "mnemo.flashcard-stats",
        TranslationNamespace = "FlashcardStats",
        Author = "Mnemo",
        Category = WidgetCategory.Statistics,
        IconUri = WidgetIconAvares.Uri("FlashcardStats"),
        SupportedSizes = [new WidgetSize(2, 1), new WidgetSize(4, 1), new WidgetSize(1, 2)],
        DefaultSize = new WidgetSize(2, 1)
    };

    /// <summary>
    /// The flashcard <b>Memory</b> widget: true retention sourced only from Review, isolated
    /// from Test scores and Activity effort counters.
    /// </summary>
    public static WidgetManifest FlashcardMemory { get; } = new()
    {
        WidgetId = "mnemo.flashcard-memory",
        TranslationNamespace = "FlashcardMemory",
        Author = "Mnemo",
        Category = WidgetCategory.Statistics,
        IconUri = WidgetIconAvares.Uri("FlashcardMemory"),
        SupportedSizes = [new WidgetSize(1, 1), new WidgetSize(2, 1)],
        DefaultSize = new WidgetSize(2, 1)
    };

    /// <summary>
    /// The flashcard <b>Test</b> widget: most recently tested deck's score, isolated from
    /// Memory (retention) and Activity (effort) counters.
    /// </summary>
    public static WidgetManifest FlashcardTests { get; } = new()
    {
        WidgetId = "mnemo.flashcard-tests",
        TranslationNamespace = "FlashcardTests",
        Author = "Mnemo",
        Category = WidgetCategory.Statistics,
        IconUri = WidgetIconAvares.Uri("FlashcardTests"),
        SupportedSizes = [new WidgetSize(1, 1), new WidgetSize(2, 1)],
        DefaultSize = new WidgetSize(2, 1)
    };

    /// <summary>
    /// The Recent Decks widget: recently practiced decks joined with live deck metadata, with a
    /// configurable window, sort field, and row limit.
    /// </summary>
    public static WidgetManifest RecentDecks { get; } = new()
    {
        WidgetId = "mnemo.recent-decks",
        TranslationNamespace = "RecentDecks",
        Author = "Mnemo",
        Category = WidgetCategory.Activity,
        IconUri = WidgetIconAvares.Uri("RecentDecks"),
        SupportedSizes = [new WidgetSize(2, 1), new WidgetSize(2, 2)],
        DefaultSize = new WidgetSize(2, 1),
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

    /// <summary>
    /// The Recent Notes widget: the most recently created/edited notes, with a configurable
    /// window, sort field, and row limit.
    /// </summary>
    public static WidgetManifest RecentNotes { get; } = new()
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

    /// <summary>
    /// The Study Goals widget: progress bars for practice targets over a daily or weekly
    /// window, with the configured metric listed first.
    /// </summary>
    public static WidgetManifest StudyGoals { get; } = new()
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

    /// <summary>
    /// The Usage widget: lifetime launches/notes plus per-area screen time over a configurable
    /// period, led by the configured headline metric.
    /// </summary>
    public static WidgetManifest UsageSummary { get; } = new()
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

    /// <summary>Every built-in overview widget, in the order the board registers them.</summary>
    public static IReadOnlyList<WidgetManifest> All { get; } =
    [
        FlashcardStats,
        FlashcardMemory,
        FlashcardTests,
        RecentDecks,
        RecentNotes,
        StudyGoals,
        UsageSummary
    ];
}
