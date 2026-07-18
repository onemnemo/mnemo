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
