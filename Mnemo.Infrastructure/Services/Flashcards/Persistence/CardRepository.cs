using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>Card content counts for a deck.</summary>
public readonly record struct FlashcardDeckCardCounts(int Total, int Active, int Suspended);

/// <summary>
/// Row-level access to <c>FlashcardCards</c> (content only). Scheduling lives in
/// <see cref="IScheduleRepository"/>; the paged query joins the two into <see cref="FlashcardView"/>.
/// </summary>
public interface ICardRepository
{
    Task<Flashcard?> GetAsync(SqliteConnection conn, string cardId, CancellationToken cancellationToken);
    Task<IReadOnlyList<Flashcard>> ListByDeckAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken);
    Task<FlashcardDeckCardCounts> GetCountsAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken);
    Task<FlashcardCardPage> GetPageAsync(SqliteConnection conn, FlashcardCardQuery query, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// Active card+schedule views for building a study queue: optionally filtered to a set of FSRS
    /// states and/or a due cutoff, ordered by due date, capped at <paramref name="limit"/>.
    /// </summary>
    Task<IReadOnlyList<FlashcardView>> GetActiveViewsAsync(SqliteConnection conn, string deckId, IReadOnlyList<int>? fsrsStates, DateTimeOffset? dueOnOrBefore, int limit, CancellationToken cancellationToken);
    Task<IReadOnlyList<Flashcard>> SearchAsync(SqliteConnection conn, string text, FlashcardSearchScope scope, int limit, CancellationToken cancellationToken);

    Task InsertAsync(SqliteConnection conn, SqliteTransaction tx, Flashcard card, CancellationToken cancellationToken);

    /// <summary>Insert-or-update by id (migration path). Uses ON CONFLICT DO UPDATE — never REPLACE,
    /// so the 1:1 scheduling row is not cascade-deleted.</summary>
    Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, Flashcard card, CancellationToken cancellationToken);

    Task UpdateAsync(SqliteConnection conn, SqliteTransaction tx, Flashcard card, CancellationToken cancellationToken);
    Task DeleteManyAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, CancellationToken cancellationToken);
    Task MoveManyAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, string targetDeckId, DateTimeOffset now, CancellationToken cancellationToken);
    Task SetSuspendedAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, bool suspended, DateTimeOffset now, CancellationToken cancellationToken);
    Task SetFlaggedAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, bool flagged, DateTimeOffset now, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class CardRepository : ICardRepository
{
    private const string SelectColumns =
        "c.Id, c.DeckId, c.Type, c.Front, c.Back, c.TagsJson, c.State, c.IsFlagged, c.AttachmentsJson, " +
        "c.SourceType, c.SourceId, c.SourceLabel, c.CreatedAt, c.UpdatedAt";

    private const string ScheduleColumns =
        "s.CardId, s.DueDate, s.Stability, s.Difficulty, s.Reps, s.Lapses, s.FsrsState, s.LearningStepIndex, s.LastReviewedAt";

    public async Task<Flashcard?> GetAsync(SqliteConnection conn, string cardId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardCards c WHERE c.Id = $id LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", cardId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? ReadCard(reader, 0) : null;
    }

    public async Task<IReadOnlyList<Flashcard>> ListByDeckAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardCards c WHERE c.DeckId = $deck ORDER BY c.CreatedAt;";
        cmd.Parameters.AddWithValue("$deck", deckId);
        var list = new List<Flashcard>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(ReadCard(reader, 0));
        return list;
    }

    public async Task<FlashcardDeckCardCounts> GetCountsAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT COUNT(*),
                   SUM(CASE WHEN State = 0 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN State = 1 THEN 1 ELSE 0 END)
            FROM FlashcardCards WHERE DeckId = $deck;
            """;
        cmd.Parameters.AddWithValue("$deck", deckId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            return new FlashcardDeckCardCounts(0, 0, 0);
        var total = reader.IsDBNull(0) ? 0 : reader.GetInt32(0);
        var active = reader.IsDBNull(1) ? 0 : reader.GetInt32(1);
        var suspended = reader.IsDBNull(2) ? 0 : reader.GetInt32(2);
        return new FlashcardDeckCardCounts(total, active, suspended);
    }

    public async Task<FlashcardCardPage> GetPageAsync(SqliteConnection conn, FlashcardCardQuery query, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var where = new StringBuilder("WHERE c.DeckId = $deck");
        void Bind(SqliteCommand c)
        {
            c.Parameters.AddWithValue("$deck", query.DeckId);
            c.Parameters.AddWithValue("$now", FlashcardSqlMap.Ts(now));
            if (!string.IsNullOrWhiteSpace(query.Text))
                c.Parameters.AddWithValue("$text", "%" + query.Text.Trim() + "%");
            if (!string.IsNullOrWhiteSpace(query.Tag))
                c.Parameters.AddWithValue("$tag", query.Tag);
        }

        switch (query.State)
        {
            case FlashcardCardStateFilter.Due:
                where.Append(" AND c.State = 0 AND s.DueDate <= $now");
                break;
            case FlashcardCardStateFilter.New:
                where.Append(" AND c.State = 0 AND s.FsrsState = 0");
                break;
            case FlashcardCardStateFilter.Learning:
                where.Append(" AND c.State = 0 AND s.FsrsState IN (1, 3)");
                break;
            case FlashcardCardStateFilter.Suspended:
                where.Append(" AND c.State = 1");
                break;
            case FlashcardCardStateFilter.Flagged:
                where.Append(" AND c.IsFlagged = 1");
                break;
        }

        if (!string.IsNullOrWhiteSpace(query.Text))
            where.Append(" AND (c.Front LIKE $text OR c.Back LIKE $text)");
        if (!string.IsNullOrWhiteSpace(query.Tag))
            where.Append(" AND EXISTS (SELECT 1 FROM json_each(c.TagsJson) WHERE json_each.value = $tag)");

        var joined = $"FROM FlashcardCards c JOIN FlashcardScheduling s ON s.CardId = c.Id {where}";

        int total;
        await using (var countCmd = conn.CreateCommand())
        {
            countCmd.CommandText = $"SELECT COUNT(*) {joined};";
            Bind(countCmd);
            total = Convert.ToInt32(await countCmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false));
        }

        var orderColumn = query.Sort switch
        {
            FlashcardCardSort.Front => "c.Front COLLATE NOCASE",
            FlashcardCardSort.Type => "c.Type",
            FlashcardCardSort.Reps => "s.Reps",
            FlashcardCardSort.Lapses => "s.Lapses",
            FlashcardCardSort.Created => "c.CreatedAt",
            _ => "s.DueDate"
        };
        var direction = query.SortDescending ? "DESC" : "ASC";

        var items = new List<FlashcardView>();
        await using (var pageCmd = conn.CreateCommand())
        {
            pageCmd.CommandText =
                $"SELECT {SelectColumns}, {ScheduleColumns} {joined} ORDER BY {orderColumn} {direction}, c.Id LIMIT $limit OFFSET $offset;";
            Bind(pageCmd);
            pageCmd.Parameters.AddWithValue("$limit", Math.Max(1, query.Limit));
            pageCmd.Parameters.AddWithValue("$offset", Math.Max(0, query.Offset));
            await using var reader = await pageCmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var card = ReadCard(reader, 0);
                var schedule = ReadSchedule(reader, 14);
                items.Add(new FlashcardView(card, schedule));
            }
        }

        return new FlashcardCardPage(items, total, query.Offset, query.Limit);
    }

    public async Task<IReadOnlyList<FlashcardView>> GetActiveViewsAsync(SqliteConnection conn, string deckId, IReadOnlyList<int>? fsrsStates, DateTimeOffset? dueOnOrBefore, int limit, CancellationToken cancellationToken)
    {
        if (limit <= 0)
            return Array.Empty<FlashcardView>();

        var where = new StringBuilder("WHERE c.DeckId = $deck AND c.State = 0");
        if (fsrsStates is { Count: > 0 })
            where.Append(" AND s.FsrsState IN (").Append(string.Join(", ", fsrsStates)).Append(')');
        if (dueOnOrBefore is not null)
            where.Append(" AND s.DueDate <= $due");

        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            $"SELECT {SelectColumns}, {ScheduleColumns} FROM FlashcardCards c " +
            $"JOIN FlashcardScheduling s ON s.CardId = c.Id {where} ORDER BY s.DueDate, c.Id LIMIT $limit;";
        cmd.Parameters.AddWithValue("$deck", deckId);
        cmd.Parameters.AddWithValue("$limit", limit);
        if (dueOnOrBefore is not null)
            cmd.Parameters.AddWithValue("$due", FlashcardSqlMap.Ts(dueOnOrBefore.Value));

        var list = new List<FlashcardView>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(new FlashcardView(ReadCard(reader, 0), ReadSchedule(reader, 14)));
        return list;
    }

    public async Task<IReadOnlyList<Flashcard>> SearchAsync(SqliteConnection conn, string text, FlashcardSearchScope scope, int limit, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(text))
            return Array.Empty<Flashcard>();

        await using var cmd = conn.CreateCommand();
        var stateClause = scope == FlashcardSearchScope.IncludeSuspended ? string.Empty : "AND c.State = 0";
        // Rank best match first (bm25 ascending), tie-break by most-recently edited.
        cmd.CommandText = $"""
            SELECT {SelectColumns}
            FROM FlashcardCardsFts fts
            JOIN FlashcardCards c ON c.rowid = fts.rowid
            WHERE FlashcardCardsFts MATCH $q {stateClause}
            ORDER BY bm25(FlashcardCardsFts, 3.0, 2.0, 1.0), c.UpdatedAt DESC
            LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$q", BuildFtsQuery(text));
        cmd.Parameters.AddWithValue("$limit", Math.Max(1, limit));
        var list = new List<Flashcard>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(ReadCard(reader, 0));
        return list;
    }

    public async Task InsertAsync(SqliteConnection conn, SqliteTransaction tx, Flashcard card, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardCards
                (Id, DeckId, Type, Front, Back, FrontRich, BackRich, TagsJson, State, IsFlagged,
                 AttachmentsJson, SourceType, SourceId, SourceLabel, CreatedAt, UpdatedAt)
            VALUES ($id, $deck, $type, $front, $back, NULL, NULL, $tags, $state, $flagged,
                 $attach, $srcType, $srcId, $srcLabel, $created, $updated);
            """;
        BindCard(cmd, card);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, Flashcard card, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardCards
                (Id, DeckId, Type, Front, Back, FrontRich, BackRich, TagsJson, State, IsFlagged,
                 AttachmentsJson, SourceType, SourceId, SourceLabel, CreatedAt, UpdatedAt)
            VALUES ($id, $deck, $type, $front, $back, NULL, NULL, $tags, $state, $flagged,
                 $attach, $srcType, $srcId, $srcLabel, $created, $updated)
            ON CONFLICT(Id) DO UPDATE SET
                DeckId = $deck, Type = $type, Front = $front, Back = $back, TagsJson = $tags,
                State = $state, IsFlagged = $flagged, AttachmentsJson = $attach,
                SourceType = $srcType, SourceId = $srcId, SourceLabel = $srcLabel, UpdatedAt = $updated;
            """;
        BindCard(cmd, card);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateAsync(SqliteConnection conn, SqliteTransaction tx, Flashcard card, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            UPDATE FlashcardCards SET
                DeckId = $deck, Type = $type, Front = $front, Back = $back, TagsJson = $tags,
                State = $state, IsFlagged = $flagged, AttachmentsJson = $attach,
                SourceType = $srcType, SourceId = $srcId, SourceLabel = $srcLabel, UpdatedAt = $updated
            WHERE Id = $id;
            """;
        BindCard(cmd, card);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task DeleteManyAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, CancellationToken cancellationToken)
    {
        if (cardIds.Count == 0)
            return;
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        var inClause = BuildInClause(cmd, cardIds);
        cmd.CommandText = $"DELETE FROM FlashcardCards WHERE Id IN ({inClause});";
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task MoveManyAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, string targetDeckId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (cardIds.Count == 0)
            return;
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        var inClause = BuildInClause(cmd, cardIds);
        cmd.CommandText = $"UPDATE FlashcardCards SET DeckId = $deck, UpdatedAt = $now WHERE Id IN ({inClause});";
        cmd.Parameters.AddWithValue("$deck", targetDeckId);
        cmd.Parameters.AddWithValue("$now", FlashcardSqlMap.Ts(now));
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task SetSuspendedAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, bool suspended, DateTimeOffset now, CancellationToken cancellationToken) =>
        SetFlagColumnAsync(conn, tx, cardIds, "State", suspended ? 1 : 0, now, cancellationToken);

    public Task SetFlaggedAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, bool flagged, DateTimeOffset now, CancellationToken cancellationToken) =>
        SetFlagColumnAsync(conn, tx, cardIds, "IsFlagged", flagged ? 1 : 0, now, cancellationToken);

    private static async Task SetFlagColumnAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, string column, int value, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (cardIds.Count == 0)
            return;
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        var inClause = BuildInClause(cmd, cardIds);
        cmd.CommandText = $"UPDATE FlashcardCards SET {column} = $val, UpdatedAt = $now WHERE Id IN ({inClause});";
        cmd.Parameters.AddWithValue("$val", value);
        cmd.Parameters.AddWithValue("$now", FlashcardSqlMap.Ts(now));
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static string BuildInClause(SqliteCommand cmd, IReadOnlyList<string> ids)
    {
        var names = new string[ids.Count];
        for (var i = 0; i < ids.Count; i++)
        {
            names[i] = "$c" + i.ToString(CultureInfo.InvariantCulture);
            cmd.Parameters.AddWithValue(names[i], ids[i]);
        }
        return string.Join(", ", names);
    }

    private static string BuildFtsQuery(string text)
    {
        // Turn free text into a prefix-match AND query, quoting each term to neutralise FTS operators.
        var terms = text.Split(new[] { ' ', '\t', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        if (terms.Length == 0)
            return "\"\"";
        return string.Join(" AND ", terms.Select(t => "\"" + t.Replace("\"", "\"\"") + "\" *"));
    }

    private static void BindCard(SqliteCommand cmd, Flashcard card)
    {
        var now = card.UpdatedAt == default ? DateTimeOffset.UtcNow : card.UpdatedAt;
        cmd.Parameters.AddWithValue("$id", card.Id);
        cmd.Parameters.AddWithValue("$deck", card.DeckId);
        cmd.Parameters.AddWithValue("$type", (int)card.Type);
        cmd.Parameters.AddWithValue("$front", card.Front);
        cmd.Parameters.AddWithValue("$back", card.Back);
        cmd.Parameters.AddWithValue("$tags", FlashcardSqlMap.Tags(card.Tags));
        cmd.Parameters.AddWithValue("$state", (int)card.State);
        cmd.Parameters.AddWithValue("$flagged", card.IsFlagged ? 1 : 0);
        cmd.Parameters.AddWithValue("$attach", FlashcardSqlMap.Attachments(card.Attachments));
        cmd.Parameters.AddWithValue("$srcType", (object?)card.SourceInfo?.SourceType ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$srcId", (object?)card.SourceInfo?.SourceId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$srcLabel", (object?)card.SourceInfo?.DisplayLabel ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$created", FlashcardSqlMap.Ts(card.CreatedAt == default ? now : card.CreatedAt));
        cmd.Parameters.AddWithValue("$updated", FlashcardSqlMap.Ts(now));
    }

    private static Flashcard ReadCard(SqliteDataReader reader, int offset)
    {
        var sourceType = FlashcardSqlMap.ReadStringN(reader, offset + 9);
        var sourceId = FlashcardSqlMap.ReadStringN(reader, offset + 10);
        var sourceLabel = FlashcardSqlMap.ReadStringN(reader, offset + 11);
        FlashcardSourceInfo? source = sourceType is not null && sourceId is not null
            ? new FlashcardSourceInfo(sourceType, sourceId, sourceLabel)
            : null;

        return new Flashcard(
            Id: reader.GetString(offset + 0),
            DeckId: reader.GetString(offset + 1),
            Type: (FlashcardType)reader.GetInt32(offset + 2),
            Front: reader.GetString(offset + 3),
            Back: reader.GetString(offset + 4),
            Tags: FlashcardSqlMap.ReadTags(reader.GetString(offset + 5)),
            State: (FlashcardCardState)reader.GetInt32(offset + 6),
            IsFlagged: reader.GetInt32(offset + 7) != 0,
            Attachments: FlashcardSqlMap.ReadAttachments(reader.GetString(offset + 8)),
            SourceInfo: source,
            FrontBlocks: null,
            BackBlocks: null,
            CreatedAt: FlashcardSqlMap.ReadTs(reader, offset + 12),
            UpdatedAt: FlashcardSqlMap.ReadTs(reader, offset + 13));
    }

    private static FlashcardSchedule ReadSchedule(SqliteDataReader reader, int offset) => new(
        CardId: reader.GetString(offset + 0),
        DueDate: FlashcardSqlMap.ReadTs(reader, offset + 1),
        Stability: FlashcardSqlMap.ReadDoubleN(reader, offset + 2),
        Difficulty: FlashcardSqlMap.ReadDoubleN(reader, offset + 3),
        Reps: reader.GetInt32(offset + 4),
        Lapses: reader.GetInt32(offset + 5),
        FsrsState: (FlashcardFsrsState)reader.GetInt32(offset + 6),
        LearningStepIndex: reader.GetInt32(offset + 7),
        LastReviewedAt: FlashcardSqlMap.ReadTsN(reader, offset + 8));
}
