using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <inheritdoc />
public sealed class FlashcardStatsService : IFlashcardStatsService
{
    private readonly IFlashcardStore _store;
    private readonly IReviewRepository _reviews;
    private readonly ITestAttemptRepository _tests;
    private readonly FlashcardClock _clock;

    public FlashcardStatsService(IFlashcardStore store, IReviewRepository reviews, ITestAttemptRepository tests, FlashcardClock clock)
    {
        _store = store;
        _reviews = reviews;
        _tests = tests;
        _clock = clock;
    }

    public async Task<int> GetTrueRetentionAsync(string deckId, int windowDays = 30, CancellationToken cancellationToken = default)
    {
        windowDays = Math.Clamp(windowDays, 1, 365);
        var since = _clock.Now.AddDays(-windowDays);
        var sample = await _store.ReadAsync((conn, ct) => _reviews.GetRetentionSampleAsync(conn, deckId, since, ct), cancellationToken).ConfigureAwait(false);
        return sample.Total == 0 ? 0 : (int)Math.Round(100.0 * sample.Passed / sample.Total, MidpointRounding.AwayFromZero);
    }

    public async Task<IReadOnlyList<FlashcardRetentionTrendPoint>> GetRetentionTrendAsync(string deckId, int days = 14, CancellationToken cancellationToken = default)
    {
        days = Math.Clamp(days, 1, 90);
        var since = _clock.Now.AddDays(-(days - 1));
        var rows = await _store.ReadAsync((conn, ct) => _reviews.GetDailyRetentionAsync(conn, deckId, since, ct), cancellationToken).ConfigureAwait(false);
        var byDay = rows.ToDictionary(r => r.Day);

        var start = DateOnly.FromDateTime(since.UtcDateTime);
        var points = new List<FlashcardRetentionTrendPoint>(days);
        for (var i = 0; i < days; i++)
        {
            var day = start.AddDays(i);
            if (byDay.TryGetValue(day, out var r) && r.Total > 0)
                points.Add(new FlashcardRetentionTrendPoint(day, (int)Math.Round(100.0 * r.Passed / r.Total, MidpointRounding.AwayFromZero), r.Total));
            else
                points.Add(new FlashcardRetentionTrendPoint(day, 0, 0));
        }
        return points;
    }

    public Task RecordTestAttemptAsync(FlashcardTestAttempt attempt, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(attempt);
        return _store.WriteAsync((conn, tx, ct) => _tests.InsertAsync(conn, tx, attempt, ct), cancellationToken);
    }

    public async Task<FlashcardTestSummary> GetTestSummaryAsync(string deckId, CancellationToken cancellationToken = default)
    {
        var recent = await _store.ReadAsync((conn, ct) => _tests.GetRecentAsync(conn, deckId, 200, ct), cancellationToken).ConfigureAwait(false);
        if (recent.Count == 0)
            return FlashcardTestSummary.None;

        var latest = recent[0]; // GetRecent is CompletedAt DESC
        double? previous = recent.Count > 1 ? recent[1].ScorePct : null;
        var best = recent.Max(a => a.ScorePct);
        return new FlashcardTestSummary(true, latest.ScorePct, previous, best, recent.Count, latest);
    }

    public async Task<IReadOnlyList<FlashcardTestAttempt>> GetTestTrendAsync(string deckId, int lastN = 20, CancellationToken cancellationToken = default)
    {
        lastN = Math.Clamp(lastN, 1, 200);
        var recent = await _store.ReadAsync((conn, ct) => _tests.GetRecentAsync(conn, deckId, lastN, ct), cancellationToken).ConfigureAwait(false);
        // Return chronological (oldest first) for sparkline rendering.
        return recent.Reverse().ToArray();
    }
}
