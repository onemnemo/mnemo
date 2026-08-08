using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Services.Statistics;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Test practice: hand out the queue, record the attempt, record the effort. Test has its own
/// scoring domain and touches no scheduling, so there is no session to hold - the client runs the
/// queue and comes back twice.
/// </summary>
/// <remarks>
/// The two writes are deliberately separate calls. An attempt is only scored when the reader
/// finishes, while the effort counts the moment any card was graded; leaving halfway therefore
/// records study time and no score. That is the split the desktop has, where the attempt is
/// written on completion and the activity on navigating away.
/// </remarks>
public static class TestSessionEndpoints
{
    /// <summary>Upper bound on the queue; a bigger deck is truncated, because a test is a session and not the library.</summary>
    private const int MaxCards = 2000;

    /// <summary>How many past attempts the score screen's sparkline draws.</summary>
    private const int TrendLength = 10;

    /// <summary>What a trend read returns when the caller does not say. Mirrors the service's own default.</summary>
    private const int DefaultTrendLength = 20;

    public static void MapFlashcardTests(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/decks/{deckId}/test-queue", GetQueueAsync);
        endpoints.MapPost("/api/decks/{deckId}/test-attempts", RecordAttemptAsync);
        endpoints.MapPost("/api/decks/{deckId}/test-activity", RecordActivityAsync);
        endpoints.MapGet("/api/decks/{deckId}/test-summary", GetSummaryAsync);
        endpoints.MapGet("/api/decks/{deckId}/test-trend", GetTrendAsync);
    }

    /// <summary>
    /// Builds the queue: the deck's active cards in due order, or shuffled when the preset says so.
    /// </summary>
    /// <remarks>
    /// The state filter is applied here rather than asked of the query, because <c>All</c> includes
    /// suspended rows - a suspended card is out of rotation and has no business in a test.
    /// </remarks>
    private static async Task<IResult> GetQueueAsync(
        string deckId,
        IFlashcardCardService cards,
        IFlashcardLibraryService library,
        IFlashcardPresetService presets,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deckId))
            return Results.BadRequest(new ErrorDto("deck_required", "A test must name a deck."));

        var deck = await library.GetDeckAsync(deckId, cancellationToken).ConfigureAwait(false);
        if (deck is null)
            return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{deckId}'."));

        var preset = await presets.GetPresetAsync(deck.Header.PresetId, cancellationToken).ConfigureAwait(false);

        var page = await cards
            .ListCardsAsync(
                new FlashcardCardQuery(deckId, State: FlashcardCardStateFilter.All, Sort: FlashcardCardSort.Due, Limit: MaxCards),
                cancellationToken)
            .ConfigureAwait(false);

        var active = page.Items
            .Where(v => v.Card.State == FlashcardCardState.Active)
            .Select(v => CardDto.FromModel(v.Card))
            .ToArray();

        if (preset?.ShuffleOrder == true)
            Random.Shared.Shuffle(active);

        return Results.Ok(new TestQueueDto(deckId, deck.Name, DateTimeOffset.UtcNow, active));
    }

    /// <summary>
    /// Records a finished attempt and answers with everything the score screen shows.
    /// </summary>
    /// <remarks>
    /// The summary is read <i>after</i> the write, so its latest attempt is this one and the delta
    /// compares it against the one before - which is what "better than last time" has to mean.
    /// </remarks>
    private static async Task<IResult> RecordAttemptAsync(
        string deckId,
        RecordTestAttemptDto body,
        IFlashcardStatsService stats,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deckId))
            return Results.BadRequest(new ErrorDto("deck_required", "An attempt must name a deck."));

        if (body.GotIt < 0 || body.Close < 0 || body.Missed < 0)
            return Results.BadRequest(new ErrorDto("invalid_tally", "A tally cannot be negative."));

        var tested = body.GotIt + body.Close + body.Missed;
        if (tested <= 0)
            return Results.BadRequest(new ErrorDto("nothing_tested", "An attempt with no graded cards is not a score."));

        var completedAt = DateTimeOffset.UtcNow;
        // A Close counts half, which is the formula FlashcardTestAttempt.ScorePct documents.
        var scorePct = (body.GotIt + body.Close * 0.5) / tested * 100.0;

        var attempt = new FlashcardTestAttempt(
            Guid.NewGuid().ToString("N"),
            deckId,
            body.StartedAt,
            completedAt,
            tested,
            body.GotIt,
            body.Close,
            body.Missed,
            scorePct);

        await stats.RecordTestAttemptAsync(attempt, cancellationToken).ConfigureAwait(false);

        var summary = await stats.GetTestSummaryAsync(deckId, cancellationToken).ConfigureAwait(false);
        var trend = await stats.GetTestTrendAsync(deckId, TrendLength, cancellationToken).ConfigureAwait(false);

        return Results.Ok(new TestResultDto(
            scorePct,
            summary.DeltaVsPrevious,
            summary.HasAttempts,
            summary.BestScorePct,
            trend.Select(a => Math.Clamp(a.ScorePct, 0d, 100d)).ToArray()));
    }

    /// <summary>
    /// A deck's test history without recording anything, for surfaces that only read it.
    /// </summary>
    /// <remarks>
    /// Answers for a deck that does not exist rather than 404ing, matching the other stat reads on
    /// a deck route: the service reports "no attempts" for an unknown deck and for a known deck
    /// nobody has tested, and a reader has the same thing to draw either way.
    /// </remarks>
    private static async Task<IResult> GetSummaryAsync(
        string deckId,
        IFlashcardStatsService stats,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deckId))
            return Results.BadRequest(new ErrorDto("deck_required", "A summary must name a deck."));

        var summary = await stats.GetTestSummaryAsync(deckId, cancellationToken).ConfigureAwait(false);
        return Results.Ok(TestSummaryDto.FromModel(summary));
    }

    /// <summary>
    /// A deck's recent attempts, oldest first, for drawing a line through them. The service clamps
    /// how many it will hand out, so an oversized request is answered rather than refused.
    /// </summary>
    private static async Task<IResult> GetTrendAsync(
        string deckId,
        int? lastN,
        IFlashcardStatsService stats,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deckId))
            return Results.BadRequest(new ErrorDto("deck_required", "A trend must name a deck."));

        var attempts = await stats
            .GetTestTrendAsync(deckId, lastN ?? DefaultTrendLength, cancellationToken)
            .ConfigureAwait(false);

        return Results.Ok(attempts.Select(TestAttemptDto.FromModel).ToArray());
    }

    /// <summary>
    /// Records the effort a test represents, whether or not it was finished. Sent when the screen
    /// goes away, so it is idempotent-ish by being harmless: a test with nothing graded writes
    /// nothing, and the recorder itself ignores a zero count.
    /// </summary>
    private static async Task<IResult> RecordActivityAsync(
        string deckId,
        RecordTestActivityDto body,
        IFlashcardLibraryService library,
        IStatisticsManager statistics,
        ILoggerService logger,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deckId) || body.CardsTested <= 0)
            return Results.NoContent();

        var deck = await library.GetDeckAsync(deckId, cancellationToken).ConfigureAwait(false);
        var completedAt = DateTimeOffset.UtcNow;

        await StatisticsRecorder.RecordFlashcardActivityAsync(
            statistics,
            logger,
            deckId,
            deck?.Name,
            FlashcardWire.SessionMode(FlashcardSessionMode.Test),
            body.CardsTested,
            // Away-from-zero to match the desktop; the default would round a 30-second half
            // minute the other way.
            (int)Math.Round((completedAt - body.StartedAt).TotalMinutes, MidpointRounding.AwayFromZero),
            completedAt).ConfigureAwait(false);

        return Results.NoContent();
    }
}
