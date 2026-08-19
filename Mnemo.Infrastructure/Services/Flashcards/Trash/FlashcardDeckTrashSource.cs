using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards.Trash;

/// <summary>
/// The trash's view of one deck. Deleting a deck takes its cards and the material behind them, with
/// every schedule and every review kept, so a restore gives back a deck someone can carry on
/// studying rather than a fresh copy of its contents.
/// </summary>
public sealed class FlashcardDeckTrashSource : ITrashSource
{
    /// <summary>The ledger kind a deleted deck is filed under.</summary>
    public const string TrashKind = "deck";

    /// <summary>Tables that, holding the same entry, mean the entry is not a deck entry.</summary>
    private static readonly string[] Above = ["FlashcardFolders"];

    private readonly IFlashcardStore _store;
    private readonly ILoggerService? _logger;

    public FlashcardDeckTrashSource(IFlashcardStore store, ILoggerService? logger = null)
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
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT d.Name, f.Name,
                       (SELECT COUNT(*) FROM FlashcardCards c WHERE c.DeckId = d.Id AND c.TrashId IS NULL)
                FROM FlashcardDecks d
                LEFT JOIN FlashcardFolders f ON f.Id = d.FolderId AND f.TrashId IS NULL
                WHERE d.Id = $id AND d.TrashId IS NULL;
                """;
            cmd.Parameters.AddWithValue("$id", itemId);

            await using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await reader.ReadAsync(ct).ConfigureAwait(false))
                return null;

            return new TrashSnapshot(
                reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? 0 : reader.GetInt32(2));
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
                // Reading the entry's own mark as well as a live row is what lets a second capture of
                // the same entry report what it already took rather than find nothing.
                read.CommandText = """
                    SELECT d.Name, f.Name FROM FlashcardDecks d
                    LEFT JOIN FlashcardFolders f ON f.Id = d.FolderId AND f.TrashId IS NULL
                    WHERE d.Id = $id AND (d.TrashId IS NULL OR d.TrashId = $entry);
                    """;
                read.Parameters.AddWithValue("$id", itemId);
                read.Parameters.AddWithValue("$entry", entryId);

                await using var reader = await read.ExecuteReaderAsync(ct).ConfigureAwait(false);
                if (!await reader.ReadAsync(ct).ConfigureAwait(false))
                    return (TrashSnapshot?)null;

                name = reader.IsDBNull(0) ? string.Empty : reader.GetString(0);
                origin = reader.IsDBNull(1) ? null : reader.GetString(1);
            }

            await FlashcardTrashSql
                .MarkAsync(writer, tx, "FlashcardDecks", [itemId], entryId, ct)
                .ConfigureAwait(false);
            await FlashcardTrashContents.CaptureAsync(writer, tx, entryId, ct).ConfigureAwait(false);

            var contained = await FlashcardTrashContents
                .HeldCardCountAsync(writer, tx, entryId, ct)
                .ConfigureAwait(false);

            return (TrashSnapshot?)new TrashSnapshot(name, origin, contained);
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            string? folderId;
            string? liveFolderId;
            string? liveFolderName;
            bool folderHeld;

            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                read.CommandText = """
                    SELECT d.FolderId, live.Id, live.Name, held.Id FROM FlashcardDecks d
                    LEFT JOIN FlashcardFolders live ON live.Id = d.FolderId AND live.TrashId IS NULL
                    LEFT JOIN FlashcardFolders held ON held.Id = d.FolderId AND held.TrashId IS NOT NULL
                    WHERE d.TrashId = $entry LIMIT 1;
                    """;
                read.Parameters.AddWithValue("$entry", entryId);

                await using var reader = await read.ExecuteReaderAsync(ct).ConfigureAwait(false);
                if (!await reader.ReadAsync(ct).ConfigureAwait(false))
                    return new TrashRestore(TrashRestoreOutcome.Missing);

                folderId = reader.IsDBNull(0) ? null : reader.GetString(0);
                liveFolderId = reader.IsDBNull(1) ? null : reader.GetString(1);
                liveFolderName = reader.IsDBNull(2) ? null : reader.GetString(2);
                folderHeld = !reader.IsDBNull(3);
            }

            // The folder this deck sat in is in the trash as well, so it comes back once that does.
            if (folderHeld)
                return new TrashRestore(TrashRestoreOutcome.BlockedByContainer);

            // A deck can sit at the library root, so a folder that went away costs it the folder and
            // nothing else. Nobody has to be asked where to put it.
            var rooted = folderId is not null && liveFolderId is null;
            if (rooted)
            {
                await FlashcardTrashSql.ExecuteForEntryAsync(
                    writer,
                    tx,
                    "UPDATE FlashcardDecks SET FolderId = NULL WHERE TrashId = $entry;",
                    entryId,
                    ct).ConfigureAwait(false);
            }

            await FlashcardTrashContents.RestoreAsync(writer, tx, entryId, ct).ConfigureAwait(false);

            return rooted
                ? new TrashRestore(TrashRestoreOutcome.Rooted)
                : new TrashRestore(TrashRestoreOutcome.Restored, liveFolderId, liveFolderName);
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashPurge> PurgeAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            var blocking = await FlashcardTrashContents
                .BlockingEntryIdsAsync(writer, tx, entryId, ct)
                .ConfigureAwait(false);
            if (blocking.Count > 0)
                return TrashPurge.Blocked(blocking);

            await FlashcardTrashContents.DestroyAsync(writer, tx, entryId, _logger, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ExecuteForEntryAsync(
                writer, tx, "DELETE FROM FlashcardDecks WHERE TrashId = $entry;", entryId, ct).ConfigureAwait(false);

            return TrashPurge.Done();
        }, cancellationToken);

    /// <inheritdoc />
    public Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) =>
            FlashcardTrashSql.HoldsAsync(conn, "FlashcardDecks", Above, entryId, ct), cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) =>
            FlashcardTrashSql.HeldEntryIdsAsync(conn, "FlashcardDecks", Above, ct), cancellationToken);

    /// <inheritdoc />
    public Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            foreach (var entryId in entryIds)
                await FlashcardTrashContents.ForgetMovesAsync(writer, tx, entryId, ct).ConfigureAwait(false);

            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardCards", entryIds, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardFacts", entryIds, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardDecks", entryIds, ct).ConfigureAwait(false);
        }, cancellationToken);
}
