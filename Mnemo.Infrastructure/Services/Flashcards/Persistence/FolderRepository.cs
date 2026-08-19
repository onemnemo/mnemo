using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>Row-level access to <c>FlashcardFolders</c>. No business rules.</summary>
public interface IFolderRepository
{
    Task<IReadOnlyList<FlashcardFolder>> ListAsync(SqliteConnection conn, CancellationToken cancellationToken);
    Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardFolder folder, DateTimeOffset now, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, string folderId, CancellationToken cancellationToken);
}

/// <inheritdoc />
public sealed class FolderRepository : IFolderRepository
{
    /// <summary>What every ordinary read adds so a folder the trash is holding stays out of it.</summary>
    private const string Live = "TrashId IS NULL";

    public async Task<IReadOnlyList<FlashcardFolder>> ListAsync(SqliteConnection conn, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT Id, ParentId, Name, SortOrder FROM FlashcardFolders WHERE {Live} ORDER BY SortOrder, Name;";
        var list = new List<FlashcardFolder>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            list.Add(new FlashcardFolder(
                reader.GetString(0),
                reader.GetString(2),
                FlashcardSqlMap.ReadStringN(reader, 1),
                reader.GetInt32(3)));
        }
        return list;
    }

    /// <summary>
    /// Where a save actually files a folder. A folder the trash is holding is not somewhere anything
    /// can be put, so naming one lands the save at the root instead of hiding it inside something
    /// nobody can open. A parent that simply does not exist yet is passed through untouched, because
    /// an import can write a child before its parent and still mean it.
    /// </summary>
    private const string LiveParent =
        "(SELECT $parent WHERE NOT EXISTS (SELECT 1 FROM FlashcardFolders WHERE Id = $parent AND TrashId IS NOT NULL))";

    public async Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardFolder folder, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"""
            INSERT INTO FlashcardFolders (Id, ParentId, Name, SortOrder, CreatedAt, UpdatedAt)
            VALUES ($id, {LiveParent}, $name, $sort, $now, $now)
            ON CONFLICT(Id) DO UPDATE SET
                ParentId = {LiveParent}, Name = $name, SortOrder = $sort, UpdatedAt = $now
            WHERE TrashId IS NULL;
            """;
        cmd.Parameters.AddWithValue("$id", folder.Id);
        cmd.Parameters.AddWithValue("$parent", (object?)folder.ParentId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$name", folder.Name);
        cmd.Parameters.AddWithValue("$sort", folder.Order);
        cmd.Parameters.AddWithValue("$now", FlashcardSqlMap.Ts(now));
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<bool> DeleteAsync(SqliteConnection conn, SqliteTransaction tx, string folderId, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"DELETE FROM FlashcardFolders WHERE Id = $id AND {Live};";
        cmd.Parameters.AddWithValue("$id", folderId);
        var rows = await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        return rows > 0;
    }
}
