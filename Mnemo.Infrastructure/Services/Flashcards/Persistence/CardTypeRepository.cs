using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>Row-level access to <c>FlashcardCardTypes</c>.</summary>
public interface ICardTypeRepository
{
    Task<IReadOnlyList<FlashcardCardType>> ListAsync(SqliteConnection conn, CancellationToken cancellationToken);
    Task<FlashcardCardType?> GetAsync(SqliteConnection conn, string typeId, CancellationToken cancellationToken);
    Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardCardType type, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, string typeId, CancellationToken cancellationToken);

    /// <summary>How much material a type is holding, which is what makes deleting one a decision.</summary>
    Task<int> CountFactsAsync(SqliteConnection conn, string typeId, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class CardTypeRepository : ICardTypeRepository
{
    private const string SelectColumns =
        "Id, Name, IsBuiltIn, FieldsJson, SortFieldId, LayoutsJson, Generator, GenerateFrom, CreatedAt, UpdatedAt";

    private readonly ILoggerService? _logger;

    public CardTypeRepository(ILoggerService? logger = null) => _logger = logger;

    public async Task<IReadOnlyList<FlashcardCardType>> ListAsync(SqliteConnection conn, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        // Built-ins first, then by name, so the list a user scans opens with the ones they know.
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardCardTypes ORDER BY IsBuiltIn DESC, Name COLLATE NOCASE;";
        var list = new List<FlashcardCardType>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            list.Add(Read(reader));
        return list;
    }

    public async Task<FlashcardCardType?> GetAsync(SqliteConnection conn, string typeId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {SelectColumns} FROM FlashcardCardTypes WHERE Id = $id LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", typeId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? Read(reader) : null;
    }

    public async Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardCardType type, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(type);
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardCardTypes
                (Id, Name, IsBuiltIn, FieldsJson, SortFieldId, LayoutsJson, Generator, GenerateFrom, CreatedAt, UpdatedAt)
            VALUES ($id, $name, $builtIn, $fields, $sort, $layouts, $generator, $from, $created, $updated)
            ON CONFLICT(Id) DO UPDATE SET
                Name = $name, FieldsJson = $fields, SortFieldId = $sort, LayoutsJson = $layouts,
                Generator = $generator, GenerateFrom = $from, UpdatedAt = $updated;
            """;
        var now = type.UpdatedAt == default ? DateTimeOffset.UtcNow : type.UpdatedAt;
        cmd.Parameters.AddWithValue("$id", type.Id);
        cmd.Parameters.AddWithValue("$name", type.Name);
        cmd.Parameters.AddWithValue("$builtIn", type.IsBuiltIn ? 1 : 0);
        cmd.Parameters.AddWithValue("$fields", FlashcardFactSqlMap.Fields(type.Fields));
        cmd.Parameters.AddWithValue("$sort", type.SortFieldId);
        cmd.Parameters.AddWithValue("$layouts", FlashcardFactSqlMap.Layouts(type.Layouts));
        cmd.Parameters.AddWithValue("$generator", (object?)type.Generator ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$from", (object?)type.GenerateFrom ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$created", FlashcardSqlMap.Ts(type.CreatedAt == default ? now : type.CreatedAt));
        cmd.Parameters.AddWithValue("$updated", FlashcardSqlMap.Ts(now));
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, string typeId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "DELETE FROM FlashcardCardTypes WHERE Id = $id AND IsBuiltIn = 0;";
        cmd.Parameters.AddWithValue("$id", typeId);
        return await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) > 0;
    }

    public async Task<int> CountFactsAsync(SqliteConnection conn, string typeId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM FlashcardFacts WHERE TypeId = $id AND TrashId IS NULL;";
        cmd.Parameters.AddWithValue("$id", typeId);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false));
    }

    private FlashcardCardType Read(SqliteDataReader reader)
    {
        var id = reader.GetString(0);
        return new FlashcardCardType(
            Id: id,
            Name: reader.GetString(1),
            IsBuiltIn: reader.GetInt32(2) != 0,
            Fields: FlashcardFactSqlMap.ReadFields(reader.GetString(3), _logger, $"card type {id}"),
            SortFieldId: reader.GetString(4),
            Layouts: FlashcardFactSqlMap.ReadLayouts(reader.GetString(5), _logger, $"card type {id}"),
            Generator: FlashcardSqlMap.ReadStringN(reader, 6),
            GenerateFrom: FlashcardSqlMap.ReadStringN(reader, 7),
            CreatedAt: FlashcardSqlMap.ReadTs(reader, 8),
            UpdatedAt: FlashcardSqlMap.ReadTs(reader, 9));
    }
}
