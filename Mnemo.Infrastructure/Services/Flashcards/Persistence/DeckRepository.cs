using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

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

    /// <summary>
    /// What every ordinary read adds so a deck the trash is holding stays out of it. Held decks keep
    /// their rows, their cards and their history until they are restored or purged.
    /// </summary>
    private const string Live = "TrashId IS NULL";

    private readonly ILoggerService? _logger;

    public DeckRepository(ILoggerService? logger = null) => _logger = logger;

    public async Task<IReadOnlyList<FlashcardDeckHeader>> ListHeadersAsync(SqliteConnection conn, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardDecks WHERE {Live} ORDER BY SortOrder, Name;";
        var list = new List<FlashcardDeckHeader>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(Read(reader));
        return list;
    }

    public async Task<FlashcardDeckHeader?> GetHeaderAsync(SqliteConnection conn, string deckId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardDecks WHERE Id = $id AND {Live} LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", deckId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? Read(reader) : null;
    }

    /// <summary>
    /// Where a save or a move actually files a deck, for the same reason a folder has one: a folder
    /// the trash is holding cannot take anything in, so the deck goes to the root rather than out
    /// of sight. A folder id with no row behind it yet is left as it is.
    /// </summary>
    private const string LiveFolder =
        "(SELECT $folder WHERE NOT EXISTS (SELECT 1 FROM FlashcardFolders WHERE Id = $folder AND TrashId IS NOT NULL))";

    public async Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardDeckHeader deck, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"""
            INSERT INTO FlashcardDecks
                (Id, FolderId, PresetId, Name, Description, TagsJson, SortOrder, LastStudied, Icon, CreatedAt, UpdatedAt)
            VALUES ($id, {LiveFolder}, $preset, $name, $desc, $tags, $sort, $last, $icon, $created, $updated)
            ON CONFLICT(Id) DO UPDATE SET
                FolderId = {LiveFolder}, PresetId = $preset, Name = $name, Description = $desc,
                TagsJson = $tags, SortOrder = $sort, LastStudied = $last, Icon = $icon, UpdatedAt = $updated
            WHERE TrashId IS NULL;
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
        // things a deck row does not: a card it made can be moved to another deck and go on
        // needing it. Deleting one here regardless of that would take a card the user kept
        // elsewhere down with it, so material cleanup is the caller's job, done only for a fact
        // that this delete leaves with nothing behind it anywhere.
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"DELETE FROM FlashcardDecks WHERE Id = $id AND {Live};";
        cmd.Parameters.AddWithValue("$id", deckId);
        var rows = await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        return rows > 0;
    }

    public async Task MoveAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string? folderId, int sortOrder, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText =
            $"UPDATE FlashcardDecks SET FolderId = {LiveFolder}, SortOrder = $sort, UpdatedAt = $now WHERE Id = $id AND {Live};";
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
        cmd.CommandText = $"UPDATE FlashcardDecks SET PresetId = $preset, UpdatedAt = $now WHERE Id = $id AND {Live};";
        cmd.Parameters.AddWithValue("$preset", presetId);
        cmd.Parameters.AddWithValue("$now", FlashcardSqlMap.Ts(now));
        cmd.Parameters.AddWithValue("$id", deckId);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task SetLastStudiedAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, DateTimeOffset when, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"UPDATE FlashcardDecks SET LastStudied = $when, UpdatedAt = $when WHERE Id = $id AND {Live};";
        cmd.Parameters.AddWithValue("$when", FlashcardSqlMap.Ts(when));
        cmd.Parameters.AddWithValue("$id", deckId);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private FlashcardDeckHeader Read(SqliteDataReader reader)
    {
        var id = reader.GetString(0);
        return new FlashcardDeckHeader(
            Id: id,
            FolderId: FlashcardSqlMap.ReadStringN(reader, 1),
            PresetId: reader.GetString(2),
            Name: reader.GetString(3),
            Description: FlashcardSqlMap.ReadStringN(reader, 4),
            Tags: FlashcardSqlMap.ReadTags(reader.GetString(5), _logger, $"deck {id}"),
            SortOrder: reader.GetInt32(6),
            LastStudied: FlashcardSqlMap.ReadTsN(reader, 7),
            Icon: FlashcardSqlMap.ReadStringN(reader, 8),
            CreatedAt: FlashcardSqlMap.ReadTs(reader, 9),
            UpdatedAt: FlashcardSqlMap.ReadTs(reader, 10));
    }
}
