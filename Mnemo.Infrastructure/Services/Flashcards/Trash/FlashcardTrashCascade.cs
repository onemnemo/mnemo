using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Infrastructure.Services.Flashcards.Trash;

/// <summary>
/// What has to happen to rows the trash is holding when something above them is deleted outright.
/// </summary>
/// <remarks>
/// A held row is invisible to every ordinary list, so the delete paths that lift children out of the
/// way before removing their parent cannot see it and would leave it to the foreign key. That is
/// silent destruction of something the user asked to be able to get back, so each cascade is met
/// here first: a held folder is lifted to the root, a held card of deleted material becomes a
/// freeform card, and a held card in a deleted deck, which has nowhere to go because a card must
/// have a deck, is destroyed deliberately with its files accounted for.
/// </remarks>
internal static class FlashcardTrashCascade
{
    /// <summary>
    /// Lifts held folders out of a folder about to be deleted. The live ones are already reparented
    /// by the caller; these are the ones no list it reads can show it.
    /// </summary>
    public static async Task LiftHeldFoldersAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string folderId,
        CancellationToken cancellationToken)
    {
        await using var cmd = writer.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText =
            "UPDATE FlashcardFolders SET ParentId = NULL WHERE ParentId = $folder AND TrashId IS NOT NULL;";
        cmd.Parameters.AddWithValue("$folder", folderId);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Cuts held cards loose from material about to be deleted, so they survive as freeform cards
    /// carrying the wording they had rather than going down with it.
    /// </summary>
    /// <remarks>
    /// A card keeps its own front and back text, so one with no material behind it is still a card
    /// somebody can study. It simply stops being regenerated, which is what a freeform card is.
    /// </remarks>
    public static async Task DetachHeldCardsAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        IReadOnlyList<string> factIds,
        CancellationToken cancellationToken)
    {
        if (factIds.Count == 0)
            return;

        for (var offset = 0; offset < factIds.Count; offset += FlashcardTrashSql.ChunkSize)
        {
            var take = Math.Min(FlashcardTrashSql.ChunkSize, factIds.Count - offset);
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;

            var names = new List<string>(take);
            for (var i = 0; i < take; i++)
            {
                var name = $"$f{i}";
                names.Add(name);
                cmd.Parameters.AddWithValue(name, factIds[offset + i]);
            }

            // Only material that is really going: an id in this list whose row the trash is holding
            // survives the delete, and its cards have to stay attached to it for its own restore.
            cmd.CommandText =
                "UPDATE FlashcardCards SET FactId = NULL, LayoutKey = NULL " +
                "WHERE TrashId IS NOT NULL " +
                $" AND FactId IN ({string.Join(", ", names)})" +
                "  AND EXISTS (SELECT 1 FROM FlashcardFacts f WHERE f.Id = FlashcardCards.FactId AND f.TrashId IS NULL);";
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Destroys the held cards sitting in a deck about to be deleted, and queues the files they were
    /// the reason to keep.
    /// </summary>
    /// <remarks>
    /// This is the one cascade nothing can be saved from: a card row has to name a deck, and the
    /// deck it names is going. Taking them here rather than through the foreign key keeps the search
    /// index in step and puts their files in the cleanup queue. Trash entries left holding nothing
    /// are dropped the next time the ledger is reconciled.
    /// </remarks>
    public static async Task DestroyHeldCardsInDeckAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string deckId,
        ILoggerService? logger,
        CancellationToken cancellationToken)
    {
        var paths = new HashSet<string>(FlashcardAssetPaths.Comparer);
        var lost = 0;

        await using (var read = writer.CreateCommand())
        {
            read.Transaction = tx;
            read.CommandText =
                "SELECT Id, AttachmentsJson FROM FlashcardCards WHERE DeckId = $deck AND TrashId IS NOT NULL;";
            read.Parameters.AddWithValue("$deck", deckId);
            await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                lost++;
                var id = reader.GetString(0);
                foreach (var attachment in FlashcardSqlMap.ReadAttachments(
                    reader.IsDBNull(1) ? null : reader.GetString(1), logger, $"card {id}"))
                {
                    FlashcardAssetPaths.Add(paths, attachment.FilePath);
                }
            }
        }

        if (lost == 0)
            return;

        await using (var delete = writer.CreateCommand())
        {
            delete.Transaction = tx;
            delete.CommandText = "DELETE FROM FlashcardCards WHERE DeckId = $deck AND TrashId IS NOT NULL;";
            delete.Parameters.AddWithValue("$deck", deckId);
            await delete.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await AssetCleanupQueue.EnqueueAsync(
            writer,
            tx,
            FlashcardAssetReferences.AssetOwner,
            paths,
            DateTimeOffset.UtcNow,
            cancellationToken).ConfigureAwait(false);

        logger?.Warning(
            "Flashcards",
            $"Deleting deck {deckId} destroyed {lost} card(s) waiting in the trash, because a card cannot exist without a deck.");
    }
}
