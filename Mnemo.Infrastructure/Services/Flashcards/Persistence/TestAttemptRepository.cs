using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>Row-level access to <c>FlashcardTestAttempts</c> (the isolated Test bucket).</summary>
public interface ITestAttemptRepository
{
    Task InsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardTestAttempt attempt, CancellationToken cancellationToken);
    Task<IReadOnlyList<FlashcardTestAttempt>> GetRecentAsync(SqliteConnection conn, string deckId, int limit, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class TestAttemptRepository : ITestAttemptRepository
{
    private const string SelectColumns =
        "Id, DeckId, StartedAt, CompletedAt, CardsTested, GotItCount, CloseCount, MissedCount, ScorePct";

    public async Task InsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardTestAttempt attempt, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardTestAttempts
                (Id, DeckId, StartedAt, CompletedAt, CardsTested, GotItCount, CloseCount, MissedCount, ScorePct)
            VALUES ($id, $deck, $started, $completed, $tested, $got, $close, $missed, $score);
            """;
        cmd.Parameters.AddWithValue("$id", attempt.Id);
        cmd.Parameters.AddWithValue("$deck", attempt.DeckId);
        cmd.Parameters.AddWithValue("$started", FlashcardSqlMap.Ts(attempt.StartedAt));
        cmd.Parameters.AddWithValue("$completed", FlashcardSqlMap.Ts(attempt.CompletedAt));
        cmd.Parameters.AddWithValue("$tested", attempt.CardsTested);
        cmd.Parameters.AddWithValue("$got", attempt.GotItCount);
        cmd.Parameters.AddWithValue("$close", attempt.CloseCount);
        cmd.Parameters.AddWithValue("$missed", attempt.MissedCount);
        cmd.Parameters.AddWithValue("$score", attempt.ScorePct);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<FlashcardTestAttempt>> GetRecentAsync(SqliteConnection conn, string deckId, int limit, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardTestAttempts WHERE DeckId = $deck ORDER BY CompletedAt DESC LIMIT $limit;";
        cmd.Parameters.AddWithValue("$deck", deckId);
        cmd.Parameters.AddWithValue("$limit", Math.Max(1, limit));
        var list = new List<FlashcardTestAttempt>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            list.Add(new FlashcardTestAttempt(
                reader.GetString(0),
                reader.GetString(1),
                FlashcardSqlMap.ReadTs(reader, 2),
                FlashcardSqlMap.ReadTs(reader, 3),
                reader.GetInt32(4),
                reader.GetInt32(5),
                reader.GetInt32(6),
                reader.GetInt32(7),
                reader.GetDouble(8)));
        }
        return list;
    }
}
