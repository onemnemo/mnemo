using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview.Widgets.FlashcardStats;

/// <summary>
/// ViewModel for the flashcard <b>Activity</b> widget: reps/minutes/streak, counted across ALL
/// study modes (Review, Cram, Test alike). This is deliberately isolated from the Memory
/// (retention) and Test (score) buckets. It never reads or writes FSRS/test data, only the
/// mode-agnostic effort counters that
/// <see cref="Mnemo.Infrastructure.Services.Statistics.StatisticsRecorder.RecordFlashcardActivityAsync"/>
/// writes. Falls back to zero values when the user has not yet practiced (empty state, never throws).
/// </summary>
public partial class FlashcardStatsWidgetViewModel : WidgetViewModelBase
{
    private readonly IWidgetContext _context;

    [ObservableProperty]
    private int _cardsToday;

    [ObservableProperty]
    private int _minutesToday;

    [ObservableProperty]
    private int _sessionsToday;

    [ObservableProperty]
    private int _studyStreak;

    public FlashcardStatsWidgetViewModel(WidgetManifest manifest, WidgetInstance instance, IWidgetContext context)
        : base(manifest, instance)
    {
        _context = context;
    }

    public override async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var totals = (await _context.Statistics.GetAsync(
                StatisticsNamespaces.Flashcards,
                FlashcardStatKinds.LifetimeTotals,
                "all",
                cancellationToken)).Value;

            StudyStreak = (int)Math.Min(int.MaxValue, ReadInt(totals, "current_streak_days"));

            var dayKey = DateTimeOffset.UtcNow.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var today = (await _context.Statistics.GetAsync(
                StatisticsNamespaces.Flashcards,
                FlashcardStatKinds.DailySummary,
                dayKey,
                cancellationToken)).Value;
            CardsToday = (int)Math.Min(int.MaxValue, ReadInt(today, "cards_reviewed"));
            MinutesToday = (int)Math.Min(int.MaxValue, ReadInt(today, "minutes_studied"));
            SessionsToday = (int)Math.Min(int.MaxValue, ReadInt(today, "sessions_completed"));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _context.Logger.Error("Overview", "Loading flashcard activity widget failed.", ex);
            CardsToday = 0;
            MinutesToday = 0;
            SessionsToday = 0;
            StudyStreak = 0;
        }
    }

    private static long ReadInt(StatisticsRecord? record, string field)
    {
        if (record == null) return 0L;
        return record.Fields.TryGetValue(field, out var v) && v.Type == StatValueType.Integer
            ? v.AsInt()
            : 0L;
    }
}
