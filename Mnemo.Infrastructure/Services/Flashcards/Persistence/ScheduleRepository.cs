using System;
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
