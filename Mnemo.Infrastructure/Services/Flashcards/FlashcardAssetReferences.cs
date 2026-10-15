using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
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

    private static readonly Regex InlineImageName = new(
        @"[0-9a-f]{64}\.(?:png|jpg|gif|webp|bmp)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// Whether a queued path is one of the paths <see cref="CollectReferencedPathsAsync"/> gathered.
    /// Asks through here rather than directly, so the caller does not have to know that the same
    /// file can be written with either kind of separator.
    /// </summary>
    public static bool Contains(HashSet<string> referenced, string path) =>
        FlashcardAssetPaths.Normalize(path) is { } normalized && referenced.Contains(normalized);

    public static Task<HashSet<string>> CollectReferencedPathsAsync(
        IFlashcardStore store,
        CancellationToken cancellationToken = default) =>
        store.ReadAsync(async (conn, ct) =>
        {
            var paths = new HashSet<string>(FlashcardAssetPaths.Comparer);

            await using (var cards = conn.CreateCommand())
            {
                cards.CommandText = "SELECT AttachmentsJson FROM FlashcardCards;";
                await using var reader = await cards.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await reader.ReadAsync(ct).ConfigureAwait(false))
                {
                    foreach (var attachment in FlashcardSqlMap.ReadAttachmentsStrict(reader.IsDBNull(0) ? null : reader.GetString(0)))
                        FlashcardAssetPaths.Add(paths, attachment.FilePath);
                }
            }

            await using (var facts = conn.CreateCommand())
            {
                facts.CommandText = "SELECT MediaJson FROM FlashcardFacts;";
                await using var reader = await facts.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await reader.ReadAsync(ct).ConfigureAwait(false))
                {
                    var media = FlashcardFactSqlMap.ReadMediaStrict(reader.IsDBNull(0) ? null : reader.GetString(0));
                    foreach (var group in media.Values)
                    {
                        foreach (var attachment in group)
                            FlashcardAssetPaths.Add(paths, attachment.FilePath);
                    }
                }
            }

            return paths;
        }, cancellationToken);

    /// <summary>Shared image names written into card or fact text, such as an Anki import's overflow images.</summary>
    public static Task<HashSet<string>> CollectInlineImageNamesAsync(
        IFlashcardStore store,
        CancellationToken cancellationToken = default) =>
        store.ReadAsync(async (conn, ct) =>
        {
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string[] queries =
            [
                "SELECT Front, Back, FrontRich, BackRich FROM FlashcardCards;",
                "SELECT ValuesJson FROM FlashcardFacts;",
            ];

            foreach (var query in queries)
            {
                await using var command = conn.CreateCommand();
                command.CommandText = query;
                await using var reader = await command.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await reader.ReadAsync(ct).ConfigureAwait(false))
                {
                    for (var i = 0; i < reader.FieldCount; i++)
                    {
                        if (reader.IsDBNull(i))
                            continue;
                        foreach (Match match in InlineImageName.Matches(reader.GetString(i)))
                            names.Add(match.Value);
                    }
                }
            }

            return names;
        }, cancellationToken);
}
