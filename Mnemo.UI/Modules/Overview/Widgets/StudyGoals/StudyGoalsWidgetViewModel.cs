using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview.Widgets.StudyGoals;

/// <summary>
/// Represents a single study goal item.
/// </summary>
public partial class StudyGoalItem : ObservableObject
{
    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private int _target;

    [ObservableProperty]
    private int _completed;

    public string ProgressText => $"{Completed}/{Target}";
}

/// <summary>
/// ViewModel for the Study Goals widget. Settings: <c>goal_type</c> ("daily" reads today's
/// summary, "weekly" sums the last 7 daily summaries with targets ×7) and <c>metric</c>
/// ("cards" or "minutes" — the chosen metric's goal is listed first).
/// </summary>
public partial class StudyGoalsWidgetViewModel : WidgetViewModelBase
{
    private const int DailyCardsTarget = 50;
    private const int DailySessionsTarget = 3;
    private const int DailyMinutesTarget = 30;
    private const int WeekDays = 7;

    private readonly IWidgetContext _context;

    public ObservableCollection<StudyGoalItem> Goals { get; } = new();

    public StudyGoalsWidgetViewModel(WidgetManifest manifest, WidgetInstance instance, IWidgetContext context)
        : base(manifest, instance)
    {
        _context = context;
    }

    public override async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        var weekly = string.Equals(GetStringSetting("goal_type"), "weekly", StringComparison.Ordinal);
        var minutesFirst = string.Equals(GetStringSetting("metric"), "minutes", StringComparison.Ordinal);
        var targetScale = weekly ? WeekDays : 1;

        long cardsReviewed = 0, minutesStudied = 0, sessionsCompleted = 0;
        try
        {
            var days = weekly ? WeekDays : 1;
            var today = await _context.StudyDay.TodayAsync(cancellationToken);
            for (var offset = 0; offset < days; offset++)
            {
                var dayKey = IStudyDayService.KeyOf(today.AddDays(-offset));
                var record = (await _context.Statistics.GetAsync(
                    StatisticsNamespaces.Flashcards,
                    FlashcardStatKinds.DailySummary,
                    dayKey,
                    cancellationToken)).Value;

                cardsReviewed += ReadInt(record, "cards_reviewed");
                minutesStudied += ReadInt(record, "minutes_studied");
                sessionsCompleted += ReadInt(record, "sessions_completed");
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _context.Logger.Error("Overview", "Loading study goals widget failed.", ex);
            cardsReviewed = minutesStudied = sessionsCompleted = 0;
        }

        var cardsGoal = CreateGoal("CardsReviewed", DailyCardsTarget * targetScale, cardsReviewed);
        var sessionsGoal = CreateGoal("SessionsCompleted", DailySessionsTarget * targetScale, sessionsCompleted);
        var minutesGoal = CreateGoal("MinutesStudied", DailyMinutesTarget * targetScale, minutesStudied);

        var ordered = minutesFirst
            ? new List<StudyGoalItem> { minutesGoal, cardsGoal, sessionsGoal }
            : new List<StudyGoalItem> { cardsGoal, sessionsGoal, minutesGoal };

        Goals.Clear();
        foreach (var goal in ordered)
            Goals.Add(goal);
    }

    private StudyGoalItem CreateGoal(string titleKey, int target, long completed) => new()
    {
        Title = _context.Localization.T(titleKey, "StudyGoals"),
        Target = target,
        Completed = (int)Math.Min(completed, target)
    };

    private static long ReadInt(StatisticsRecord? record, string field)
    {
        if (record == null) return 0L;
        return record.Fields.TryGetValue(field, out var v) && v.Type == StatValueType.Integer
            ? v.AsInt()
            : 0L;
    }
}
