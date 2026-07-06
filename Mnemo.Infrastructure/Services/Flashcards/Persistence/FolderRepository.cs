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
    public async Task<IReadOnlyList<FlashcardFolder>> ListAsync(SqliteConnection conn, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, ParentId, Name, SortOrder FROM FlashcardFolders ORDER BY SortOrder, Name;";
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

    public async Task UpsertAsync(SqliteConnection conn, SqliteTransaction tx, FlashcardFolder folder, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO FlashcardFolders (Id, ParentId, Name, SortOrder, CreatedAt, UpdatedAt)
            VALUES ($id, $parent, $name, $sort, $now, $now)
            ON CONFLICT(Id) DO UPDATE SET
                ParentId = $parent, Name = $name, SortOrder = $sort, UpdatedAt = $now;
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
        cmd.CommandText = "DELETE FROM FlashcardFolders WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$id", folderId);
        var rows = await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        return rows > 0;
    }
}
