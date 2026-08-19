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
    private readonly IDeckRepository _decks;
    private readonly IPresetRepository _presets;
    private readonly FlashcardClock _clock;

    public FlashcardStatsService(
        IFlashcardStore store,
        IReviewRepository reviews,
        ITestAttemptRepository tests,
        IDeckRepository decks,
        IPresetRepository presets,
        FlashcardClock clock)
    {
        _store = store;
        _reviews = reviews;
        _tests = tests;
        _decks = decks;
        _presets = presets;
        _clock = clock;
    }

    public async Task<int> GetTrueRetentionAsync(string deckId, int windowDays = 30, CancellationToken cancellationToken = default)
    {
        windowDays = Math.Clamp(windowDays, 1, 365);
        var since = _clock.Now.AddDays(-windowDays);
        var sample = await _store.ReadAsync(async (conn, ct) =>
        {
            // Review rows carry no foreign key to the deck, so they outlive one that gets deleted.
            // Reading them back for a deck that is gone would answer with real numbers for
            // material nobody can open anymore; checked here so a dead deck reads exactly like one
            // that never had any reviews.
            if (await _decks.GetHeaderAsync(conn, deckId, ct).ConfigureAwait(false) is null)
                return new FlashcardRetentionSample(0, 0);
            return await _reviews.GetRetentionSampleAsync(conn, deckId, since, ct).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);
        return sample.Total == 0 ? 0 : (int)Math.Round(100.0 * sample.Passed / sample.Total, MidpointRounding.AwayFromZero);
    }

    public Task<IReadOnlyList<FlashcardRetentionTrendPoint>> GetRetentionTrendAsync(string deckId, int days = 14, CancellationToken cancellationToken = default)
    {
        var span = Math.Clamp(days, 1, 90);
        return _store.ReadAsync<IReadOnlyList<FlashcardRetentionTrendPoint>>(async (conn, ct) =>
        {
            // The trend is read against the deck's own study days, the same ones the daily caps are
            // charged to, so an evening review shows up on the day the user counts it as.
            var now = _clock.Now;
            var header = await _decks.GetHeaderAsync(conn, deckId, ct).ConfigureAwait(false);
            var preset = header is null
                ? null
                : await _presets.GetAsync(conn, header.PresetId, ct).ConfigureAwait(false);
            var hour = (preset ?? FlashcardPreset.CreateStandard(now)).DayStartHour;

            var start = _clock.Today(hour).AddDays(-(span - 1));
            var boundaries = new DateTimeOffset[span + 1];
            for (var i = 0; i <= span; i++)
                boundaries[i] = _clock.StartOf(start.AddDays(i), hour);

            // A deck that is gone gets the same empty samples a live one with no reviews yet would,
            // rather than the review rows it left behind, which carry no foreign key and so survive
            // its delete.
            var samples = header is null
                ? new FlashcardRetentionSample[span]
                : await _reviews.GetRetentionByWindowAsync(conn, deckId, boundaries, ct).ConfigureAwait(false);

            var points = new List<FlashcardRetentionTrendPoint>(span);
            for (var i = 0; i < span; i++)
            {
                var sample = samples[i];
                var pct = sample.Total == 0 ? 0 : (int)Math.Round(100.0 * sample.Passed / sample.Total, MidpointRounding.AwayFromZero);
                points.Add(new FlashcardRetentionTrendPoint(start.AddDays(i), pct, sample.Total));
            }
            return points;
        }, cancellationToken);
    }

    public Task RecordTestAttemptAsync(FlashcardTestAttempt attempt, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(attempt);
        return _store.WriteAsync((conn, tx, ct) => _tests.InsertAsync(conn, tx, attempt, ct), cancellationToken);
    }

    public async Task<FlashcardTestSummary> GetTestSummaryAsync(string deckId, CancellationToken cancellationToken = default)
    {
        var recent = await _store.ReadAsync(async (conn, ct) =>
        {
            // Same reasoning as the retention reads above: attempts carry no foreign key to the
            // deck, so a deleted deck's history has to be checked for rather than trusted.
            if (await _decks.GetHeaderAsync(conn, deckId, ct).ConfigureAwait(false) is null)
                return Array.Empty<FlashcardTestAttempt>();
            return await _tests.GetRecentAsync(conn, deckId, 200, ct).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);
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
        var recent = await _store.ReadAsync(async (conn, ct) =>
        {
            if (await _decks.GetHeaderAsync(conn, deckId, ct).ConfigureAwait(false) is null)
                return Array.Empty<FlashcardTestAttempt>();
            return await _tests.GetRecentAsync(conn, deckId, lastN, ct).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);
        // Return chronological (oldest first) for sparkline rendering.
        return recent.Reverse().ToArray();
    }
}
