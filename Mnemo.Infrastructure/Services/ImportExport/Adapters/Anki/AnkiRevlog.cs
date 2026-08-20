using System;
using System.Collections.Generic;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

/// <summary>One row of an Anki collection's review log, in the columns it keeps.</summary>
/// <param name="Id">When the answer was given, in milliseconds since the epoch. Also its key.</param>
/// <param name="CardId">The card row the answer was given against.</param>
/// <param name="Ease">The button pressed, one to four. Anything else is not an answer.</param>
/// <param name="Interval">
/// The interval the answer set, positive in whole days and negative in seconds.
/// </param>
/// <param name="LastInterval">The interval the card had waited, spelled the same way.</param>
/// <param name="Type">Which queue the answer was given from.</param>
internal sealed record AnkiRevlogRow(long Id, long CardId, int Ease, int Interval, int LastInterval, int Type);

/// <summary>
/// Turns an Anki review log into review rows, and review rows back into one.
/// </summary>
/// <remarks>
/// Only what the other app recorded crosses. There is deliberately no stability or difficulty on
/// an imported answer: no published mapping turns another algorithm's ease factor into FSRS memory
/// state, and an invented one would read as a measurement of somebody's memory.
/// </remarks>
internal static class AnkiRevlog
{
    /// <summary>Answered from the learning queue.</summary>
    public const int TypeLearn = 0;

    /// <summary>Answered from the review queue.</summary>
    public const int TypeReview = 1;

    /// <summary>Answered from the relearning queue after a lapse.</summary>
    public const int TypeRelearn = 2;

    /// <summary>Anki's own default ease factor, in permille, for a card nothing is known about.</summary>
    private const int DefaultFactor = 2500;

    private const int SecondsPerDay = 86400;

    /// <summary>Whether a row records somebody answering a scheduled card.</summary>
    /// <remarks>
    /// Two kinds of row are left out. Setting a due date by hand, or a reschedule the app did on
    /// its own, is written into the same table with no button pressed, and reading one as an answer
    /// would invent a grade nobody gave. An answer given inside a filtered deck, which is that
    /// app's cram, is left out too: practice off the schedule is not recorded when somebody does it
    /// here, so it is not taken in from elsewhere, and the review log is what the scheduler learns
    /// from.
    /// </remarks>
    public static bool IsAnswer(AnkiRevlogRow row) =>
        row is not null
        && row.Id > 0
        && row.Ease is >= 1 and <= 4
        && row.Type is TypeLearn or TypeReview or TypeRelearn;

    /// <summary>
    /// One card's answers as review rows, oldest first.
    /// </summary>
    /// <param name="rows">That card's rows, in any order. Rows that are not answers are dropped.</param>
    /// <remarks>
    /// <para>
    /// The state an answer ended in comes from the interval it set: a day or more means the card
    /// went back to the review queue, anything shorter means it is still stepping, through learning
    /// or through relearning depending on which queue the answer came from. Both are recorded
    /// columns, so nothing is guessed.
    /// </para>
    /// <para>
    /// The state an answer started from is the state the one before it ended in, and the first
    /// answer on a card starts from New. That is what the card was before anybody saw it, and it is
    /// also what lets weight fitting replay the card at all: a chain has to start somewhere the
    /// model can start it.
    /// </para>
    /// </remarks>
    public static IReadOnlyList<FlashcardReviewLog> ToReviewLogs(
        string cardId, string deckId, string sessionId, IEnumerable<AnkiRevlogRow> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        var answers = new List<AnkiRevlogRow>();
        foreach (var row in rows)
        {
            if (IsAnswer(row))
                answers.Add(row);
        }

        if (answers.Count == 0)
            return Array.Empty<FlashcardReviewLog>();

        answers.Sort(static (a, b) => a.Id.CompareTo(b.Id));

        var logs = new List<FlashcardReviewLog>(answers.Count);
        var state = FlashcardFsrsState.New;
        foreach (var row in answers)
        {
            var scheduledDays = ToDays(row.Interval);
            var after = scheduledDays >= 1d
                ? FlashcardFsrsState.Review
                : row.Type == TypeLearn ? FlashcardFsrsState.Learning : FlashcardFsrsState.Relearning;

            logs.Add(new FlashcardReviewLog(
                FlashcardReviewLog.Unassigned,
                cardId,
                deckId,
                sessionId,
                (FlashcardReviewGrade)row.Ease,
                DateTimeOffset.FromUnixTimeMilliseconds(row.Id),
                ToDays(row.LastInterval),
                scheduledDays,
                StabilityAfter: null,
                DifficultyAfter: null,
                state,
                after,
                FlashcardReviewOrigin.Imported));

            state = after;
        }

        return logs;
    }

    /// <summary>One review row as the columns an Anki review log holds.</summary>
    /// <param name="log">The answer to write out.</param>
    /// <param name="id">
    /// The key the row takes, which is the instant it was answered in milliseconds unless something
    /// already holds that key.
    /// </param>
    public static AnkiRevlogRow FromReviewLog(FlashcardReviewLog log, long id)
    {
        ArgumentNullException.ThrowIfNull(log);

        // The queue an answer came from is the state it started in. A row written before that state
        // was recorded falls back to the state it ended in, which is the closest thing it has.
        var queue = (log.StateBefore ?? log.StateAfter) switch
        {
            FlashcardFsrsState.New or FlashcardFsrsState.Learning => TypeLearn,
            FlashcardFsrsState.Relearning => TypeRelearn,
            _ => TypeReview,
        };

        return new AnkiRevlogRow(
            id,
            CardId: 0,
            Ease: (int)log.Grade,
            Interval: FromDays(log.ScheduledDays),
            LastInterval: FromDays(log.ElapsedDays),
            Type: queue);
    }

    /// <summary>The ease factor an exported row carries.</summary>
    /// <remarks>
    /// FSRS keeps no ease factor, and there is no mapping from stability and difficulty onto one.
    /// The receiving app only ever shows this number, so the value a card it had never seen would
    /// start on is the honest thing to write: it says nothing rather than something untrue.
    /// </remarks>
    public static int ExportFactor => DefaultFactor;

    /// <summary>An interval in the two units Anki spells one in, as plain days.</summary>
    private static double ToDays(int raw) =>
        raw >= 0 ? raw : Math.Max(0d, -(double)raw / SecondsPerDay);

    /// <summary>
    /// Days back into the two units, whole days for a gap of a day or more and negative seconds for
    /// anything shorter, which is exactly how the value was read.
    /// </summary>
    private static int FromDays(double days)
    {
        if (days >= 1d)
            return (int)Math.Round(days, MidpointRounding.AwayFromZero);
        if (days <= 0d)
            return 0;
        return -(int)Math.Round(days * SecondsPerDay, MidpointRounding.AwayFromZero);
    }
}
