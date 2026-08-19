using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>Row-level access to <c>FlashcardScheduling</c> (FSRS state, 1:1 with a card).</summary>
public interface IScheduleRepository
{
    Task<FlashcardSchedule?> GetAsync(SqliteConnection conn, string cardId, CancellationToken cancellationToken);
    Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardSchedule schedule, CancellationToken cancellationToken);

    /// <summary>
    /// Raw new/learning/due bucket counts for a deck's active cards at <paramref name="now"/>, before
    /// any daily-cap logic (which the study service applies). New cards are counted regardless of due date.
    /// </summary>
    Task<FlashcardDueCounts> GetRawDueCountsAsync(SqliteConnection conn, string deckId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// How many scheduled cards fall inside each of the windows described by
    /// <paramref name="boundaries"/>, across every deck. Window i runs from boundaries[i] up to
    /// boundaries[i + 1], so N + 1 boundaries describe N windows and the result holds one count
    /// per window, in order.
    /// </summary>
    /// <remarks>
    /// The caller passes instants rather than a day to group by, because a study day starts at a
    /// local hour whose offset from UTC moves with daylight saving. That cannot be recovered from
    /// the stored timestamps in SQL, but the caller knows the calendar and can say exactly where
    /// each day begins.
    ///
    /// New cards are excluded: their due date is an artefact of when the row was created, not a
    /// plan to show them, so counting them would put a spike on whichever day a deck was imported.
    /// </remarks>
    Task<IReadOnlyList<int>> GetScheduledCountsByWindowAsync(
        SqliteConnection conn, IReadOnlyList<DateTimeOffset> boundaries, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class ScheduleRepository : IScheduleRepository
{
    public async Task<FlashcardSchedule?> GetAsync(SqliteConnection conn, string cardId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT CardId, DueDate, Stability, Difficulty, Reps, Lapses, FsrsState, LearningStepIndex, LastReviewedAt
            FROM FlashcardScheduling WHERE CardId = $id LIMIT 1;
            """;
        cmd.Parameters.AddWithValue("$id", cardId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? Read(reader) : null;
    }

    public async Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardSchedule schedule, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardScheduling
                (CardId, DueDate, Stability, Difficulty, Reps, Lapses, FsrsState, LearningStepIndex, LastReviewedAt)
            VALUES ($id, $due, $stab, $diff, $reps, $lapses, $state, $step, $last)
            ON CONFLICT(CardId) DO UPDATE SET
                DueDate = $due, Stability = $stab, Difficulty = $diff, Reps = $reps, Lapses = $lapses,
                FsrsState = $state, LearningStepIndex = $step, LastReviewedAt = $last;
            """;
        cmd.Parameters.AddWithValue("$id", schedule.CardId);
        cmd.Parameters.AddWithValue("$due", FlashcardSqlMap.Ts(schedule.DueDate));
        cmd.Parameters.AddWithValue("$stab", (object?)schedule.Stability ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$diff", (object?)schedule.Difficulty ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$reps", schedule.Reps);
        cmd.Parameters.AddWithValue("$lapses", schedule.Lapses);
        cmd.Parameters.AddWithValue("$state", (int)schedule.FsrsState);
        cmd.Parameters.AddWithValue("$step", schedule.LearningStepIndex);
        cmd.Parameters.AddWithValue("$last", (object?)FlashcardSqlMap.TsN(schedule.LastReviewedAt) ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<FlashcardDueCounts> GetRawDueCountsAsync(SqliteConnection conn, string deckId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT
                SUM(CASE WHEN s.FsrsState = 0 THEN 1 ELSE 0 END),
                SUM(CASE WHEN s.FsrsState IN (1, 3) AND s.DueDate <= $now THEN 1 ELSE 0 END),
                SUM(CASE WHEN s.FsrsState = 2 AND s.DueDate <= $now THEN 1 ELSE 0 END)
            FROM FlashcardScheduling s
            JOIN FlashcardCards c ON c.Id = s.CardId
            WHERE c.DeckId = $deck AND c.State = 0;
            """;
        cmd.Parameters.AddWithValue("$deck", deckId);
        cmd.Parameters.AddWithValue("$now", FlashcardSqlMap.Ts(now));
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            return FlashcardDueCounts.Empty;
        var newCount = reader.IsDBNull(0) ? 0 : reader.GetInt32(0);
        var learning = reader.IsDBNull(1) ? 0 : reader.GetInt32(1);
        var due = reader.IsDBNull(2) ? 0 : reader.GetInt32(2);
        return new FlashcardDueCounts(newCount, learning, due);
    }

    public async Task<IReadOnlyList<int>> GetScheduledCountsByWindowAsync(
        SqliteConnection conn, IReadOnlyList<DateTimeOffset> boundaries, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(boundaries);
        var windows = boundaries.Count - 1;
        if (windows <= 0)
            return Array.Empty<int>();

        await using var cmd = conn.CreateCommand();
        var values = new StringBuilder();
        for (var i = 0; i < windows; i++)
        {
            if (i > 0)
                values.Append(", ");
            values.Append(CultureInfo.InvariantCulture, $"({i}, $s{i}, $e{i})");
            cmd.Parameters.AddWithValue($"$s{i}", FlashcardSqlMap.Ts(boundaries[i]));
            cmd.Parameters.AddWithValue($"$e{i}", FlashcardSqlMap.Ts(boundaries[i + 1]));
        }

        // Timestamps are written by FlashcardSqlMap.Ts, which normalises to UTC, so comparing the
        // stored text against a bound is the same as comparing the instants. Counting stays in the
        // database, and the range predicate still reaches IX_Sched_Due. Only the loop counter goes
        // into the statement text; the bounds themselves are parameters.
        cmd.CommandText = $"""
            WITH windows(Idx, Start, Stop) AS (VALUES {values})
            SELECT w.Idx, COUNT(*)
            FROM windows w
            JOIN FlashcardScheduling s ON s.DueDate >= w.Start AND s.DueDate < w.Stop
            JOIN FlashcardCards c ON c.Id = s.CardId
            WHERE c.State = 0 AND s.FsrsState <> 0
            GROUP BY w.Idx;
            """;

        var counts = new int[windows];
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var idx = reader.GetInt32(0);
            if (idx >= 0 && idx < windows)
                counts[idx] = reader.GetInt32(1);
        }
        return counts;
    }

    private static FlashcardSchedule Read(SqliteDataReader reader) => new(
        CardId: reader.GetString(0),
        DueDate: FlashcardSqlMap.ReadTs(reader, 1),
        Stability: FlashcardSqlMap.ReadDoubleN(reader, 2),
        Difficulty: FlashcardSqlMap.ReadDoubleN(reader, 3),
        Reps: reader.GetInt32(4),
        Lapses: reader.GetInt32(5),
        FsrsState: (FlashcardFsrsState)reader.GetInt32(6),
        LearningStepIndex: reader.GetInt32(7),
        LastReviewedAt: FlashcardSqlMap.ReadTsN(reader, 8));
}
