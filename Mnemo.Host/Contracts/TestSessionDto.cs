using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// The Test queue: every active card of a deck, in the order they will be asked. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
/// <remarks>
/// Unlike a study session there is nothing held server-side afterwards - Test keeps no FSRS state,
/// so the whole queue crosses once and the client runs it. <see cref="StartedAt"/> is stamped here
/// and echoed back when the attempt is recorded, so the elapsed time comes from one clock rather
/// than from whatever the browser thinks the time is.
/// </remarks>
public sealed record TestQueueDto(
    string DeckId,
    string DeckName,
    DateTimeOffset StartedAt,
    IReadOnlyList<CardDto> Cards);

/// <summary>
/// Body for a retake: the cards to run again, by id. The queue is rebuilt from the deck fresh and
/// filtered to these, so a card suspended or deleted since the first run does not come back, and a
/// new <see cref="TestQueueDto.StartedAt"/> is stamped for the retake's own timing. Hand-mirrored
/// in <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
public sealed record RetakeTestQueueDto(IReadOnlyList<string> CardIds);

/// <summary>
/// Body for recording a finished attempt. The tallies are the reader's; the score is not - it is
/// derived server-side so the formula stays in one place.
/// </summary>
public sealed record RecordTestAttemptDto(DateTimeOffset StartedAt, int GotIt, int Close, int Missed);

/// <summary>
/// What the score screen renders. <see cref="Trend"/> is chronological (oldest first) and includes
/// the attempt just recorded, so a line needs at least two points before it means anything.
/// </summary>
public sealed record TestResultDto(
    double ScorePct,
    double? DeltaVsPrevious,
    bool HasBest,
    double BestScorePct,
    IReadOnlyList<double> Trend);

/// <summary>
/// Body for the study-activity record, sent when the reader leaves the test. Separate from the
/// attempt because the two are not the same event: abandoning a test halfway records the effort
/// but no score, exactly as the desktop does.
/// </summary>
public sealed record RecordTestActivityDto(DateTimeOffset StartedAt, int CardsTested);

/// <summary>
/// One finished test attempt. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side is
/// authoritative.
/// </summary>
public sealed record TestAttemptDto(
    string Id,
    string DeckId,
    DateTimeOffset StartedAt,
    DateTimeOffset CompletedAt,
    int CardsTested,
    int GotItCount,
    int CloseCount,
    int MissedCount,
    double ScorePct)
{
    public static TestAttemptDto FromModel(FlashcardTestAttempt model) => new(
        model.Id,
        model.DeckId,
        model.StartedAt,
        model.CompletedAt,
        model.CardsTested,
        model.GotItCount,
        model.CloseCount,
        model.MissedCount,
        model.ScorePct);
}

/// <summary>
/// A deck's test history at a glance: the latest score, the one before it, the best, and how many
/// attempts there are. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side is
/// authoritative.
/// </summary>
/// <remarks>
/// <see cref="DeltaVsPrevious"/> is carried rather than left to the caller to subtract. It is a
/// derived property on the domain record and null means "there is no earlier attempt to compare
/// against", which is not the same as a delta of zero; recomputing it downstream is one place too
/// many for that distinction to survive.
/// <para>
/// Scores are unrounded. Every surface rounds them differently, and a percentage rounded here
/// would be rounded twice by the ones that want a decimal.
/// </para>
/// </remarks>
public sealed record TestSummaryDto(
    bool HasAttempts,
    double LatestScorePct,
    double? PreviousScorePct,
    double BestScorePct,
    double? DeltaVsPrevious,
    int AttemptCount,
    TestAttemptDto? Latest)
{
    public static TestSummaryDto FromModel(FlashcardTestSummary model) => new(
        model.HasAttempts,
        model.LatestScorePct,
        model.PreviousScorePct,
        model.BestScorePct,
        model.DeltaVsPrevious,
        model.AttemptCount,
        model.Latest is null ? null : TestAttemptDto.FromModel(model.Latest));
}
