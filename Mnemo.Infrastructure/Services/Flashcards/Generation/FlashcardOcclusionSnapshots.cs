using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Generation;

/// <summary>Keeps the masks behind a card a save sweeps into the trash, so a restore can put them back.</summary>
internal static class FlashcardOcclusionSnapshots
{
    /// <summary>Stores, on each swept card, the masks of the unit it was made from in the fact as it was.</summary>
    public static async Task KeepAsync(
        SqliteConnection conn, SqliteTransaction tx, FlashcardFact before, IReadOnlyList<string> cardIds,
        CancellationToken cancellationToken)
    {
        if (cardIds.Count == 0)
            return;

        var units = FlashcardOcclusionUnits.Build(
            FlashcardOcclusion.Parse(before.Value(FlashcardCardType.OcclusionMasksFieldId)))
            .Units.ToDictionary(u => u.Key, StringComparer.Ordinal);

        foreach (var cardId in cardIds)
        {
            string? key;
            await using (var read = conn.CreateCommand())
            {
                read.Transaction = tx;
                read.CommandText = "SELECT LayoutKey FROM FlashcardCards WHERE Id = $id;";
                read.Parameters.AddWithValue("$id", cardId);
                key = await read.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
            }

            if (key is null || !units.TryGetValue(key, out var unit))
                continue;

            await using var write = conn.CreateCommand();
            write.Transaction = tx;
            write.CommandText = "UPDATE FlashcardCards SET SweptMaskJson = $json WHERE Id = $id;";
            write.Parameters.AddWithValue("$id", cardId);
            write.Parameters.AddWithValue(
                "$json", FlashcardOcclusion.Serialize(new OcclusionDocument(FlashcardOcclusion.HideAll, unit.Members)));
            await write.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// The fact's masks with a snapshot's appended. Ids the fact already has are skipped, so a repeat restore changes nothing.
    /// </summary>
    public static OcclusionDocument Merge(OcclusionDocument current, OcclusionDocument snapshot)
    {
        var have = current.Masks.Select(m => m.Id).ToHashSet(StringComparer.Ordinal);
        var next = current.Masks.Count == 0 ? 0 : current.Masks.Max(m => m.Order) + 1;
        var added = snapshot.Masks
            .Where(m => !have.Contains(m.Id))
            .OrderBy(m => m.Order)
            .Take(Math.Max(0, FlashcardOcclusion.MaxMasks - current.Masks.Count))
            .Select(m => m with { Order = next++ });

        return current with { Masks = [.. current.Masks, .. added] };
    }
}
