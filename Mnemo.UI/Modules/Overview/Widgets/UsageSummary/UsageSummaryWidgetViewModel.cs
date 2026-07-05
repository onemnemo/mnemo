using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview.Widgets.UsageSummary;

/// <summary>
/// ViewModel for the Usage widget. Settings: <c>period_days</c> (7/14/30/90) scopes the
/// headline metric and the per-area screen-time rows; <c>metric</c> selects the headline
/// ("review_count" = cards reviewed in the period, "time_spent" = total screen time in the
/// period). Launches and notes-created stay lifetime totals.
/// </summary>
public partial class UsageSummaryWidgetViewModel : WidgetViewModelBase
{
    private readonly IWidgetContext _context;

    [ObservableProperty]
    private string _metricLabel = string.Empty;

    [ObservableProperty]
    private string _metricValueDisplay = "—";

    [ObservableProperty]
    private string _launchCountDisplay = "—";

    [ObservableProperty]
    private string _notesCreatedDisplay = "—";

    [ObservableProperty]
    private string _practiceLabel = string.Empty;

    [ObservableProperty]
    private string _practiceTodayDisplay = "—";

    [ObservableProperty]
    private string _notesEditorLabel = string.Empty;

    [ObservableProperty]
    private string _notesEditorTodayDisplay = "—";

    [ObservableProperty]
    private string _flashcardsLabel = string.Empty;

    [ObservableProperty]
    private string _flashcardsModuleTodayDisplay = "—";

    public UsageSummaryWidgetViewModel(WidgetManifest manifest, WidgetInstance instance, IWidgetContext context)
        : base(manifest, instance)
    {
        _context = context;
    }

    public override async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        var periodDays = Math.Max(1, GetIntSetting("period_days"));
        var reviewMetric = !string.Equals(GetStringSetting("metric"), "time_spent", StringComparison.Ordinal);
        UpdateLabels(periodDays, reviewMetric);

        try
        {
            var cutoffUtc = DateTimeOffset.UtcNow.UtcDateTime.Date.AddDays(-(periodDays - 1));

            var appTotals = (await _context.Statistics.GetAsync(
                StatisticsNamespaces.App,
                AppStatKinds.LifetimeTotals,
                "all",
                cancellationToken)).Value;
            var notesTotals = (await _context.Statistics.GetAsync(
                StatisticsNamespaces.Notes,
                NoteStatKinds.LifetimeTotals,
                "all",
                cancellationToken)).Value;

            long practiceSeconds = 0, notesSeconds = 0, flashcardsSeconds = 0;
            var appDaily = await _context.Statistics.QueryAsync(new StatisticsQuery
            {
                Namespace = StatisticsNamespaces.App,
                Kind = AppStatKinds.DailySummary,
                Limit = 120,
                OrderByUpdatedDescending = true
            }, cancellationToken);

            if (appDaily.IsSuccess && appDaily.Value != null)
            {
                foreach (var record in appDaily.Value)
                {
                    if (!IsDayInWindow(record.Key, cutoffUtc))
                        continue;
                    practiceSeconds += ReadInt(record, "practice_seconds");
                    notesSeconds += ReadInt(record, "notes_editor_seconds");
                    flashcardsSeconds += ReadInt(record, "flashcards_module_seconds");
                }
            }

            if (reviewMetric)
            {
                long cardsReviewed = 0;
                var flashcardDaily = await _context.Statistics.QueryAsync(new StatisticsQuery
                {
                    Namespace = StatisticsNamespaces.Flashcards,
                    Kind = FlashcardStatKinds.DailySummary,
                    Limit = 120,
                    OrderByUpdatedDescending = true
                }, cancellationToken);

                if (flashcardDaily.IsSuccess && flashcardDaily.Value != null)
                {
                    foreach (var record in flashcardDaily.Value)
                    {
                        if (IsDayInWindow(record.Key, cutoffUtc))
                            cardsReviewed += ReadInt(record, "cards_reviewed");
                    }
                }

                MetricValueDisplay = FormatCount(cardsReviewed);
            }
            else
            {
                MetricValueDisplay = FormatDuration(practiceSeconds + notesSeconds + flashcardsSeconds);
            }

            LaunchCountDisplay = FormatCount(ReadInt(appTotals, "app_launch_count"));
            NotesCreatedDisplay = FormatCount(ReadInt(notesTotals, "total_notes_created"));
            PracticeTodayDisplay = FormatDuration(practiceSeconds);
            NotesEditorTodayDisplay = FormatDuration(notesSeconds);
            FlashcardsModuleTodayDisplay = FormatDuration(flashcardsSeconds);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _context.Logger.Error("Overview", "Usage summary widget failed to load.", ex);
            MetricValueDisplay = LaunchCountDisplay = NotesCreatedDisplay =
                PracticeTodayDisplay = NotesEditorTodayDisplay = FlashcardsModuleTodayDisplay = "—";
        }
    }

    private void UpdateLabels(int periodDays, bool reviewMetric)
    {
        var periodFormat = _context.Localization.T("LabelWithPeriod", "UsageSummary");
        string WithPeriod(string key) => string.Format(
            CultureInfo.CurrentCulture, periodFormat, _context.Localization.T(key, "UsageSummary"), periodDays);

        MetricLabel = WithPeriod(reviewMetric ? "CardsReviewedMetric" : "TimeSpentMetric");
        PracticeLabel = WithPeriod("Practice");
        NotesEditorLabel = WithPeriod("NotesEditor");
        FlashcardsLabel = WithPeriod("FlashcardsArea");
    }

    private static bool IsDayInWindow(string dayKey, DateTime cutoffUtc)
        => DateTime.TryParseExact(dayKey, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)
           && day >= cutoffUtc;

    private static string FormatCount(long v)
        => v.ToString("N0", CultureInfo.CurrentCulture);

    private string FormatDuration(long seconds)
    {
        if (seconds <= 0)
            return "0";

        if (seconds < 60)
            return string.Format(CultureInfo.CurrentCulture, _context.Localization.T("DurationSeconds", "UsageSummary"), seconds);

        var minutes = seconds / 60;
        if (seconds < 3600)
            return string.Format(CultureInfo.CurrentCulture, _context.Localization.T("DurationMinutes", "UsageSummary"), minutes);

        var hours = seconds / 3600;
        var remMin = (seconds % 3600) / 60;
        return remMin > 0
            ? string.Format(CultureInfo.CurrentCulture, _context.Localization.T("DurationHoursMinutes", "UsageSummary"), hours, remMin)
            : string.Format(CultureInfo.CurrentCulture, _context.Localization.T("DurationHours", "UsageSummary"), hours);
    }

    private static long ReadInt(StatisticsRecord? record, string field)
    {
        if (record == null) return 0L;
        return record.Fields.TryGetValue(field, out var v) && v.Type == StatValueType.Integer
            ? v.AsInt()
            : 0L;
    }
}
