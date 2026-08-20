using System;
using System.Threading.Tasks;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
namespace Mnemo.UI.Services;

/// <summary>
/// When the shell navigates between routes, attributes dwell time to coarse buckets (practice vs notes vs flashcards UI)
/// on today's <see cref="AppStatKinds.DailySummary"/> record. Best-effort only; failures are logged and ignored.
/// </summary>
public sealed class NavigationStatisticsTracker
{
    private readonly IStatisticsManager _statistics;
    private readonly IStudyDayService _studyDay;
    private readonly ILoggerService _logger;
    private DateTimeOffset _segmentStartedUtc = DateTimeOffset.UtcNow;

    public NavigationStatisticsTracker(
        INavigationService navigation,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILoggerService logger)
    {
        _statistics = statistics ?? throw new ArgumentNullException(nameof(statistics));
        _studyDay = studyDay ?? throw new ArgumentNullException(nameof(studyDay));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        navigation.Navigated += OnNavigated;
    }

    private void OnNavigated(object? sender, NavigationChangedEventArgs e)
    {
        var now = DateTimeOffset.UtcNow;
        if (!string.IsNullOrEmpty(e.PreviousRoute))
        {
            var secs = (long)Math.Clamp((now - _segmentStartedUtc).TotalSeconds, 0, int.MaxValue);
            if (secs > 0)
                _ = FlushSegmentAsync(e.PreviousRoute!, secs);
        }

        _segmentStartedUtc = now;
    }

    private async Task FlushSegmentAsync(string route, long seconds)
    {
        try
        {
            var dayKey = await _studyDay.TodayKeyAsync().ConfigureAwait(false);
            MapRoute(route, seconds, out var practice, out var notes, out var flashMod);

            if (practice > 0)
            {
                await _statistics.IncrementAsync(
                    StatisticsNamespaces.App,
                    AppStatKinds.DailySummary,
                    dayKey,
                    "practice_seconds",
                    practice,
                    StatisticsNamespaces.App).ConfigureAwait(false);
            }
            if (notes > 0)
            {
                await _statistics.IncrementAsync(
                    StatisticsNamespaces.App,
                    AppStatKinds.DailySummary,
                    dayKey,
                    "notes_editor_seconds",
                    notes,
                    StatisticsNamespaces.App).ConfigureAwait(false);
            }
            if (flashMod > 0)
            {
                await _statistics.IncrementAsync(
                    StatisticsNamespaces.App,
                    AppStatKinds.DailySummary,
                    dayKey,
                    "flashcards_module_seconds",
                    flashMod,
                    StatisticsNamespaces.App).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            _logger.Error("Statistics", $"Navigation dwell flush failed for route '{route}'.", ex);
        }
    }

    private static void MapRoute(string route, long seconds, out long practice, out long notes, out long flashcardsModule)
    {
        practice = notes = flashcardsModule = 0;
        if (string.Equals(route, "notes", StringComparison.Ordinal))
        {
            notes += seconds;
            return;
        }
        // "flashcard-session" (review/cram) and "flashcard-test" are active recall time and count
        // as practice; other flashcard routes (library, deck browsing) count as general module time.
        if (string.Equals(route, "flashcard-session", StringComparison.Ordinal) ||
            string.Equals(route, "flashcard-test", StringComparison.Ordinal))
        {
            practice += seconds;
            return;
        }
        if (route.StartsWith("flashcard", StringComparison.Ordinal))
            flashcardsModule += seconds;
    }
}
