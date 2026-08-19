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
/// What travels with a deck: its cards, and the material filed under it.
/// </summary>
/// <remarks>
/// <para>
/// Shared by the deck source and the folder source, because a folder delete is a set of deck deletes
/// with a folder walk in front of it. Both stamp their deck rows first and then call in here, so the
/// deck rows carrying the entry id are the only input this needs.
/// </para>
/// <para>
/// Material is the awkward part. A fact is filed under one deck but its cards can be moved out of it
/// one at a time, so deleting a deck can leave a fact with cards on both sides of the line. A fact
/// whose cards all went with the deck goes too. A fact that still has a live card somewhere stays
/// live and moves in with one of those cards, so nothing the user can still see points at a deck
/// nobody can reach. Where it came from is written down, so restoring the deck can move it back.
/// </para>
/// </remarks>
internal static class FlashcardTrashContents
{
    /// <summary>Decks this entry holds, as a subquery.</summary>
    private const string HeldDecks = "SELECT Id FROM FlashcardDecks WHERE TrashId = $entry";

    /// <summary>
    /// Takes the cards and the material inside every deck the entry already holds. Safe to run twice
    /// for the same entry: each statement only touches rows nothing has taken yet.
    /// </summary>
    public static async Task CaptureAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string entryId,
        CancellationToken cancellationToken)
    {
        await FlashcardTrashSql.ExecuteForEntryAsync(
            writer,
            tx,
            $"""
            UPDATE FlashcardCards SET TrashId = $entry
            WHERE TrashId IS NULL AND DeckId IN ({HeldDecks});
            """,
            entryId,
            cancellationToken).ConfigureAwait(false);

        // Material with nothing left to show. Its cards were either taken just now or were already
        // gone, so it has no reason to stay in a collection the user can see.
        await FlashcardTrashSql.ExecuteForEntryAsync(
            writer,
            tx,
            $"""
            UPDATE FlashcardFacts SET TrashId = $entry
            WHERE TrashId IS NULL
              AND DeckId IN ({HeldDecks})
              AND NOT EXISTS (
                  SELECT 1 FROM FlashcardCards c WHERE c.FactId = FlashcardFacts.Id AND c.TrashId IS NULL);
            """,
            entryId,
            cancellationToken).ConfigureAwait(false);

        // Everything still unmarked under a held deck has a live card elsewhere. It moves in with the
        // oldest of those cards, and the move is recorded before it happens so a restore can read it.
        await FlashcardTrashSql.ExecuteForEntryAsync(
            writer,
            tx,
            $"""
            INSERT INTO FlashcardTrashFactHomes (TrashId, FactId, OriginalDeckId, ReplacementDeckId)
            SELECT $entry, f.Id, f.DeckId,
                   (SELECT c.DeckId FROM FlashcardCards c
                    WHERE c.FactId = f.Id AND c.TrashId IS NULL
                    ORDER BY c.CreatedAt, c.Id LIMIT 1)
            FROM FlashcardFacts f
            WHERE f.TrashId IS NULL
              AND f.DeckId IN ({HeldDecks})
              AND EXISTS (SELECT 1 FROM FlashcardCards c WHERE c.FactId = f.Id AND c.TrashId IS NULL)
            ON CONFLICT(TrashId, FactId) DO NOTHING;
            """,
            entryId,
            cancellationToken).ConfigureAwait(false);

        await FlashcardTrashSql.ExecuteForEntryAsync(
            writer,
            tx,
            """
            UPDATE FlashcardFacts SET DeckId = (
                SELECT h.ReplacementDeckId FROM FlashcardTrashFactHomes h
                WHERE h.TrashId = $entry AND h.FactId = FlashcardFacts.Id)
            WHERE TrashId IS NULL
              AND Id IN (SELECT FactId FROM FlashcardTrashFactHomes WHERE TrashId = $entry);
            """,
            entryId,
            cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Puts back what <see cref="CaptureAsync"/> took: the marks come off, and material that was
    /// moved out goes home again.
    /// </summary>
    /// <remarks>
    /// A move is only undone when the material is still where the move left it. Someone who refiled
    /// it themselves in the meantime made a decision, and a restore has no business overruling it.
    /// </remarks>
    public static async Task RestoreAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string entryId,
        CancellationToken cancellationToken)
    {
        await FlashcardTrashSql.ExecuteForEntryAsync(
            writer,
            tx,
            """
            UPDATE FlashcardFacts SET DeckId = (
                SELECT h.OriginalDeckId FROM FlashcardTrashFactHomes h
                WHERE h.TrashId = $entry AND h.FactId = FlashcardFacts.Id)
            WHERE EXISTS (
                SELECT 1 FROM FlashcardTrashFactHomes h
                WHERE h.TrashId = $entry
                  AND h.FactId = FlashcardFacts.Id
                  AND h.ReplacementDeckId = FlashcardFacts.DeckId);
            """,
            entryId,
            cancellationToken).ConfigureAwait(false);

        await ForgetMovesAsync(writer, tx, entryId, cancellationToken).ConfigureAwait(false);

        var entries = new[] { entryId };
        await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardCards", entries, cancellationToken).ConfigureAwait(false);
        await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardFacts", entries, cancellationToken).ConfigureAwait(false);
        await FlashcardTrashSql.ClearMarksAsync(writer, tx, "FlashcardDecks", entries, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Entries whose cards a permanent deletion of this one would destroy through a foreign key, so
    /// the caller can refuse rather than reach into somebody else's trash.
    /// </summary>
    public static async Task<List<string>> BlockingEntryIdsAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string entryId,
        CancellationToken cancellationToken)
    {
        await using var cmd = writer.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"""
            SELECT DISTINCT c.TrashId FROM FlashcardCards c
            WHERE c.TrashId IS NOT NULL AND c.TrashId <> $entry
              AND (c.DeckId IN ({HeldDecks})
                   OR c.FactId IN (SELECT Id FROM FlashcardFacts WHERE TrashId = $entry));
            """;
        cmd.Parameters.AddWithValue("$entry", entryId);
        return await FlashcardTrashSql.ReadStringsAsync(cmd, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Destroys the cards and the material the entry holds and queues the files they were the reason
    /// to keep. The caller has already established that no other entry has rows in the way.
    /// </summary>
    /// <remarks>
    /// Cards go first and by their own mark rather than through the cascade behind their deck or
    /// their material, because the search index is kept up to date by a delete trigger and a foreign
    /// key action does not fire one.
    /// </remarks>
    public static async Task DestroyAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string entryId,
        ILoggerService? logger,
        CancellationToken cancellationToken)
    {
        var paths = await CollectPathsAsync(writer, tx, entryId, logger, cancellationToken).ConfigureAwait(false);

        await FlashcardTrashSql.ExecuteForEntryAsync(
            writer, tx, "DELETE FROM FlashcardCards WHERE TrashId = $entry;", entryId, cancellationToken).ConfigureAwait(false);
        await FlashcardTrashSql.ExecuteForEntryAsync(
            writer, tx, "DELETE FROM FlashcardFacts WHERE TrashId = $entry;", entryId, cancellationToken).ConfigureAwait(false);

        await ForgetMovesAsync(writer, tx, entryId, cancellationToken).ConfigureAwait(false);

        await AssetCleanupQueue.EnqueueAsync(
            writer,
            tx,
            FlashcardAssetReferences.AssetOwner,
            paths,
            DateTimeOffset.UtcNow,
            cancellationToken).ConfigureAwait(false);
    }

    /// <summary>How many cards the entry is holding, which is what a listing reports as its contents.</summary>
    public static Task<int> HeldCardCountAsync(
        SqliteConnection writer,
        SqliteTransaction? tx,
        string entryId,
        CancellationToken cancellationToken) =>
        FlashcardTrashSql.CountForEntryAsync(
            writer, tx, "SELECT COUNT(*) FROM FlashcardCards WHERE TrashId = $entry;", entryId, cancellationToken);

    /// <summary>
    /// Every attachment path the entry's cards and material name. A file is only deleted once the
    /// cleanup pass confirms nothing else still names it, so being generous here is safe and being
    /// stingy is not.
    /// </summary>
    public static async Task<HashSet<string>> CollectPathsAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string entryId,
        ILoggerService? logger,
        CancellationToken cancellationToken)
    {
        var paths = new HashSet<string>(FlashcardAssetPaths.Comparer);

        await using (var cards = writer.CreateCommand())
        {
            cards.Transaction = tx;
            cards.CommandText = "SELECT Id, AttachmentsJson FROM FlashcardCards WHERE TrashId = $entry;";
            cards.Parameters.AddWithValue("$entry", entryId);

            await using var reader = await cards.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var id = reader.GetString(0);
                foreach (var attachment in FlashcardSqlMap.ReadAttachments(
                    reader.IsDBNull(1) ? null : reader.GetString(1), logger, $"card {id}"))
                {
                    FlashcardAssetPaths.Add(paths, attachment.FilePath);
                }
            }
        }

        await using (var facts = writer.CreateCommand())
        {
            facts.Transaction = tx;
            facts.CommandText = "SELECT Id, MediaJson FROM FlashcardFacts WHERE TrashId = $entry;";
            facts.Parameters.AddWithValue("$entry", entryId);

            await using var reader = await facts.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var id = reader.GetString(0);
                var media = FlashcardFactSqlMap.ReadMedia(
                    reader.IsDBNull(1) ? null : reader.GetString(1), logger, $"fact {id}");
                foreach (var group in media.Values)
                {
                    foreach (var attachment in group)
                        FlashcardAssetPaths.Add(paths, attachment.FilePath);
                }
            }
        }

        return paths;
    }

    /// <summary>Drops the record of where material was moved from, once it can no longer be acted on.</summary>
    public static Task ForgetMovesAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string entryId,
        CancellationToken cancellationToken) =>
        FlashcardTrashSql.ExecuteForEntryAsync(
            writer, tx, "DELETE FROM FlashcardTrashFactHomes WHERE TrashId = $entry;", entryId, cancellationToken);
}
