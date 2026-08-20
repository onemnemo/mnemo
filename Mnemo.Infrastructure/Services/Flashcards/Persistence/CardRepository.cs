using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

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

    /// <summary>
    /// The material behind the cards filed in one deck, whichever deck each piece of material itself
    /// names. Material stays filed where it was written while a card it made is moved to another
    /// deck, so asking the material where it lives finds neither the material a delete is about to
    /// strip of its last card nor, on its own, the material that will be left untouched.
    /// </summary>
    /// <remarks>
    /// Deliberately all owned, held cards included: deleting the deck destroys those too, so their
    /// material is left with just as little behind it as the live ones' is.
    /// </remarks>
    Task<IReadOnlyList<string>> ListFactIdsInDeckAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken);

    /// <summary>
    /// Where a piece of material really sits: the deck its oldest card is filed in, or null when it
    /// has no cards at all. A live card wins over one the trash is holding.
    /// </summary>
    /// <remarks>Deliberately all owned, for the same reason the card keys read is.</remarks>
    Task<string?> GetFactDeckAsync(SqliteConnection conn, string factId, CancellationToken cancellationToken);

    Task<FlashcardDeckCardCounts> GetCountsAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken);
    Task<FlashcardCardPage> GetPageAsync(SqliteConnection conn, FlashcardCardQuery query, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// Active card+schedule views for building a study queue: optionally filtered to a set of FSRS
    /// states and/or a due cutoff, ordered by due date, capped at <paramref name="limit"/>.
    /// </summary>
    /// <param name="notBuriedAt">
    /// When set, cards buried past this instant are left out, and the cap is spent on cards that can
    /// actually be shown. Null asks for the queue burying does not apply to.
    /// </param>
    Task<IReadOnlyList<FlashcardView>> GetActiveViewsAsync(SqliteConnection conn, string deckId, IReadOnlyList<int>? fsrsStates, DateTimeOffset? dueOnOrBefore, int limit, DateTimeOffset? notBuriedAt, CancellationToken cancellationToken);
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
        "c.SourceType, c.SourceId, c.SourceLabel, c.CreatedAt, c.UpdatedAt, c.FactId, c.LayoutKey";

    /// <summary>How many columns <see cref="SelectColumns"/> reads, for callers that select more.</summary>
    private const int CardColumnCount = 16;

    /// <summary>
    /// What every ordinary read adds so a card the trash is holding stays out of it. Held cards keep
    /// their rows, their schedules and their review history, and are simply not part of the library
    /// until they are restored.
    /// </summary>
    private const string Live = "c.TrashId IS NULL";

    private const string ScheduleColumns =
        "s.CardId, s.DueDate, s.Stability, s.Difficulty, s.Reps, s.Lapses, s.FsrsState, s.LearningStepIndex, " +
        "s.LastReviewedAt, s.BuriedUntil";

    private readonly ILoggerService? _logger;

    public CardRepository(ILoggerService? logger = null) => _logger = logger;

    public async Task<Flashcard?> GetAsync(SqliteConnection conn, string cardId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardCards c WHERE c.Id = $id AND {Live} LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", cardId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? ReadCard(reader, 0) : null;
    }

    public async Task<IReadOnlyList<Flashcard>> ListByDeckAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardCards c WHERE c.DeckId = $deck AND {Live} ORDER BY c.CreatedAt;";
        cmd.Parameters.AddWithValue("$deck", deckId);
        var list = new List<Flashcard>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(ReadCard(reader, 0));
        return list;
    }

    public async Task<IReadOnlyList<string>> ListFactIdsInDeckAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT DISTINCT FactId FROM FlashcardCards WHERE DeckId = $deck AND FactId IS NOT NULL;";
        cmd.Parameters.AddWithValue("$deck", deckId);
        var ids = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            ids.Add(reader.GetString(0));
        return ids;
    }

    public async Task<string?> GetFactDeckAsync(SqliteConnection conn, string factId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT DeckId FROM FlashcardCards
            WHERE FactId = $fact
            ORDER BY (TrashId IS NULL) DESC, CreatedAt, Id
            LIMIT 1;
            """;
        cmd.Parameters.AddWithValue("$fact", factId);
        return await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
    }

    public async Task<FlashcardDeckCardCounts> GetCountsAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT COUNT(*),
                   SUM(CASE WHEN State = 0 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN State = 1 THEN 1 ELSE 0 END)
            FROM FlashcardCards WHERE DeckId = $deck AND TrashId IS NULL;
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
        var where = new StringBuilder($"WHERE {Live}");
        void Bind(SqliteCommand c)
        {
            c.Parameters.AddWithValue("$now", FlashcardSqlMap.Ts(now));
            if (!string.IsNullOrWhiteSpace(query.DeckId))
                c.Parameters.AddWithValue("$deck", query.DeckId);
            if (!string.IsNullOrWhiteSpace(query.Text))
                c.Parameters.AddWithValue("$text", BuildFtsQuery(query.Text));
            if (!string.IsNullOrWhiteSpace(query.Tag))
                c.Parameters.AddWithValue("$tag", query.Tag);
            if (query.Type is { } type)
                c.Parameters.AddWithValue("$type", (int)type);
            if (!string.IsNullOrWhiteSpace(query.CardTypeId))
                c.Parameters.AddWithValue("$cardType", query.CardTypeId);
            if (query.MinLapses is { } min)
                c.Parameters.AddWithValue("$minLapses", min);
            if (query.MaxLapses is { } max)
                c.Parameters.AddWithValue("$maxLapses", max);
        }

        if (!string.IsNullOrWhiteSpace(query.DeckId))
            where.Append(" AND c.DeckId = $deck");

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
            where.Append(" AND c.rowid IN (SELECT rowid FROM FlashcardCardsFts WHERE FlashcardCardsFts MATCH $text)");
        if (!string.IsNullOrWhiteSpace(query.Tag))
            where.Append(" AND EXISTS (SELECT 1 FROM json_each(c.TagsJson) WHERE json_each.value = $tag)");
        if (query.Type is not null)
            where.Append(" AND c.Type = $type");
        if (!string.IsNullOrWhiteSpace(query.CardTypeId))
            where.Append(" AND EXISTS (SELECT 1 FROM FlashcardFacts f WHERE f.Id = c.FactId AND f.TypeId = $cardType AND f.TrashId IS NULL)");
        if (query.MinLapses is not null)
            where.Append(" AND s.Lapses >= $minLapses");
        if (query.MaxLapses is not null)
            where.Append(" AND s.Lapses <= $maxLapses");

        var joined =$"FROM FlashcardCards c JOIN FlashcardScheduling s ON s.CardId = c.Id {where}";

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
                var schedule = ReadSchedule(reader, CardColumnCount);
                items.Add(new FlashcardView(card, schedule));
            }
        }

        return new FlashcardCardPage(items, total, query.Offset, query.Limit);
    }

    public async Task<IReadOnlyList<FlashcardView>> GetActiveViewsAsync(SqliteConnection conn, string deckId, IReadOnlyList<int>? fsrsStates, DateTimeOffset? dueOnOrBefore, int limit, DateTimeOffset? notBuriedAt, CancellationToken cancellationToken)
    {
        if (limit <= 0)
            return Array.Empty<FlashcardView>();

        var where = new StringBuilder($"WHERE {Live} AND c.DeckId = $deck AND c.State = 0");
        if (fsrsStates is { Count: > 0 })
            where.Append(" AND s.FsrsState IN (").Append(string.Join(", ", fsrsStates)).Append(')');
        if (dueOnOrBefore is not null)
            where.Append(" AND s.DueDate <= $due");
        if (notBuriedAt is not null)
            where.Append(" AND (s.BuriedUntil IS NULL OR s.BuriedUntil <= $unburied)");

        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            $"SELECT {SelectColumns}, {ScheduleColumns} FROM FlashcardCards c " +
            $"JOIN FlashcardScheduling s ON s.CardId = c.Id {where} ORDER BY s.DueDate, c.Id LIMIT $limit;";
        cmd.Parameters.AddWithValue("$deck", deckId);
        cmd.Parameters.AddWithValue("$limit", limit);
        if (dueOnOrBefore is not null)
            cmd.Parameters.AddWithValue("$due", FlashcardSqlMap.Ts(dueOnOrBefore.Value));
        if (notBuriedAt is not null)
            cmd.Parameters.AddWithValue("$unburied", FlashcardSqlMap.Ts(notBuriedAt.Value));

        var list = new List<FlashcardView>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(new FlashcardView(ReadCard(reader, 0), ReadSchedule(reader, CardColumnCount)));
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
            WHERE FlashcardCardsFts MATCH $q AND {Live} {stateClause}
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
                 AttachmentsJson, SourceType, SourceId, SourceLabel, CreatedAt, UpdatedAt, FactId, LayoutKey)
            VALUES ($id, $deck, $type, $front, $back, NULL, NULL, $tags, $state, $flagged,
                 $attach, $srcType, $srcId, $srcLabel, $created, $updated, $fact, $key);
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
                 AttachmentsJson, SourceType, SourceId, SourceLabel, CreatedAt, UpdatedAt, FactId, LayoutKey)
            VALUES ($id, $deck, $type, $front, $back, NULL, NULL, $tags, $state, $flagged,
                 $attach, $srcType, $srcId, $srcLabel, $created, $updated, $fact, $key)
            ON CONFLICT(Id) DO UPDATE SET
                DeckId = $deck, Type = $type, Front = $front, Back = $back, TagsJson = $tags,
                State = $state, IsFlagged = $flagged, AttachmentsJson = $attach,
                SourceType = $srcType, SourceId = $srcId, SourceLabel = $srcLabel, UpdatedAt = $updated,
                FactId = $fact, LayoutKey = $key
            WHERE TrashId IS NULL;
            """;
        BindCard(cmd, card);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateAsync(SqliteConnection conn, SqliteTransaction tx, Flashcard card, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        // FactId and LayoutKey are not in the SET list: which material a card came from is not
        // something a content edit gets to change, and leaving them out means a caller holding an
        // older copy of the record cannot blank them by accident.
        cmd.CommandText = """
            UPDATE FlashcardCards SET
                DeckId = $deck, Type = $type, Front = $front, Back = $back, TagsJson = $tags,
                State = $state, IsFlagged = $flagged, AttachmentsJson = $attach,
                SourceType = $srcType, SourceId = $srcId, SourceLabel = $srcLabel, UpdatedAt = $updated
            WHERE Id = $id AND TrashId IS NULL;
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
        // A card the trash is holding is not this delete's to take. It belongs to a trash entry,
        // and only that entry finishing can destroy it.
        cmd.CommandText = $"DELETE FROM FlashcardCards WHERE Id IN ({inClause}) AND TrashId IS NULL;";
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task MoveManyAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> cardIds, string targetDeckId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (cardIds.Count == 0)
            return;
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        var inClause = BuildInClause(cmd, cardIds);
        // A deck the trash is holding cannot take cards in: moving one there would hide it until
        // the deck came back, and put it somewhere the user cannot get it out of in the meantime.
        cmd.CommandText =
            $"UPDATE FlashcardCards SET DeckId = $deck, UpdatedAt = $now WHERE Id IN ({inClause}) AND TrashId IS NULL " +
            "  AND EXISTS (SELECT 1 FROM FlashcardDecks WHERE Id = $deck AND TrashId IS NULL);";
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
        cmd.CommandText = $"UPDATE FlashcardCards SET {column} = $val, UpdatedAt = $now WHERE Id IN ({inClause}) AND TrashId IS NULL;";
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
        cmd.Parameters.AddWithValue("$fact", (object?)card.FactId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$key", (object?)card.LayoutKey ?? DBNull.Value);
    }

    private Flashcard ReadCard(SqliteDataReader reader, int offset)
    {
        var id = reader.GetString(offset + 0);
        var sourceType = FlashcardSqlMap.ReadStringN(reader, offset + 9);
        var sourceId = FlashcardSqlMap.ReadStringN(reader, offset + 10);
        var sourceLabel = FlashcardSqlMap.ReadStringN(reader, offset + 11);
        FlashcardSourceInfo? source = sourceType is not null && sourceId is not null
            ? new FlashcardSourceInfo(sourceType, sourceId, sourceLabel)
            : null;

        return new Flashcard(
            Id: id,
            DeckId: reader.GetString(offset + 1),
            Type: (FlashcardType)reader.GetInt32(offset + 2),
            Front: reader.GetString(offset + 3),
            Back: reader.GetString(offset + 4),
            Tags: FlashcardSqlMap.ReadTags(reader.GetString(offset + 5), _logger, $"card {id}"),
            State: (FlashcardCardState)reader.GetInt32(offset + 6),
            IsFlagged: reader.GetInt32(offset + 7) != 0,
            Attachments: FlashcardSqlMap.ReadAttachments(reader.GetString(offset + 8), _logger, $"card {id}"),
            SourceInfo: source,
            FrontBlocks: null,
            BackBlocks: null,
            CreatedAt: FlashcardSqlMap.ReadTs(reader, offset + 12),
            UpdatedAt: FlashcardSqlMap.ReadTs(reader, offset + 13),
            FactId: FlashcardSqlMap.ReadStringN(reader, offset + 14),
            LayoutKey: FlashcardSqlMap.ReadStringN(reader, offset + 15));
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
        LastReviewedAt: FlashcardSqlMap.ReadTsN(reader, offset + 8),
        BuriedUntil: FlashcardSqlMap.ReadTsN(reader, offset + 9));
}
