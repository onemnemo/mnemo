using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>Row-level access to <c>FlashcardDecks</c> (headers only — never cards).</summary>
public interface IDeckRepository
{
    Task<IReadOnlyList<FlashcardDeckHeader>> ListHeadersAsync(SqliteConnection conn, CancellationToken cancellationToken);
    Task<FlashcardDeckHeader?> GetHeaderAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken);
    Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardDeckHeader deck, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, CancellationToken cancellationToken);
    Task MoveAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string? folderId, int sortOrder, DateTimeOffset now, CancellationToken cancellationToken);
    Task SetPresetAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string presetId, DateTimeOffset now, CancellationToken cancellationToken);
    Task SetLastStudiedAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, DateTimeOffset when, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class DeckRepository : IDeckRepository
{
    private const string SelectColumns =
        "Id, FolderId, PresetId, Name, Description, TagsJson, SortOrder, LastStudied, Icon, CreatedAt, UpdatedAt";

    public async Task<IReadOnlyList<FlashcardDeckHeader>> ListHeadersAsync(SqliteConnection conn, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardDecks ORDER BY SortOrder, Name;";
        var list = new List<FlashcardDeckHeader>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(Read(reader));
        return list;
    }

    public async Task<FlashcardDeckHeader?> GetHeaderAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardDecks WHERE Id = $id LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", deckId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? Read(reader) : null;
    }

    public async Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardDeckHeader deck, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardDecks
                (Id, FolderId, PresetId, Name, Description, TagsJson, SortOrder, LastStudied, Icon, CreatedAt, UpdatedAt)
            VALUES ($id, $folder, $preset, $name, $desc, $tags, $sort, $last, $icon, $created, $updated)
            ON CONFLICT(Id) DO UPDATE SET
                FolderId = $folder, PresetId = $preset, Name = $name, Description = $desc,
                TagsJson = $tags, SortOrder = $sort, LastStudied = $last, Icon = $icon, UpdatedAt = $updated;
            """;
        var now = deck.UpdatedAt == default ? DateTimeOffset.UtcNow : deck.UpdatedAt;
        cmd.Parameters.AddWithValue("$id", deck.Id);
        cmd.Parameters.AddWithValue("$folder", (object?)deck.FolderId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$preset", deck.PresetId);
        cmd.Parameters.AddWithValue("$name", deck.Name);
        cmd.Parameters.AddWithValue("$desc", (object?)deck.Description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$tags", FlashcardSqlMap.Tags(deck.Tags));
        cmd.Parameters.AddWithValue("$sort", deck.SortOrder);
        cmd.Parameters.AddWithValue("$last", (object?)FlashcardSqlMap.TsN(deck.LastStudied) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$icon", (object?)deck.Icon ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$created", FlashcardSqlMap.Ts(deck.CreatedAt == default ? now : deck.CreatedAt));
        cmd.Parameters.AddWithValue("$updated", FlashcardSqlMap.Ts(now));
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, CancellationToken cancellationToken)
    {
        // Facts are not owned by the deck through a foreign key, because a fact has to survive
        // things a deck row does not, so the deck's material is cleared here rather than by a
        // cascade. Doing it first lets the cards go with their facts; the deck delete then takes
        // whatever is left.
        await using (var facts = conn.CreateCommand())
        {
            facts.Transaction = tx;
            facts.CommandText = "DELETE FROM FlashcardFacts WHERE DeckId = $id;";
            facts.Parameters.AddWithValue("$id", deckId);
            await facts.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "DELETE FROM FlashcardDecks WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$id", deckId);
        var rows = await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        return rows > 0;
    }

    public async Task MoveAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string? folderId, int sortOrder, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "UPDATE FlashcardDecks SET FolderId = $folder, SortOrder = $sort, UpdatedAt = $now WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$folder", (object?)folderId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$sort", sortOrder);
        cmd.Parameters.AddWithValue("$now", FlashcardSqlMap.Ts(now));
        cmd.Parameters.AddWithValue("$id", deckId);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task SetPresetAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string presetId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "UPDATE FlashcardDecks SET PresetId = $preset, UpdatedAt = $now WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$preset", presetId);
        cmd.Parameters.AddWithValue("$now", FlashcardSqlMap.Ts(now));
        cmd.Parameters.AddWithValue("$id", deckId);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task SetLastStudiedAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, DateTimeOffset when, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "UPDATE FlashcardDecks SET LastStudied = $when, UpdatedAt = $when WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$when", FlashcardSqlMap.Ts(when));
        cmd.Parameters.AddWithValue("$id", deckId);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static FlashcardDeckHeader Read(SqliteDataReader reader) => new(
        Id: reader.GetString(0),
        FolderId: FlashcardSqlMap.ReadStringN(reader, 1),
        PresetId: reader.GetString(2),
        Name: reader.GetString(3),
        Description: FlashcardSqlMap.ReadStringN(reader, 4),
        Tags: FlashcardSqlMap.ReadTags(reader.GetString(5)),
        SortOrder: reader.GetInt32(6),
        LastStudied: FlashcardSqlMap.ReadTsN(reader, 7),
        Icon: FlashcardSqlMap.ReadStringN(reader, 8),
        CreatedAt: FlashcardSqlMap.ReadTs(reader, 9),
        UpdatedAt: FlashcardSqlMap.ReadTs(reader, 10));
}
