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
/// Material left with nothing to show once a permanent deletion took the last card it made.
/// </summary>
/// <remarks>
/// The ordinary delete path already clears these away, so a purge that left them behind would grow a
/// collection of material nobody can study and nobody asked to keep.
/// </remarks>
internal static class FlashcardTrashOrphans
{
    /// <summary>Destroys the named material and queues the files it was the reason to keep.</summary>
    public static async Task DestroyFactsAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        IReadOnlyList<string> factIds,
        ILoggerService? logger,
        CancellationToken cancellationToken)
    {
        if (factIds.Count == 0)
            return;

        var paths = new HashSet<string>(FlashcardAssetPaths.Comparer);

        for (var offset = 0; offset < factIds.Count; offset += FlashcardTrashSql.ChunkSize)
        {
            var take = Math.Min(FlashcardTrashSql.ChunkSize, factIds.Count - offset);
            var names = new List<string>(take);

            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                for (var i = 0; i < take; i++)
                {
                    var name = $"$f{i}";
                    names.Add(name);
                    read.Parameters.AddWithValue(name, factIds[offset + i]);
                }

                read.CommandText = $"SELECT Id, MediaJson FROM FlashcardFacts WHERE Id IN ({string.Join(", ", names)});";
                await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
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

            await using var delete = writer.CreateCommand();
            delete.Transaction = tx;
            for (var i = 0; i < take; i++)
                delete.Parameters.AddWithValue(names[i], factIds[offset + i]);

            delete.CommandText = $"DELETE FROM FlashcardFacts WHERE Id IN ({string.Join(", ", names)});";
            await delete.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await AssetCleanupQueue.EnqueueAsync(
            writer,
            tx,
            FlashcardAssetReferences.AssetOwner,
            paths,
            DateTimeOffset.UtcNow,
            cancellationToken).ConfigureAwait(false);
    }
}
