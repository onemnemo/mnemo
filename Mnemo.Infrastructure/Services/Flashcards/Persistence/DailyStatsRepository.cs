using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Row-level access to <c>FlashcardDailyStats</c>. The <c>Date</c> key is the local day frozen at
/// review time by the caller; this repository never derives or rewrites it.
/// </summary>
public interface IDailyStatsRepository
{
    Task<FlashcardDailyStat> GetAsync(SqliteConnection conn, string deckId, string localDay, CancellationToken cancellationToken);

    /// <summary>
    /// Adds the given deltas to today's row, creating it if absent, floored at zero. A negative
    /// delta undoes a prior increment; the floor is what stops an undo replayed past its own
    /// increment, or one reaching a row a purge already reset, from carrying the count negative
    /// and inflating tomorrow's budget.
    /// </summary>
    Task IncrementAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string localDay, int newDelta, int reviewsDelta, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class DailyStatsRepository : IDailyStatsRepository
{
    public async Task<FlashcardDailyStat> GetAsync(SqliteConnection conn, string deckId, string localDay, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT NewIntroduced, ReviewsDone FROM FlashcardDailyStats WHERE DeckId = $deck AND Date = $day LIMIT 1;";
        cmd.Parameters.AddWithValue("$deck", deckId);
        cmd.Parameters.AddWithValue("$day", localDay);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            return new FlashcardDailyStat(deckId, localDay, reader.GetInt32(0), reader.GetInt32(1));
        return new FlashcardDailyStat(deckId, localDay, 0, 0);
    }

    public async Task IncrementAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string localDay, int newDelta, int reviewsDelta, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardDailyStats (DeckId, Date, NewIntroduced, ReviewsDone)
            VALUES ($deck, $day, MAX(0, $new), MAX(0, $reviews))
            ON CONFLICT(DeckId, Date) DO UPDATE SET
                NewIntroduced = MAX(0, NewIntroduced + $new),
                ReviewsDone   = MAX(0, ReviewsDone + $reviews);
            """;
        cmd.Parameters.AddWithValue("$deck", deckId);
        cmd.Parameters.AddWithValue("$day", localDay);
        cmd.Parameters.AddWithValue("$new", newDelta);
        cmd.Parameters.AddWithValue("$reviews", reviewsDelta);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }
}
