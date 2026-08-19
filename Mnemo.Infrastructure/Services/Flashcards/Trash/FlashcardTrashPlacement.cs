using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Trash;

namespace Mnemo.Infrastructure.Services.Flashcards.Trash;

/// <summary>
/// Where a held card or a held piece of material is going to land, worked out before anything moves.
/// </summary>
/// <param name="Restore">A refusal to hand straight back, or null when the restore can go ahead.</param>
/// <param name="MoveToId">A deck the items have to be moved into, or null when they stay where they are.</param>
/// <param name="DeckId">The deck the item ends up in.</param>
/// <param name="DeckName">That deck's name, so the caller can say where the item went.</param>
internal readonly record struct FlashcardTrashPlacementResult(
    TrashRestore? Restore,
    string? MoveToId,
    string? DeckId,
    string? DeckName);

/// <summary>
/// Decides which deck a card or a piece of material comes back to.
/// </summary>
/// <remarks>
/// Neither can sit at a root: a card belongs to a deck and material is filed under one. So where a
/// note or a mindmap would quietly land at the top of the library, these have to ask. A destination
/// the caller supplies wins outright, because it is a choice somebody just made; without one the
/// original deck is used, and if that deck is unavailable the caller is told to pick.
/// </remarks>
internal static class FlashcardTrashPlacement
{
    public static async Task<FlashcardTrashPlacementResult> ResolveAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string table,
        string entryId,
        TrashRestoreTarget? target,
        CancellationToken cancellationToken)
    {
        string? liveDeckId;
        string? liveDeckName;
        bool deckHeld;

        await using (var read = writer.CreateCommand())
        {
            read.Transaction = tx;
            read.CommandText = $"""
                SELECT live.Id, live.Name, held.Id FROM {table} item
                LEFT JOIN FlashcardDecks live ON live.Id = item.DeckId AND live.TrashId IS NULL
                LEFT JOIN FlashcardDecks held ON held.Id = item.DeckId AND held.TrashId IS NOT NULL
                WHERE item.TrashId = $entry LIMIT 1;
                """;
            read.Parameters.AddWithValue("$entry", entryId);

            await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                return new FlashcardTrashPlacementResult(new TrashRestore(TrashRestoreOutcome.Missing), null, null, null);

            liveDeckId = reader.IsDBNull(0) ? null : reader.GetString(0);
            liveDeckName = reader.IsDBNull(1) ? null : reader.GetString(1);
            deckHeld = !reader.IsDBNull(2);
        }

        if (target is not null)
        {
            var chosen = await ReadLiveDeckNameAsync(writer, tx, target.ContainerId, cancellationToken).ConfigureAwait(false);
            return chosen is null
                ? new FlashcardTrashPlacementResult(new TrashRestore(TrashRestoreOutcome.DestinationRequired), null, null, null)
                : new FlashcardTrashPlacementResult(null, target.ContainerId, target.ContainerId, chosen);
        }

        if (liveDeckId is not null)
            return new FlashcardTrashPlacementResult(null, null, liveDeckId, liveDeckName);

        // The deck is in the trash as well, so this comes back once that does. Restoring into it now
        // would put the card somewhere the user still cannot see.
        return deckHeld
            ? new FlashcardTrashPlacementResult(new TrashRestore(TrashRestoreOutcome.BlockedByContainer), null, null, null)
            : new FlashcardTrashPlacementResult(new TrashRestore(TrashRestoreOutcome.DestinationRequired), null, null, null);
    }

    private static async Task<string?> ReadLiveDeckNameAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string deckId,
        CancellationToken cancellationToken)
    {
        await using var cmd = writer.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT Name FROM FlashcardDecks WHERE Id = $id AND TrashId IS NULL LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", deckId);
        return await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
    }
}
