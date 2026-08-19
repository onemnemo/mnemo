using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards.Trash;

/// <summary>
/// The trash's view of one piece of material. Deleting material takes every card it makes, wherever
/// those cards were filed, because a card without its material has nothing left to generate it.
/// </summary>
public sealed class FlashcardFactTrashSource : ITrashSource
{
    /// <summary>The ledger kind deleted material is filed under.</summary>
    public const string TrashKind = "fact";

    /// <summary>Tables that, holding the same entry, mean the entry is not a material entry.</summary>
    private static readonly string[] Above = ["FlashcardFolders", "FlashcardDecks"];

    private const string SnapshotSql = """
        SELECT f.ValuesJson, t.SortFieldId, d.Name FROM FlashcardFacts f
        LEFT JOIN FlashcardCardTypes t ON t.Id = f.TypeId
        LEFT JOIN FlashcardDecks d ON d.Id = f.DeckId AND d.TrashId IS NULL
        """;

    private readonly IFlashcardStore _store;
    private readonly ILoggerService? _logger;

    public FlashcardFactTrashSource(IFlashcardStore store, ILoggerService? logger = null)
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
            cmd.CommandText = $"{SnapshotSql} WHERE f.Id = $id AND f.TrashId IS NULL;";
            cmd.Parameters.AddWithValue("$id", itemId);

            var snapshot = await ReadSnapshotAsync(cmd, itemId, _logger, ct).ConfigureAwait(false);
            if (snapshot is null)
                return null;

            await using var count = conn.CreateCommand();
            count.CommandText =
                "SELECT COUNT(*) FROM FlashcardCards WHERE FactId = $id AND TrashId IS NULL;";
            count.Parameters.AddWithValue("$id", itemId);
            var contained = System.Convert.ToInt32(await count.ExecuteScalarAsync(ct).ConfigureAwait(false) ?? 0);

            return snapshot with { ContainedCount = contained };
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashSnapshot?> CaptureAsync(string itemId, string entryId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            TrashSnapshot? snapshot;
            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                read.CommandText = $"{SnapshotSql} WHERE f.Id = $id AND (f.TrashId IS NULL OR f.TrashId = $entry);";
                read.Parameters.AddWithValue("$id", itemId);
                read.Parameters.AddWithValue("$entry", entryId);
                snapshot = await ReadSnapshotAsync(read, itemId, _logger, ct).ConfigureAwait(false);
            }

            if (snapshot is null)
                return null;

            await FlashcardTrashSql
                .MarkAsync(writer, tx, "FlashcardFacts", [itemId], entryId, ct)
                .ConfigureAwait(false);

            // Every card this material makes goes with it, including one somebody filed into another
            // deck. Without the material the card cannot be regenerated or edited, so leaving it
            // behind would leave a card nothing can maintain.
            await FlashcardTrashSql.ExecuteForEntryAsync(
                writer,
                tx,
                """
                UPDATE FlashcardCards SET TrashId = $entry
                WHERE TrashId IS NULL
                  AND FactId IN (SELECT Id FROM FlashcardFacts WHERE TrashId = $entry);
                """,
                entryId,
                ct).ConfigureAwait(false);

            var contained = await FlashcardTrashContents
                .HeldCardCountAsync(writer, tx, entryId, ct)
                .ConfigureAwait(false);

            return snapshot with { ContainedCount = contained };
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            var placement = await FlashcardTrashPlacement
                .ResolveAsync(writer, tx, "FlashcardFacts", entryId, target, ct)
                .ConfigureAwait(false);

            if (placement.Restore is { } refusal)
                return refusal;

            if (placement.MoveToId is { } deckId)
            {
                // The material moves, and so does any card of it whose own deck has gone. A card whose
                // deck is still there keeps its filing: somebody put it in that deck on purpose.
                await using var moveFact = writer.CreateCommand();
                moveFact.Transaction = tx;
                moveFact.CommandText = "UPDATE FlashcardFacts SET DeckId = $deck WHERE TrashId = $entry;";
                moveFact.Parameters.AddWithValue("$deck", deckId);
                moveFact.Parameters.AddWithValue("$entry", entryId);
                await moveFact.ExecuteNonQueryAsync(ct).ConfigureAwait(false);

                await using var moveCards = writer.CreateCommand();
                moveCards.Transaction = tx;
                moveCards.CommandText = """
                    UPDATE FlashcardCards SET DeckId = $deck
                    WHERE TrashId = $entry
                      AND NOT EXISTS (
                          SELECT 1 FROM FlashcardDecks d
                          WHERE d.Id = FlashcardCards.DeckId AND d.TrashId IS NULL);
                    """;
                moveCards.Parameters.AddWithValue("$deck", deckId);
                moveCards.Parameters.AddWithValue("$entry", entryId);
                await moveCards.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            var entries = new[] { entryId };
            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardCards", entries, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardFacts", entries, ct).ConfigureAwait(false);

            return new TrashRestore(TrashRestoreOutcome.Restored, placement.DeckId, placement.DeckName);
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
            return TrashPurge.Done();
        }, cancellationToken);

    /// <inheritdoc />
    public Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) =>
            FlashcardTrashSql.HoldsAsync(conn, "FlashcardFacts", Above, entryId, ct), cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) =>
            FlashcardTrashSql.HeldEntryIdsAsync(conn, "FlashcardFacts", Above, ct), cancellationToken);

    /// <inheritdoc />
    public Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardCards", entryIds, ct).ConfigureAwait(false);
            await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardFacts", entryIds, ct).ConfigureAwait(false);
        }, cancellationToken);

    /// <summary>
    /// The material's own heading: the field its card type sorts by, or the first field with anything
    /// in it when the type has been deleted or its sort field renamed.
    /// </summary>
    private static async Task<TrashSnapshot?> ReadSnapshotAsync(
        SqliteCommand cmd, string factId, ILoggerService? logger, CancellationToken cancellationToken)
    {
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            return null;

        var values = FlashcardFactSqlMap.ReadValues(
            reader.IsDBNull(0) ? null : reader.GetString(0), logger, $"fact {factId}");
        var sortFieldId = reader.IsDBNull(1) ? null : reader.GetString(1);
        var deckName = reader.IsDBNull(2) ? null : reader.GetString(2);

        var title = sortFieldId is not null
            && values.TryGetValue(sortFieldId, out var sorted)
            && !string.IsNullOrWhiteSpace(sorted)
                ? sorted
                : values.Values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v)) ?? string.Empty;

        return new TrashSnapshot(title, deckName, 0);
    }
}
