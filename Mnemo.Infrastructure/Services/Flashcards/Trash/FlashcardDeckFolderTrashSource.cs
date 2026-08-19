using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards.Trash;

/// <summary>
/// The trash's view of one deck folder. Deleting a folder takes the decks and subfolders inside it,
/// and restoring brings the same arrangement back rather than leaving its contents at the root.
/// </summary>
public sealed class FlashcardDeckFolderTrashSource : ITrashSource
{
    /// <summary>The ledger kind a deleted deck folder is filed under.</summary>
    public const string TrashKind = "deck-folder";

    /// <summary>Folders reachable from $id that nothing has taken yet.</summary>
    private const string LiveSubtreeSql = """
        WITH RECURSIVE Subtree(Id) AS (
            SELECT Id FROM FlashcardFolders WHERE Id = $id AND TrashId IS NULL
            UNION ALL
            SELECT child.Id FROM FlashcardFolders child
            JOIN Subtree s ON child.ParentId = s.Id
            WHERE child.TrashId IS NULL
        )
        """;

    /// <summary>The same walk, also stepping through rows this entry already holds.</summary>
    private const string EntrySubtreeSql = """
        WITH RECURSIVE Subtree(Id) AS (
            SELECT Id FROM FlashcardFolders WHERE Id = $id AND (TrashId IS NULL OR TrashId = $entry)
            UNION ALL
            SELECT child.Id FROM FlashcardFolders child
            JOIN Subtree s ON child.ParentId = s.Id
            WHERE child.TrashId IS NULL OR child.TrashId = $entry
        )
        """;

    private readonly IFlashcardStore _store;
    private readonly ILoggerService? _logger;

    public FlashcardDeckFolderTrashSource(IFlashcardStore store, ILoggerService? logger = null)
    {
        _store = store;
        _logger = logger;
    }

    /// <inheritdoc />
    public string Kind => TrashKind;

    /// <inheritdoc />
    public Task<TrashSnapshot?> PrepareAsync(string itemId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync(async (conn, ct) =>
        {
            string name;
            string? origin;

            await using (var read = conn.CreateCommand())
            {
                read.CommandText = """
                    SELECT f.Name, p.Name FROM FlashcardFolders f
                    LEFT JOIN FlashcardFolders p ON p.Id = f.ParentId AND p.TrashId IS NULL
                    WHERE f.Id = $id AND f.TrashId IS NULL;
                    """;
                read.Parameters.AddWithValue("$id", itemId);

                await using var reader = await read.ExecuteReaderAsync(ct).ConfigureAwait(false);
                if (!await reader.ReadAsync(ct).ConfigureAwait(false))
                    return null;

                name = reader.IsDBNull(0) ? string.Empty : reader.GetString(0);
                origin = reader.IsDBNull(1) ? null : reader.GetString(1);
            }

            await using var count = conn.CreateCommand();
            count.CommandText = $"""
                {LiveSubtreeSql}
                SELECT COUNT(*) FROM FlashcardDecks
                WHERE TrashId IS NULL AND FolderId IN (SELECT Id FROM Subtree);
                """;
            count.Parameters.AddWithValue("$id", itemId);
            var contained = System.Convert.ToInt32(await count.ExecuteScalarAsync(ct).ConfigureAwait(false) ?? 0);

            return new TrashSnapshot(name, origin, contained);
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashSnapshot?> CaptureAsync(string itemId, string entryId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            string name;
            string? origin;

            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                read.CommandText = """
                    SELECT f.Name, p.Name FROM FlashcardFolders f
                    LEFT JOIN FlashcardFolders p ON p.Id = f.ParentId AND p.TrashId IS NULL
                    WHERE f.Id = $id AND (f.TrashId IS NULL OR f.TrashId = $entry);
                    """;
                read.Parameters.AddWithValue("$id", itemId);
                read.Parameters.AddWithValue("$entry", entryId);

                await using var reader = await read.ExecuteReaderAsync(ct).ConfigureAwait(false);
                if (!await reader.ReadAsync(ct).ConfigureAwait(false))
                    return (TrashSnapshot?)null;

                name = reader.IsDBNull(0) ? string.Empty : reader.GetString(0);
                origin = reader.IsDBNull(1) ? null : reader.GetString(1);
            }

            // The walk stops at a folder another entry already holds, so one delete never takes rows
            // out from under another. Its own marks are walked through, which is what lets a repeated
            // capture finish a run that was interrupted halfway.
            List<string> subtree;
            await using (var walk = writer.CreateCommand())
            {
                walk.Transaction = tx;
                walk.CommandText = $"""
                    {EntrySubtreeSql}
                    SELECT Id FROM Subtree;
                    """;
                walk.Parameters.AddWithValue("$id", itemId);
                walk.Parameters.AddWithValue("$entry", entryId);
                subtree = await FlashcardTrashSql.ReadStringsAsync(walk, ct).ConfigureAwait(false);
            }

            await FlashcardTrashSql
                .MarkAsync(writer, tx, "FlashcardFolders", subtree, entryId, ct)
                .ConfigureAwait(false);

            await FlashcardTrashSql.ExecuteForEntryAsync(
                writer,
                tx,
                """
                UPDATE FlashcardDecks SET TrashId = $entry
                WHERE TrashId IS NULL
                  AND FolderId IN (SELECT Id FROM FlashcardFolders WHERE TrashId = $entry);
                """,
                entryId,
                ct).ConfigureAwait(false);

            await FlashcardTrashContents.CaptureAsync(writer, tx, entryId, ct).ConfigureAwait(false);

            var contained = await FlashcardTrashSql.CountForEntryAsync(
                writer, tx, "SELECT COUNT(*) FROM FlashcardDecks WHERE TrashId = $entry;", entryId, ct)
                .ConfigureAwait(false);

            return (TrashSnapshot?)new TrashSnapshot(name, origin, contained);
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default) =>
        // A folder can sit at the library root, so it never needs somewhere chosen for it.
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            string rootId;
            string? parentId;
            string? liveParentId;
            string? liveParentName;
            bool parentHeld;

            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                // The entry's root folder is the one whose parent this entry does not also hold.
                read.CommandText = """
                    SELECT f.Id, f.ParentId, live.Id, live.Name, held.Id FROM FlashcardFolders f
                    LEFT JOIN FlashcardFolders live ON live.Id = f.ParentId AND live.TrashId IS NULL
                    LEFT JOIN FlashcardFolders held ON held.Id = f.ParentId AND held.TrashId IS NOT NULL
                    WHERE f.TrashId = $entry
                      AND (f.ParentId IS NULL
                           OR f.ParentId NOT IN (SELECT Id FROM FlashcardFolders WHERE TrashId = $entry))
                    LIMIT 1;
                    """;
                read.Parameters.AddWithValue("$entry", entryId);

                await using var reader = await read.ExecuteReaderAsync(ct).ConfigureAwait(false);
                if (!await reader.ReadAsync(ct).ConfigureAwait(false))
                    return new TrashRestore(TrashRestoreOutcome.Missing);

                rootId = reader.GetString(0);
                parentId = reader.IsDBNull(1) ? null : reader.GetString(1);
                liveParentId = reader.IsDBNull(2) ? null : reader.GetString(2);
                liveParentName = reader.IsDBNull(3) ? null : reader.GetString(3);
                parentHeld = !reader.IsDBNull(4);
            }

            // The folder this one sat in is in the trash as well, so it comes back once that does.
            if (parentHeld)
                return new TrashRestore(TrashRestoreOutcome.BlockedByContainer);

            var rooted = parentId is not null && liveParentId is null;
            if (rooted)
            {
                await using var reparent = writer.CreateCommand();
                reparent.Transaction = tx;
                reparent.CommandText = "UPDATE FlashcardFolders SET ParentId = NULL WHERE Id = $id;";
                reparent.Parameters.AddWithValue("$id", rootId);
                await reparent.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            await FlashcardTrashContents.RestoreAsync(writer, tx, entryId, ct).ConfigureAwait(false);
            await FlashcardTrashSql
                .ClearMarksAsync(writer, tx, "FlashcardFolders", [entryId], ct)
                .ConfigureAwait(false);

            return rooted
                ? new TrashRestore(TrashRestoreOutcome.Rooted)
                : new TrashRestore(TrashRestoreOutcome.Restored, liveParentId, liveParentName);
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashPurge> PurgeAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            List<string> blocking;
            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                // Deleting a folder cascades to its subfolders. One another entry holds would be
                // destroyed with it, so that entry has to be dealt with first.
                read.CommandText = """
                    SELECT DISTINCT child.TrashId FROM FlashcardFolders child
                    WHERE child.ParentId IN (SELECT Id FROM FlashcardFolders WHERE TrashId = $entry)
                      AND child.TrashId IS NOT NULL
                      AND child.TrashId <> $entry;
                    """;
                read.Parameters.AddWithValue("$entry", entryId);
                blocking = await FlashcardTrashSql.ReadStringsAsync(read, ct).ConfigureAwait(false);
            }

            blocking.AddRange(await FlashcardTrashContents
                .BlockingEntryIdsAsync(writer, tx, entryId, ct)
                .ConfigureAwait(false));

            if (blocking.Count > 0)
                return TrashPurge.Blocked(blocking);

            // A live subfolder under a held folder is not something the library can produce, but the
            // cascade would destroy one if it existed. Lifting it to the root keeps the rule that
            // permanent deletion only ever destroys what the entry itself holds. A live deck needs no
            // such care: the folder key clears it to null, which is the same as being at the root.
            await FlashcardTrashSql.ExecuteForEntryAsync(
                writer,
                tx,
                """
                UPDATE FlashcardFolders SET ParentId = NULL
                WHERE TrashId IS NULL
                  AND ParentId IN (SELECT Id FROM FlashcardFolders WHERE TrashId = $entry);
                """,
                entryId,
                ct).ConfigureAwait(false);

            await FlashcardTrashContents.DestroyAsync(writer, tx, entryId, _logger, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ExecuteForEntryAsync(
                writer, tx, "DELETE FROM FlashcardDecks WHERE TrashId = $entry;", entryId, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ExecuteForEntryAsync(
                writer, tx, "DELETE FROM FlashcardFolders WHERE TrashId = $entry;", entryId, ct).ConfigureAwait(false);

            return TrashPurge.Done();
        }, cancellationToken);

    /// <inheritdoc />
    public Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) =>
            FlashcardTrashSql.HoldsAsync(conn, "FlashcardFolders", [], entryId, ct), cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) =>
            FlashcardTrashSql.HeldEntryIdsAsync(conn, "FlashcardFolders", [], ct), cancellationToken);

    /// <inheritdoc />
    public Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            foreach (var entryId in entryIds)
                await FlashcardTrashContents.ForgetMovesAsync(writer, tx, entryId, ct).ConfigureAwait(false);

            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardCards", entryIds, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardFacts", entryIds, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardDecks", entryIds, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardFolders", entryIds, ct).ConfigureAwait(false);
        }, cancellationToken);
}
