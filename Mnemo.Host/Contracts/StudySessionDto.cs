using Mnemo.Core.Models.Flashcards;
using Mnemo.Host.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// What remains in the queue, split by FSRS state, plus the completed/total pair behind the
/// progress bar. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
/// <remarks>
/// New, Learning and Due count cards <i>still to see</i>, while Completed counts cards that have
/// left the queue for good, so the four do not add up to Total mid-session: a card graded back
/// into a learning step is in neither group until it graduates.
/// </remarks>
public sealed record StudyProgressDto(int New, int Learning, int Due, int Completed, int Total)
{
    public static StudyProgressDto FromModel(FlashcardSessionProgress model)
        => new(model.New, model.Learning, model.Due, model.Completed, model.Total);
}

/// <summary>
/// The next-interval preview under each grade button ("10m", "3d"), for the card currently on
/// screen.
/// </summary>
/// <remarks>
/// Recomputed on every response, where the desktop computes them once when the card is presented
/// and leaves them alone. The previews are relative to now, so the learning-step ones are
/// constant and a review-step one can drift by a day's rounding if the client refetches while
/// the same card sits on screen. Freezing them would mean caching per presentation and keeping
/// that cache correct across undo, which is a lot of machinery for a label.
/// </remarks>
public sealed record StudyIntervalsDto(string Again, string Hard, string Good, string Easy)
{
    public static StudyIntervalsDto FromSession(Mnemo.Core.Services.IFlashcardSession session)
        => new(
            session.DescribeInterval(FlashcardReviewGrade.Again),
            session.DescribeInterval(FlashcardReviewGrade.Hard),
            session.DescribeInterval(FlashcardReviewGrade.Good),
            session.DescribeInterval(FlashcardReviewGrade.Easy));
}

/// <summary>
/// The whole state of a live study session. Every endpoint returns this, so the client renders
/// from one shape and never has to reconcile a partial update against what it already had.
/// </summary>
/// <remarks>
/// <para>
/// The card crosses as its stored text - cloze markers included. Masking the front and revealing
/// the answer is presentation, and the helper that does it lives in the Avalonia UI assembly the
/// host does not reference; the SPA owns that rendering.
/// </para>
/// <para>
/// <see cref="StartedEmpty"/> and <see cref="IsFinished"/> are both true for a session that had
/// nothing to study. Together with <see cref="Mode"/> that is what tells "all caught up" from
/// "session complete" without the server deciding which panel to show: only a Review that
/// started empty is caught up, since a Cram with nothing in scope shows the ordinary completion
/// screen on the desktop.
/// </para>
/// <para>
/// <see cref="Current"/> is the card as the queue captured it when the session started, which is
/// also true of the desktop's engine. Editing a card mid-session therefore does not change what
/// comes back here; the desktop re-reads the card and overlays the display, and a client has to
/// do the same rather than re-rendering this field afterwards.
/// </para>
/// </remarks>
public sealed record StudySessionDto(
    string SessionId,
    string DeckId,
    string DeckName,
    string Mode,
    string Scope,
    bool WritesSchedule,
    string AutoReveal,
    bool StartedEmpty,
    bool IsFinished,
    bool CanUndo,
    int Graded,
    CardDto? Current,
    StudyProgressDto Progress,
    StudyIntervalsDto? Intervals)
{
    public static StudySessionDto FromEntry(StudySessionEntry entry)
    {
        var session = entry.Session;
        var current = session.Current;
        return new StudySessionDto(
            entry.Id,
            session.DeckId,
            entry.DeckName,
            FlashcardWire.SessionMode(session.Mode),
            FlashcardWire.SessionScope(entry.Scope),
            session.WritesSchedule,
            FlashcardWire.AutoReveal(entry.AutoReveal),
            entry.StartedEmpty,
            session.IsFinished,
            entry.Graded > 0,
            entry.Graded,
            current is null ? null : CardDto.FromModel(current.Card),
            StudyProgressDto.FromModel(session.Progress),
            current is null ? null : StudyIntervalsDto.FromSession(session));
    }
}

/// <summary>
/// Start body. Scope only applies to Cram - a Review session always draws the scheduled queue -
/// and defaults to due-only when absent.
/// </summary>
public sealed record StartStudySessionDto(string DeckId, string Mode, string? Scope);

/// <summary>
/// Grade body. <see cref="CardId"/> names the card the reader was actually looking at; a grade
/// that does not match the card at the head of the queue is refused rather than applied to
/// whatever came next.
/// </summary>
public sealed record GradeCardDto(string CardId, string Grade);
