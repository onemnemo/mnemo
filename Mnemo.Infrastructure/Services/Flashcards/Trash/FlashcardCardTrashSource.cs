using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards.Trash;

/// <summary>
/// The trash's view of one card. The card keeps its schedule, its review history and its place in
/// the material it came from, so a restore returns someone to exactly where they were rather than
/// starting the card over.
/// </summary>
/// <remarks>
/// A card cannot sit at a root the way a note or a deck can, because every card belongs to a deck.
/// Restoring one whose deck is gone therefore asks the caller for a live deck to put it in, and a
/// card whose layout has left its card type in the meantime is declined outright rather than put
/// back as something nothing regenerates.
/// </remarks>
public sealed class FlashcardCardTrashSource : ITrashSource
{
    /// <summary>The ledger kind a deleted card is filed under.</summary>
    public const string TrashKind = "card";

    /// <summary>Tables that, holding the same entry, mean the entry is not a card entry.</summary>
    private static readonly string[] Above = ["FlashcardFolders", "FlashcardDecks", "FlashcardFacts"];

    private readonly IFlashcardStore _store;
    private readonly ILoggerService? _logger;

    public FlashcardCardTrashSource(IFlashcardStore store, ILoggerService? logger = null)
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
                SELECT c.Front, d.Name FROM FlashcardCards c
                LEFT JOIN FlashcardDecks d ON d.Id = c.DeckId AND d.TrashId IS NULL
                WHERE c.Id = $id AND c.TrashId IS NULL;
                """;
            cmd.Parameters.AddWithValue("$id", itemId);
            return await ReadSnapshotAsync(cmd, ct).ConfigureAwait(false);
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashSnapshot?> CaptureAsync(string itemId, string entryId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            TrashSnapshot? snapshot;
            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                read.CommandText = """
                    SELECT c.Front, d.Name FROM FlashcardCards c
                    LEFT JOIN FlashcardDecks d ON d.Id = c.DeckId AND d.TrashId IS NULL
                    WHERE c.Id = $id AND (c.TrashId IS NULL OR c.TrashId = $entry);
                    """;
                read.Parameters.AddWithValue("$id", itemId);
                read.Parameters.AddWithValue("$entry", entryId);
                snapshot = await ReadSnapshotAsync(read, ct).ConfigureAwait(false);
            }

            if (snapshot is null)
                return null;

            await FlashcardTrashSql
                .MarkAsync(writer, tx, "FlashcardCards", [itemId], entryId, ct)
                .ConfigureAwait(false);

            return snapshot;
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            if (await LayoutIsGoneAsync(writer, tx, entryId, ct).ConfigureAwait(false))
                return new TrashRestore(TrashRestoreOutcome.NoLongerGenerated);

            var placement = await FlashcardTrashPlacement
                .ResolveAsync(writer, tx, "FlashcardCards", entryId, target, ct)
                .ConfigureAwait(false);

            if (placement.Restore is { } refusal)
                return refusal;

            if (placement.MoveToId is { } deckId)
            {
                await using var move = writer.CreateCommand();
                move.Transaction = tx;
                move.CommandText = "UPDATE FlashcardCards SET DeckId = $deck WHERE TrashId = $entry;";
                move.Parameters.AddWithValue("$deck", deckId);
                move.Parameters.AddWithValue("$entry", entryId);
                await move.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            await FlashcardTrashSql
                .ClearMarksAsync(writer, tx, "FlashcardCards", [entryId], ct)
                .ConfigureAwait(false);

            return new TrashRestore(TrashRestoreOutcome.Restored, placement.DeckId, placement.DeckName);
        }, cancellationToken);

    /// <inheritdoc />
    public Task<TrashPurge> PurgeAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (writer, tx, ct) =>
        {
            // The material a card came from outlives the card, unless this was the last one it made.
            // Material nothing can be studied from is what an empty fact is, and the ordinary delete
            // path clears those away too rather than leaving them in the collection.
            List<string> orphaned;
            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                read.CommandText = """
                    SELECT DISTINCT c.FactId FROM FlashcardCards c
                    WHERE c.TrashId = $entry AND c.FactId IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM FlashcardCards other
                          WHERE other.FactId = c.FactId
                            AND (other.TrashId IS NULL OR other.TrashId <> $entry));
                    """;
                read.Parameters.AddWithValue("$entry", entryId);
                orphaned = await FlashcardTrashSql.ReadStringsAsync(read, ct).ConfigureAwait(false);
            }

            await FlashcardTrashContents.DestroyAsync(writer, tx, entryId, _logger, ct).ConfigureAwait(false);

            if (orphaned.Count > 0)
            {
                await FlashcardTrashOrphans
                    .DestroyFactsAsync(writer, tx, orphaned, _logger, ct)
                    .ConfigureAwait(false);
            }

            return TrashPurge.Done();
        }, cancellationToken);

    /// <inheritdoc />
    public Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) =>
            FlashcardTrashSql.HoldsAsync(conn, "FlashcardCards", Above, entryId, ct), cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) =>
            FlashcardTrashSql.HeldEntryIdsAsync(conn, "FlashcardCards", Above, ct), cancellationToken);

    /// <inheritdoc />
    public Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        _store.WriteAsync((writer, tx, ct) =>
            FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardCards", entryIds, ct), cancellationToken);

    /// <summary>
    /// Whether the card this entry holds belongs to a layout its material's card type no longer
    /// lists.
    /// </summary>
    /// <remarks>
    /// Such a card would come back live with nothing behind it: no save regenerates it, and the
    /// first save of its material or its type sweeps it straight back into the trash. Refusing
    /// keeps it recoverable and says why, and putting the layout back on the type makes the
    /// restore work again. A card with no material, and one belonging to a type that makes its
    /// cards from the content of a field rather than from a list of layouts, are both left alone:
    /// neither has a layout list to be missing from.
    /// </remarks>
    private async Task<bool> LayoutIsGoneAsync(
        SqliteConnection writer, SqliteTransaction tx, string entryId, CancellationToken cancellationToken)
    {
        string layoutKey;
        string typeId;
        string factId;

        await using (var read = writer.CreateCommand())
        {
            read.Transaction = tx;
            read.CommandText = """
                SELECT c.LayoutKey, f.TypeId, f.Id FROM FlashcardCards c
                JOIN FlashcardFacts f ON f.Id = c.FactId
                WHERE c.TrashId = $entry AND c.LayoutKey IS NOT NULL LIMIT 1;
                """;
            read.Parameters.AddWithValue("$entry", entryId);

            await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                return false;

            layoutKey = reader.GetString(0);
            typeId = reader.GetString(1);
            factId = reader.GetString(2);
        }

        var type = await new CardTypeRepository(_logger)
            .GetAsync(writer, typeId, cancellationToken)
            .ConfigureAwait(false);

        // A type that is gone leaves the material reading through the fallback type, and refusing
        // here would strand the card with nothing anyone could put back.
        if (type is null)
            return false;

        // A generated type has no layout list to consult; its cards exist while the material still
        // carries the deletion or the mask that made them, so the generator is asked directly.
        if (!string.IsNullOrEmpty(type.Generator))
        {
            var fact = await new FactRepository(_logger)
                .GetAsync(writer, factId, cancellationToken)
                .ConfigureAwait(false);
            if (fact is null)
                return false;

            return !FlashcardGeneration.Generate(type, fact)
                .Any(card => string.Equals(card.Key, layoutKey, StringComparison.Ordinal));
        }

        foreach (var layout in type.Layouts)
        {
            if (string.Equals(layout.Id, layoutKey, StringComparison.Ordinal))
                return false;
        }

        return true;
    }

    private static async Task<TrashSnapshot?> ReadSnapshotAsync(
        Microsoft.Data.Sqlite.SqliteCommand cmd, CancellationToken cancellationToken)
    {
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            return null;

        return new TrashSnapshot(
            reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            0);
    }
}
