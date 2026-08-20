using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
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
    /// Every answer recorded against the given cards, ordered by card and then oldest first, which
    /// is the order a history is written out in.
    /// </summary>
    /// <remarks>
    /// Joined to the cards so a card the trash is holding contributes nothing. Its history is kept
    /// and comes back with it, but the library cannot see the card, and an export of the library
    /// must not ship what it cannot see.
    /// </remarks>
    Task<IReadOnlyList<FlashcardReviewLog>> ListForCardsAsync(
        SqliteConnection conn, IReadOnlyList<string> cardIds, CancellationToken cancellationToken);

    /// <summary>
    /// Every review answered in a deck bound to <paramref name="presetId"/>, oldest first within
    /// each card. This is the training data for weight fitting, which is why it is grouped by card
    /// rather than by time: a fit replays one card's history at a time.
    /// </summary>
    /// <remarks>
    /// Rows whose deck no longer exists are left out. The table carries no foreign key, so they
    /// survive a deck delete, but nothing can say which preset they were answered under.
    /// </remarks>
    Task<IReadOnlyList<FlashcardReviewRow>> ListForPresetAsync(SqliteConnection conn, string presetId, CancellationToken cancellationToken);

    /// <summary>
    /// Passed (grade != Again) over total non-learning reviews for a deck since <paramref name="since"/>.
    /// Learning-step reviews (state after was Learning) are excluded per the retention definition.
    /// </summary>
    Task<FlashcardRetentionSample> GetRetentionSampleAsync(SqliteConnection conn, string deckId, DateTimeOffset since, CancellationToken cancellationToken);

    /// <summary>
    /// Passed/total (excluding learning-step reviews) inside each of the windows described by
    /// <paramref name="boundaries"/>. Window i runs from boundaries[i] up to boundaries[i + 1], so
    /// N + 1 boundaries describe N windows and the result holds one sample per window, in order.
    /// </summary>
    /// <remarks>
    /// The caller passes instants because a study day starts at a local hour whose distance from
    /// UTC moves with daylight saving, which the stored timestamps cannot be regrouped by in SQL.
    /// </remarks>
    Task<IReadOnlyList<FlashcardRetentionSample>> GetRetentionByWindowAsync(
        SqliteConnection conn, string deckId, IReadOnlyList<DateTimeOffset> boundaries, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class ReviewRepository : IReviewRepository
{
    public async Task<long> AppendAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardReviewLog log, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardReviews
                (CardId, DeckId, SessionId, Grade, ReviewedAt, ElapsedDays, ScheduledDays, StabilityAfter, DifficultyAfter, StateBefore, StateAfter, Origin)
            VALUES ($card, $deck, $session, $grade, $at, $elapsed, $scheduled, $stab, $diff, $before, $state, $origin);
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
        cmd.Parameters.AddWithValue("$before", log.StateBefore is { } before ? (int)before : DBNull.Value);
        cmd.Parameters.AddWithValue("$state", (int)log.StateAfter);
        cmd.Parameters.AddWithValue("$origin", (int)log.Origin);
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

    public async Task<IReadOnlyList<FlashcardReviewLog>> ListForCardsAsync(
        SqliteConnection conn, IReadOnlyList<string> cardIds, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(cardIds);
        if (cardIds.Count == 0)
            return Array.Empty<FlashcardReviewLog>();

        await using var cmd = conn.CreateCommand();
        var names = new string[cardIds.Count];
        for (var i = 0; i < cardIds.Count; i++)
        {
            names[i] = "$c" + i.ToString(CultureInfo.InvariantCulture);
            cmd.Parameters.AddWithValue(names[i], cardIds[i]);
        }

        // Only the loop counter reaches the statement text; every id is a parameter.
        cmd.CommandText = $"""
            SELECT r.Id, r.CardId, r.DeckId, r.SessionId, r.Grade, r.ReviewedAt, r.ElapsedDays,
                   r.ScheduledDays, r.StabilityAfter, r.DifficultyAfter, r.StateBefore, r.StateAfter, r.Origin
            FROM FlashcardReviews r
            JOIN FlashcardCards c ON c.Id = r.CardId AND c.TrashId IS NULL
            WHERE r.CardId IN ({string.Join(", ", names)})
            ORDER BY r.CardId, r.ReviewedAt, r.Id;
            """;

        var rows = new List<FlashcardReviewLog>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            rows.Add(new FlashcardReviewLog(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                (FlashcardReviewGrade)reader.GetInt32(4),
                FlashcardSqlMap.ReadTs(reader, 5),
                reader.GetDouble(6),
                reader.GetDouble(7),
                FlashcardSqlMap.ReadDoubleN(reader, 8),
                FlashcardSqlMap.ReadDoubleN(reader, 9),
                reader.IsDBNull(10) ? null : (FlashcardFsrsState)reader.GetInt32(10),
                (FlashcardFsrsState)reader.GetInt32(11),
                (FlashcardReviewOrigin)reader.GetInt32(12)));
        }

        return rows;
    }

    // Deliberately reads reviews from held decks and held cards too. This is the history a weight
    // fit learns from, not a picture of the library as it stands, and how someone remembered a card
    // last month stays true after they delete it. Dropping thirty days of reviews the moment
    // something is deleted, and putting them back on a restore, would move the scheduler's
    // parameters for every deck sharing the preset and then move them straight back again.
    public async Task<IReadOnlyList<FlashcardReviewRow>> ListForPresetAsync(SqliteConnection conn, string presetId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT r.Id, r.CardId, r.Grade, r.ReviewedAt, r.ElapsedDays, r.StateBefore, r.StateAfter
            FROM FlashcardReviews r
            JOIN FlashcardDecks d ON d.Id = r.DeckId
            WHERE d.PresetId = $preset
            ORDER BY r.CardId, r.ReviewedAt, r.Id;
            """;
        cmd.Parameters.AddWithValue("$preset", presetId);

        var rows = new List<FlashcardReviewRow>();
        // Rows arrive grouped by card, so one string per card is enough for the whole run.
        var cardId = string.Empty;
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var read = reader.GetString(1);
            if (!string.Equals(read, cardId, StringComparison.Ordinal))
                cardId = read;

            rows.Add(new FlashcardReviewRow(
                reader.GetInt64(0),
                cardId,
                (FlashcardReviewGrade)reader.GetInt32(2),
                FlashcardSqlMap.ReadTs(reader, 3),
                reader.GetDouble(4),
                reader.IsDBNull(5) ? null : (FlashcardFsrsState)reader.GetInt32(5),
                (FlashcardFsrsState)reader.GetInt32(6)));
        }

        return rows;
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

    public async Task<IReadOnlyList<FlashcardRetentionSample>> GetRetentionByWindowAsync(
        SqliteConnection conn, string deckId, IReadOnlyList<DateTimeOffset> boundaries, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(boundaries);
        var windows = boundaries.Count - 1;
        if (windows <= 0)
            return Array.Empty<FlashcardRetentionSample>();

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

        // ReviewedAt is written by FlashcardSqlMap.Ts, which normalises to UTC, so the stored text
        // compares against a bound exactly as the instants do. Only the loop counter reaches the
        // statement text; the bounds are parameters. StateAfter = 1 is Learning, excluded so
        // learning-step reps do not dilute retention.
        cmd.CommandText = $"""
            WITH windows(Idx, Start, Stop) AS (VALUES {values})
            SELECT w.Idx,
                   SUM(CASE WHEN r.Grade <> 1 THEN 1 ELSE 0 END),
                   COUNT(*)
            FROM windows w
            JOIN FlashcardReviews r ON r.ReviewedAt >= w.Start AND r.ReviewedAt < w.Stop
            WHERE r.DeckId = $deck AND r.StateAfter <> 1
            GROUP BY w.Idx;
            """;
        cmd.Parameters.AddWithValue("$deck", deckId);

        var samples = new FlashcardRetentionSample[windows];
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var idx = reader.GetInt32(0);
            if (idx >= 0 && idx < windows)
                samples[idx] = new FlashcardRetentionSample(reader.IsDBNull(1) ? 0 : reader.GetInt32(1), reader.GetInt32(2));
        }
        return samples;
    }
}
