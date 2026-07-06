using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>Sample of scheduled-review outcomes used to compute true retention.</summary>
public readonly record struct FlashcardRetentionSample(int Passed, int Total);

/// <summary>Append-only access to <c>FlashcardReviews</c> plus the queries stats reads from it.</summary>
public interface IReviewRepository
{
    /// <summary>Appends a review row and returns its assigned autoincrement id (for exact undo).</summary>
    Task<long> AppendAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardReviewLog log, CancellationToken cancellationToken);

    /// <summary>Removes a review row by id (undo path).</summary>
    Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, long reviewId, CancellationToken cancellationToken);

    /// <summary>Count of review rows for a deck (test hook / diagnostics).</summary>
    Task<int> CountForDeckAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken);

    /// <summary>
    /// Passed (grade != Again) over total non-learning reviews for a deck since <paramref name="since"/>.
    /// Learning-step reviews (state after was Learning) are excluded per the retention definition.
    /// </summary>
    Task<FlashcardRetentionSample> GetRetentionSampleAsync(SqliteConnection conn, string deckId, DateTimeOffset since, CancellationToken cancellationToken);

    /// <summary>Per-UTC-day passed/total (excluding learning-step reviews) since <paramref name="since"/>.</summary>
    Task<IReadOnlyList<FlashcardDailyRetention>> GetDailyRetentionAsync(SqliteConnection conn, string deckId, DateTimeOffset since, CancellationToken cancellationToken);
}

/// <summary>Passed/total scheduled reviews grouped by a single UTC day.</summary>
public readonly record struct FlashcardDailyRetention(DateOnly Day, int Passed, int Total);

/// <inheritdoc />
public sealed class ReviewRepository : IReviewRepository
{
    public async Task<long> AppendAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardReviewLog log, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardReviews
                (CardId, DeckId, SessionId, Grade, ReviewedAt, ElapsedDays, ScheduledDays, StabilityAfter, DifficultyAfter, StateAfter)
            VALUES ($card, $deck, $session, $grade, $at, $elapsed, $scheduled, $stab, $diff, $state);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$card", log.CardId);
        cmd.Parameters.AddWithValue("$deck", log.DeckId);
        cmd.Parameters.AddWithValue("$session", log.SessionId);
        cmd.Parameters.AddWithValue("$grade", (int)log.Grade);
        cmd.Parameters.AddWithValue("$at", FlashcardSqlMap.Ts(log.ReviewedAt));
        cmd.Parameters.AddWithValue("$elapsed", log.ElapsedDays);
        cmd.Parameters.AddWithValue("$scheduled", log.ScheduledDays);
        cmd.Parameters.AddWithValue("$stab", (object?)log.StabilityAfter ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$diff", (object?)log.DifficultyAfter ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$state", (int)log.StateAfter);
        var id = await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return Convert.ToInt64(id);
    }

    public async Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, long reviewId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "DELETE FROM FlashcardReviews WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$id", reviewId);
        var rows = await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        return rows > 0;
    }

    public async Task<int> CountForDeckAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM FlashcardReviews WHERE DeckId = $deck;";
        cmd.Parameters.AddWithValue("$deck", deckId);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false));
    }

    public async Task<FlashcardRetentionSample> GetRetentionSampleAsync(SqliteConnection conn, string deckId, DateTimeOffset since, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        // StateAfter = 1 is Learning; exclude those so learning-step reps don't dilute retention.
        cmd.CommandText = """
            SELECT
                SUM(CASE WHEN Grade <> 1 THEN 1 ELSE 0 END),
                COUNT(*)
            FROM FlashcardReviews
            WHERE DeckId = $deck AND ReviewedAt >= $since AND StateAfter <> 1;
            """;
        cmd.Parameters.AddWithValue("$deck", deckId);
        cmd.Parameters.AddWithValue("$since", FlashcardSqlMap.Ts(since));
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            return new FlashcardRetentionSample(0, 0);
        var passed = reader.IsDBNull(0) ? 0 : reader.GetInt32(0);
        var total = reader.GetInt32(1);
        return new FlashcardRetentionSample(passed, total);
    }

    public async Task<IReadOnlyList<FlashcardDailyRetention>> GetDailyRetentionAsync(SqliteConnection conn, string deckId, DateTimeOffset since, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        // ReviewedAt is stored as ISO-8601 UTC ("O"); substr(1,10) is the yyyy-MM-dd day.
        cmd.CommandText = """
            SELECT substr(ReviewedAt, 1, 10) AS Day,
                   SUM(CASE WHEN Grade <> 1 THEN 1 ELSE 0 END),
                   COUNT(*)
            FROM FlashcardReviews
            WHERE DeckId = $deck AND ReviewedAt >= $since AND StateAfter <> 1
            GROUP BY Day ORDER BY Day;
            """;
        cmd.Parameters.AddWithValue("$deck", deckId);
        cmd.Parameters.AddWithValue("$since", FlashcardSqlMap.Ts(since));
        var list = new List<FlashcardDailyRetention>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            if (DateOnly.TryParse(reader.GetString(0), out var day))
                list.Add(new FlashcardDailyRetention(day, reader.IsDBNull(1) ? 0 : reader.GetInt32(1), reader.GetInt32(2)));
        }
        return list;
    }
}
