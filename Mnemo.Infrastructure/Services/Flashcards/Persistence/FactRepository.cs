using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>A card the material already made, and the layout it came from.</summary>
public readonly record struct FlashcardFactCardKey(string CardId, string LayoutKey);

/// <summary>
/// Row-level access to <c>FlashcardFacts</c>. The cards a fact makes live in
/// <see cref="ICardRepository"/>; keeping the two in step is the materializer's job.
/// </summary>
public interface IFactRepository
{
    Task<FlashcardFact?> GetAsync(SqliteConnection conn, string factId, CancellationToken cancellationToken);

    /// <summary>The material behind a card, for opening the editor from the card someone clicked.</summary>
    Task<FlashcardFact?> GetByCardAsync(SqliteConnection conn, string cardId, CancellationToken cancellationToken);

    Task<IReadOnlyList<FlashcardFact>> ListByDeckAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken);

    /// <summary>Every fact of one card type, across decks, for carrying a type edit into them.</summary>
    Task<IReadOnlyList<FlashcardFact>> ListByTypeAsync(SqliteConnection conn, string typeId, CancellationToken cancellationToken);
    Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardFact fact, CancellationToken cancellationToken);
    Task DeleteManyAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> factIds, CancellationToken cancellationToken);

    /// <summary>Which cards a fact currently has, keyed by the layout each came from.</summary>
    Task<IReadOnlyList<FlashcardFactCardKey>> GetCardKeysAsync(SqliteConnection conn, string factId, CancellationToken cancellationToken);

    /// <summary>The other cards a card shares material with, which is what burying acts on.</summary>
    Task<IReadOnlyList<string>> GetSiblingIdsAsync(SqliteConnection conn, string cardId, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class FactRepository : IFactRepository
{
    private const string SelectColumns =
        "f.Id, f.DeckId, f.TypeId, f.ValuesJson, f.MediaJson, f.TagsJson, f.IsFlagged, " +
        "f.SourceType, f.SourceId, f.SourceLabel, f.CreatedAt, f.UpdatedAt";

    private readonly ILoggerService? _logger;

    public FactRepository(ILoggerService? logger = null) => _logger = logger;

    public async Task<FlashcardFact?> GetAsync(SqliteConnection conn, string factId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardFacts f WHERE f.Id = $id LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", factId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? Read(reader) : null;
    }

    public async Task<FlashcardFact?> GetByCardAsync(SqliteConnection conn, string cardId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT {SelectColumns} FROM FlashcardFacts f
            JOIN FlashcardCards c ON c.FactId = f.Id
            WHERE c.Id = $id LIMIT 1;
            """;
        cmd.Parameters.AddWithValue("$id", cardId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? Read(reader) : null;
    }

    public async Task<IReadOnlyList<FlashcardFact>> ListByDeckAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardFacts f WHERE f.DeckId = $deck ORDER BY f.CreatedAt;";
        cmd.Parameters.AddWithValue("$deck", deckId);
        var list = new List<FlashcardFact>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(Read(reader));
        return list;
    }

    public async Task<IReadOnlyList<FlashcardFact>> ListByTypeAsync(SqliteConnection conn, string typeId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardFacts f WHERE f.TypeId = $type ORDER BY f.CreatedAt;";
        cmd.Parameters.AddWithValue("$type", typeId);
        var list = new List<FlashcardFact>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(Read(reader));
        return list;
    }

    public async Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardFact fact, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(fact);
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardFacts
                (Id, DeckId, TypeId, ValuesJson, MediaJson, TagsJson, IsFlagged,
                 SourceType, SourceId, SourceLabel, CreatedAt, UpdatedAt)
            VALUES ($id, $deck, $type, $values, $media, $tags, $flagged,
                 $srcType, $srcId, $srcLabel, $created, $updated)
            ON CONFLICT(Id) DO UPDATE SET
                DeckId = $deck, TypeId = $type, ValuesJson = $values, MediaJson = $media,
                TagsJson = $tags, IsFlagged = $flagged, SourceType = $srcType, SourceId = $srcId,
                SourceLabel = $srcLabel, UpdatedAt = $updated;
            """;
        var now = fact.UpdatedAt == default ? DateTimeOffset.UtcNow : fact.UpdatedAt;
        cmd.Parameters.AddWithValue("$id", fact.Id);
        cmd.Parameters.AddWithValue("$deck", fact.DeckId);
        cmd.Parameters.AddWithValue("$type", fact.TypeId);
        cmd.Parameters.AddWithValue("$values", FlashcardFactSqlMap.Values(fact.Values));
        cmd.Parameters.AddWithValue("$media", FlashcardFactSqlMap.Media(fact.Media));
        cmd.Parameters.AddWithValue("$tags", FlashcardSqlMap.Tags(fact.Tags));
        cmd.Parameters.AddWithValue("$flagged", fact.IsFlagged ? 1 : 0);
        cmd.Parameters.AddWithValue("$srcType", (object?)fact.SourceInfo?.SourceType ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$srcId", (object?)fact.SourceInfo?.SourceId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$srcLabel", (object?)fact.SourceInfo?.DisplayLabel ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$created", FlashcardSqlMap.Ts(fact.CreatedAt == default ? now : fact.CreatedAt));
        cmd.Parameters.AddWithValue("$updated", FlashcardSqlMap.Ts(now));
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task DeleteManyAsync(SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> factIds, CancellationToken cancellationToken)
    {
        if (factIds.Count == 0)
            return;
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        var names = new string[factIds.Count];
        for (var i = 0; i < factIds.Count; i++)
        {
            names[i] = "$f" + i.ToString(CultureInfo.InvariantCulture);
            cmd.Parameters.AddWithValue(names[i], factIds[i]);
        }
        cmd.CommandText = $"DELETE FROM FlashcardFacts WHERE Id IN ({string.Join(", ", names)});";
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<FlashcardFactCardKey>> GetCardKeysAsync(SqliteConnection conn, string factId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, LayoutKey FROM FlashcardCards WHERE FactId = $id AND LayoutKey IS NOT NULL;";
        cmd.Parameters.AddWithValue("$id", factId);
        var keys = new List<FlashcardFactCardKey>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            keys.Add(new FlashcardFactCardKey(reader.GetString(0), reader.GetString(1)));
        return keys;
    }

    public async Task<IReadOnlyList<string>> GetSiblingIdsAsync(SqliteConnection conn, string cardId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        // A card with no material has no siblings, so the join carries the null check for free.
        cmd.CommandText = """
            SELECT sibling.Id
            FROM FlashcardCards card
            JOIN FlashcardCards sibling ON sibling.FactId = card.FactId
            WHERE card.Id = $id AND sibling.Id <> $id;
            """;
        cmd.Parameters.AddWithValue("$id", cardId);
        var ids = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            ids.Add(reader.GetString(0));
        return ids;
    }

    private FlashcardFact Read(SqliteDataReader reader)
    {
        var id = reader.GetString(0);
        var sourceType = FlashcardSqlMap.ReadStringN(reader, 7);
        var sourceId = FlashcardSqlMap.ReadStringN(reader, 8);
        FlashcardSourceInfo? source = sourceType is not null && sourceId is not null
            ? new FlashcardSourceInfo(sourceType, sourceId, FlashcardSqlMap.ReadStringN(reader, 9))
            : null;

        return new FlashcardFact(
            Id: id,
            DeckId: reader.GetString(1),
            TypeId: reader.GetString(2),
            Values: FlashcardFactSqlMap.ReadValues(reader.GetString(3), _logger, $"fact {id}"),
            Media: FlashcardFactSqlMap.ReadMedia(reader.GetString(4), _logger, $"fact {id}"),
            Tags: FlashcardSqlMap.ReadTags(reader.GetString(5), _logger, $"fact {id}"),
            IsFlagged: reader.GetInt32(6) != 0,
            SourceInfo: source,
            CreatedAt: FlashcardSqlMap.ReadTs(reader, 10),
            UpdatedAt: FlashcardSqlMap.ReadTs(reader, 11));
    }
}
