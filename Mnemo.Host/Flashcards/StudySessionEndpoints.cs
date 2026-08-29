using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Services.Statistics;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// The study session: start, grade, undo, end. Each call returns the session's whole state, so
/// the screen re-renders from one payload instead of patching what it already had.
/// </summary>
/// <remarks>
/// Review commits every grade as its own transaction the moment it happens, exactly as the
/// desktop does, so a session that is abandoned - or swept after going idle - loses nothing that
/// was already graded. Cram writes no schedule at all.
/// </remarks>
public static class StudySessionEndpoints
{
    public static void MapFlashcardStudySessions(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/study/sessions", StartAsync);
        endpoints.MapGet("/api/study/sessions/{sessionId}", GetSessionAsync);
        endpoints.MapPost("/api/study/sessions/{sessionId}/grade", GradeAsync);
        endpoints.MapPost("/api/study/sessions/{sessionId}/undo", UndoAsync);
        endpoints.MapDelete("/api/study/sessions/{sessionId}", EndAsync);
    }

    private static async Task<IResult> StartAsync(
        StartStudySessionDto body,
        StudySessionRegistry registry,
        IFlashcardStudyService study,
        IFlashcardLibraryService library,
        IFlashcardPresetService presets,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILoggerService logger,
        CancellationToken cancellationToken)
    {
        await SweepAsync(registry, statistics, studyDay, logger).ConfigureAwait(false);

        if (!FlashcardWire.TryParseSessionMode(body.Mode, out var mode))
            return Results.BadRequest(new ErrorDto("invalid_mode", $"Unknown study mode '{body.Mode}'."));

        // Test practice holds no FSRS state and runs entirely client-side; the study service
        // throws for it rather than building a queue, so it is turned away here with a reason.
        if (mode == FlashcardSessionMode.Test)
            return Results.BadRequest(new ErrorDto("unsupported_mode", "Test practice does not use a study session."));

        // An absent deck id would otherwise reach the repository as a null parameter and come
        // back as an opaque 500 from the driver.
        if (string.IsNullOrWhiteSpace(body.DeckId))
            return Results.BadRequest(new ErrorDto("deck_required", "A study session must name a deck."));

        var deck = await library.GetDeckAsync(body.DeckId, cancellationToken).ConfigureAwait(false);
        if (deck is null)
            return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{body.DeckId}'."));

        // Review always draws the scheduled queue; the engine ignores scope for it, so it is
        // pinned here rather than echoed back as though it had applied.
        var scope = mode == FlashcardSessionMode.Review
            ? FlashcardSessionScope.Due
            : FlashcardWire.ParseSessionScope(body.Scope);

        // Superseding and registering have to look atomic to another start on this deck, or both
        // end up live and grade over each other.
        var entry = await registry.StartExclusiveAsync(body.DeckId, async () =>
        {
            // Re-entering a deck supersedes whatever was left running on it.
            foreach (var superseded in registry.RemoveForDeck(body.DeckId))
                await EndEntryAsync(superseded, DateTimeOffset.UtcNow, statistics, studyDay, logger).ConfigureAwait(false);

            var session = await study
                .StartSessionAsync(new FlashcardSessionRequest(body.DeckId, mode, scope), cancellationToken)
                .ConfigureAwait(false);

            // Auto-reveal is a preset setting the session engine has no reason to carry, but the
            // screen needs it from the first paint, so it is resolved once here rather than leaving
            // the client to fetch the preset separately.
            var preset = await presets.GetPresetAsync(deck.Header.PresetId, cancellationToken).ConfigureAwait(false);
            return registry.Add(
                session, deck.Name, scope, preset?.AutoReveal ?? FlashcardAutoReveal.Off, DateTimeOffset.UtcNow);
        }, cancellationToken).ConfigureAwait(false);

        return Results.Ok(StudySessionDto.FromEntry(entry));
    }

    private static async Task<IResult> GetSessionAsync(
        string sessionId,
        StudySessionRegistry registry,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILoggerService logger,
        CancellationToken cancellationToken)
    {
        await SweepAsync(registry, statistics, studyDay, logger).ConfigureAwait(false);
        var entry = registry.Get(sessionId, DateTimeOffset.UtcNow);
        if (entry is null)
            return UnknownSession(sessionId);

        // Reads take the gate too. The state is built by walking the engine's queue, and a grade
        // mutating that list mid-walk faults the read - so a screen that refetches while the
        // reader is grading would sporadically get a 500 instead of its state.
        return await entry
            .MutateAsync(() => Task.FromResult(Results.Ok(StudySessionDto.FromEntry(entry))), cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Grades the card the client says it is looking at. The card id is required rather than
    /// implied by the queue head: over HTTP a double-tapped button or a retried request arrives
    /// twice, and grading whatever happens to be on top would put a grade - and in Review, a
    /// written schedule - on a card the reader never saw.
    /// </summary>
    private static async Task<IResult> GradeAsync(
        string sessionId,
        GradeCardDto body,
        StudySessionRegistry registry,
        CancellationToken cancellationToken)
    {
        if (!FlashcardWire.TryParseGrade(body.Grade, out var grade))
            return Results.BadRequest(new ErrorDto("invalid_grade", $"Unknown grade '{body.Grade}'."));

        if (string.IsNullOrWhiteSpace(body.CardId))
            return Results.BadRequest(new ErrorDto("card_required", "A grade must name the card it applies to."));

        var entry = registry.Get(sessionId, DateTimeOffset.UtcNow);
        if (entry is null)
            return UnknownSession(sessionId);

        return await entry.MutateAsync(async () =>
        {
            var current = entry.Session.Current;

            // Nothing left to grade is not an error: it is what the last card's grade racing an
            // unmount looks like. The unchanged state goes back and the client sees it is over.
            if (current is null)
                return Results.Ok(StudySessionDto.FromEntry(entry));

            if (!string.Equals(current.Card.Id, body.CardId, StringComparison.Ordinal))
            {
                // The duplicate of an already-applied grade lands here. Answering with the real
                // state lets the client re-render onto the card that is actually up.
                return Results.Json(
                    StudySessionDto.FromEntry(entry), statusCode: StatusCodes.Status409Conflict);
            }

            // Not the request token: the engine commits the review before it advances the queue,
            // so cancelling in between would persist a grade the session then forgets it made. A
            // local write is quick enough that seeing it through costs nothing.
            await entry.Session.GradeAsync(grade, CancellationToken.None).ConfigureAwait(false);
            entry.RecordGrade();
            return Results.Ok(StudySessionDto.FromEntry(entry));
        }, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<IResult> UndoAsync(
        string sessionId,
        StudySessionRegistry registry,
        CancellationToken cancellationToken)
    {
        var entry = registry.Get(sessionId, DateTimeOffset.UtcNow);
        if (entry is null)
            return UnknownSession(sessionId);

        return await entry.MutateAsync(async () =>
        {
            // Uncancellable for the same reason as a grade: undo reverses the stored review and
            // then restores the queue, and stopping between the two would strand the session.
            if (await entry.Session.UndoAsync(CancellationToken.None).ConfigureAwait(false))
                entry.RecordUndo();
            else
                // The engine's stack is the truth; if it has nothing left, the counter was stale.
                entry.ClearUndo();

            return Results.Ok(StudySessionDto.FromEntry(entry));
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Ends a session and records the study it represents. Idempotent: ending an already-ended
    /// session is a quiet 204, because the client sends this on unmount and cannot be sure a
    /// previous attempt landed.
    /// </summary>
    private static async Task<IResult> EndAsync(
        string sessionId,
        StudySessionRegistry registry,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILoggerService logger)
    {
        var entry = registry.Remove(sessionId);
        if (entry is null)
            return Results.NoContent();

        await EndEntryAsync(entry, DateTimeOffset.UtcNow, statistics, studyDay, logger).ConfigureAwait(false);
        return Results.NoContent();
    }

    /// <summary>
    /// Records a removed session after acquiring its gate. Cancellation applies only to the gate
    /// wait; recording remains uncancellable because the session cannot be retried.
    /// </summary>
    internal static Task EndEntryAsync(
        StudySessionEntry entry,
        DateTimeOffset endedAt,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILoggerService logger,
        CancellationToken cancellationToken = default) =>
        entry.MutateAsync(
            () => RecordActivityAsync(entry, endedAt, statistics, studyDay, logger),
            cancellationToken);

    /// <summary>
    /// Clears out sessions that went idle and records what each one studied before dropping it.
    /// </summary>
    /// <remarks>
    /// The desktop writes this record when its session object is disposed, which covers closing
    /// the screen and closing the app. A browser tab that is reloaded or closed mid-deck gets no
    /// such chance, so the sweep reports on its behalf, dated to the last request it made rather
    /// than to now - otherwise an hour of sitting idle would be counted as an hour of study.
    /// </remarks>
    private static async Task SweepAsync(
        StudySessionRegistry registry,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILoggerService logger)
    {
        foreach (var entry in registry.TakeExpired(DateTimeOffset.UtcNow))
            await EndEntryAsync(entry, entry.LastTouched, statistics, studyDay, logger).ConfigureAwait(false);
    }

    private static Task RecordActivityAsync(
        StudySessionEntry entry,
        DateTimeOffset endedAt,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILoggerService logger) =>
        StatisticsRecorder.RecordFlashcardActivityAsync(
            statistics,
            logger,
            studyDay,
            entry.Session.DeckId,
            entry.DeckName,
            FlashcardWire.SessionMode(entry.Session.Mode),
            entry.Graded,
            // Away-from-zero to match the desktop; the default would round a 30-second half
            // minute the other way.
            (int)Math.Round((endedAt - entry.StartedAt).TotalMinutes, MidpointRounding.AwayFromZero),
            endedAt);

    /// <summary>
    /// A session that has gone missing - swept after an idle hour, or lost with a host restart -
    /// is a 404 so the client can offer to start a fresh one instead of retrying forever.
    /// </summary>
    private static IResult UnknownSession(string sessionId) =>
        Results.NotFound(new ErrorDto("unknown_session", $"No study session '{sessionId}'."));
}
