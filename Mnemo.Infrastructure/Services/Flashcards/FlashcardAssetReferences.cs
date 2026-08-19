using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// Which image files the flashcard collection still has a reason to keep.
/// </summary>
/// <remarks>
/// A card made from material shares its files with that material, and the same image can be used by
/// several pieces of material, so a file is only unreferenced once nothing at all names it. Rows the
/// trash is holding count as references: a file dropped while a card sat in the trash would come
/// back as a broken image.
/// </remarks>
public static class FlashcardAssetReferences
{
    /// <summary>The cleanup owner key purges write into their asset cleanup jobs.</summary>
    public const string AssetOwner = "flashcards";

    /// <summary>
    /// Whether a queued path is one of the paths <see cref="CollectReferencedPathsAsync"/> gathered.
    /// Asks through here rather than directly, so the caller does not have to know that the same
    /// file can be written with either kind of separator.
    /// </summary>
    public static bool Contains(HashSet<string> referenced, string path) =>
        FlashcardAssetPaths.Normalize(path) is { } normalized && referenced.Contains(normalized);

    /// <summary>
    /// Every attachment path any card or piece of material names, held rows included.
    /// </summary>
    public static Task<HashSet<string>> CollectReferencedPathsAsync(
        IFlashcardStore store,
        ILoggerService? logger = null,
        CancellationToken cancellationToken = default) =>
        store.ReadAsync(async (conn, ct) =>
        {
            var paths = new HashSet<string>(FlashcardAssetPaths.Comparer);

            await using (var cards = conn.CreateCommand())
            {
                cards.CommandText = "SELECT Id, AttachmentsJson FROM FlashcardCards;";
                await using var reader = await cards.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await reader.ReadAsync(ct).ConfigureAwait(false))
                {
                    var id = reader.GetString(0);
                    foreach (var attachment in FlashcardSqlMap.ReadAttachments(
                        reader.IsDBNull(1) ? null : reader.GetString(1), logger, $"card {id}"))
                    {
                        FlashcardAssetPaths.Add(paths, attachment.FilePath);
                    }
                }
            }

            await using (var facts = conn.CreateCommand())
            {
                facts.CommandText = "SELECT Id, MediaJson FROM FlashcardFacts;";
                await using var reader = await facts.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await reader.ReadAsync(ct).ConfigureAwait(false))
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
        }, cancellationToken);
}
