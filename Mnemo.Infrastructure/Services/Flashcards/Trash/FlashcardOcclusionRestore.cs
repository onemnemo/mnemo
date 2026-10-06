using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards.Trash;

/// <summary>What restoring a swept occlusion card needs written to its fact first.</summary>
/// <param name="Updated">The fact with the swept masks merged back in.</param>
internal sealed record OcclusionRestorePlan(
    FlashcardCardType Type, FlashcardFact Updated, string CardId, string LayoutKey);

/// <summary>The outcome of planning: nothing to do, a merge to apply, or a refusal.</summary>
internal readonly record struct OcclusionRestoreCheck(OcclusionRestorePlan? Plan, bool Refused);

/// <summary>Puts back the masks behind a card a save swept into the trash, so the restored card is generated again.</summary>
internal static class FlashcardOcclusionRestore
{
    private const string Category = "Flashcards";

    /// <summary>
    /// Works out, without writing, what a restore must do to the fact. A refusal means the masks cannot be put back.
    /// </summary>
    public static async Task<OcclusionRestoreCheck> PlanAsync(
        SqliteConnection conn, SqliteTransaction tx, string entryId, DateTimeOffset now,
        ILoggerService? logger, CancellationToken cancellationToken)
    {
        string cardId, key, factId, snapshotJson;
        await using (var read = conn.CreateCommand())
        {
            read.Transaction = tx;

            // A snapshot only counts for a card this very sweep put away; an older one is stale.
            read.CommandText = """
                SELECT c.Id, c.LayoutKey, c.FactId, c.SweptMaskJson FROM FlashcardCards c
                WHERE c.TrashId = $entry AND c.SweptTrashId = c.TrashId AND c.SweptMaskJson IS NOT NULL
                  AND c.LayoutKey IS NOT NULL AND c.FactId IS NOT NULL LIMIT 1;
                """;
            read.Parameters.AddWithValue("$entry", entryId);
            await using var rows = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await rows.ReadAsync(cancellationToken).ConfigureAwait(false))
                return default;

            cardId = rows.GetString(0);
            key = rows.GetString(1);
            factId = rows.GetString(2);
            snapshotJson = rows.GetString(3);
        }

        var facts = new FactRepository(logger);
        var fact = await facts.GetAsync(conn, factId, cancellationToken).ConfigureAwait(false);
        if (fact is null)
            return default;

        var type = await new CardTypeRepository(logger).GetAsync(conn, fact.TypeId, cancellationToken).ConfigureAwait(false);
        if (type is null || !string.Equals(type.Generator, FlashcardGenerators.Occlusion, StringComparison.Ordinal)
            || Makes(type, fact, key))
            return default;

        // Merging into a value nothing can read would overwrite it, so the restore stops instead.
        var raw = fact.Value(FlashcardCardType.OcclusionMasksFieldId);
        var current = FlashcardOcclusion.Parse(raw);
        if (current.Masks.Count == 0 && !string.IsNullOrWhiteSpace(raw) && !IsEmptyDocument(raw))
        {
            logger?.Warning(Category, $"Occlusion restore refused: the masks of fact {factId} are not readable.");
            return new OcclusionRestoreCheck(null, true);
        }

        var merged = FlashcardOcclusionSnapshots.Merge(current, FlashcardOcclusion.Parse(snapshotJson));
        var updated = fact with
        {
            Values = new Dictionary<string, string>(fact.Values, StringComparer.Ordinal)
            {
                [FlashcardCardType.OcclusionMasksFieldId] = FlashcardOcclusion.Serialize(merged),
            },
            UpdatedAt = now,
        };
        if (!Makes(type, updated, key))
        {
            logger?.Warning(Category, $"Occlusion restore refused: the masks of card {cardId} do not fit back into fact {factId}.");
            return new OcclusionRestoreCheck(null, true);
        }

        return new OcclusionRestoreCheck(new OcclusionRestorePlan(type, updated, cardId, key), false);
    }

    /// <summary>Writes the fact with the swept masks merged back in.</summary>
    public static Task WriteFactAsync(
        SqliteConnection writer, SqliteTransaction tx, OcclusionRestorePlan plan, ILoggerService? logger,
        CancellationToken cancellationToken) =>
        new FactRepository(logger).UpsertAsync(writer, tx, plan.Updated, cancellationToken);

    /// <summary>Brings the card up to what the fact now says. The card must already be live.</summary>
    public static Task RefreshCardAsync(
        SqliteConnection writer, SqliteTransaction tx, OcclusionRestorePlan plan, DateTimeOffset now,
        ILoggerService? logger, CancellationToken cancellationToken) =>
        new FlashcardCardMaterializer(new CardRepository(), new ScheduleRepository(), new FactRepository(logger))
            .RefreshAsync(writer, tx, plan.Type, plan.Updated, plan.CardId, plan.LayoutKey, now, cancellationToken);

    /// <summary>Drops the snapshot of every card the entry holds, since they are about to be live.</summary>
    public static async Task ClearSnapshotsAsync(
        SqliteConnection writer, SqliteTransaction tx, string entryId, CancellationToken cancellationToken)
    {
        await using var clear = writer.CreateCommand();
        clear.Transaction = tx;
        clear.CommandText = "UPDATE FlashcardCards SET SweptMaskJson = NULL WHERE TrashId = $entry AND SweptMaskJson IS NOT NULL;";
        clear.Parameters.AddWithValue("$entry", entryId);
        await clear.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Whether the text is a readable document that simply holds no masks.</summary>
    private static bool IsEmptyDocument(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("masks", out var masks)
                && masks.ValueKind == JsonValueKind.Array
                && masks.GetArrayLength() == 0
                && !(doc.RootElement.TryGetProperty("v", out var v) && !(v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n) && n == FlashcardOcclusion.Version));
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool Makes(FlashcardCardType type, FlashcardFact fact, string key) =>
        FlashcardGeneration.Generate(type, fact).Any(card => string.Equals(card.Key, key, StringComparison.Ordinal));
}
