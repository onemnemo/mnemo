using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Generation;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Gives every card written before card types existed the fact it was always implicitly holding.
/// </summary>
/// <remarks>
/// <para>
/// A classic card becomes a fact of the basic type making the one card it already was, keeping its
/// text, its media and its identity exactly. That is the overwhelming majority of any collection
/// and it is deliberately the path that changes least.
/// </para>
/// <para>
/// A cloze card is the one that genuinely splits. It held several deletions folded into a single
/// card with a single schedule and a single history, and it becomes one card per deletion. The
/// accumulated scheduling stays on the lowest deletion, which keeps the row, its id and its whole
/// review history intact, and the deletions that were never separately answerable start new. The
/// alternatives were dividing one history several ways, which invents data, or resetting all of
/// it, which throws data away.
/// </para>
/// <para>
/// A cloze card holding no deletion marker at all becomes a basic fact rather than a cloze one.
/// Generation would make no cards for it, and losing a card to a classification the user never
/// typed is not an acceptable outcome of an upgrade.
/// </para>
/// </remarks>
internal static class FlashcardFactBackfill
{
    private const int BatchSize = 500;
    private const int ClassicTypeOrdinal = 0;
    private const int ClozeTypeOrdinal = 1;

    public static async Task ApplyAsync(FlashcardMigrationContext context)
    {
        await SeedCardTypesAsync(context).ConfigureAwait(false);

        foreach (var batch in (await ReadUnmigratedCardIdsAsync(context).ConfigureAwait(false)).Chunk(BatchSize))
        {
            foreach (var card in await ReadCardsAsync(context, batch).ConfigureAwait(false))
                await MigrateCardAsync(context, card).ConfigureAwait(false);
        }
    }

    private static async Task SeedCardTypesAsync(FlashcardMigrationContext context)
    {
        var now = FlashcardSqlMap.Ts(context.Time.GetUtcNow());
        foreach (var type in FlashcardCardType.CreateBuiltIns(context.Time.GetUtcNow()))
        {
            await using var cmd = context.CreateCommand();
            cmd.CommandText = """
                INSERT OR IGNORE INTO FlashcardCardTypes
                    (Id, Name, IsBuiltIn, FieldsJson, SortFieldId, LayoutsJson, Generator, GenerateFrom, CreatedAt, UpdatedAt)
                VALUES ($id, $name, 1, $fields, $sort, $layouts, $generator, $from, $at, $at);
                """;
            cmd.Parameters.AddWithValue("$id", type.Id);
            cmd.Parameters.AddWithValue("$name", type.Name);
            cmd.Parameters.AddWithValue("$fields", FlashcardFactSqlMap.Fields(type.Fields));
            cmd.Parameters.AddWithValue("$sort", type.SortFieldId);
            cmd.Parameters.AddWithValue("$layouts", FlashcardFactSqlMap.Layouts(type.Layouts));
            cmd.Parameters.AddWithValue("$generator", (object?)type.Generator ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$from", (object?)type.GenerateFrom ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$at", now);
            await cmd.ExecuteNonQueryAsync(context.CancellationToken).ConfigureAwait(false);
        }
    }

    private static async Task<List<string>> ReadUnmigratedCardIdsAsync(FlashcardMigrationContext context)
    {
        var ids = new List<string>();
        await using var cmd = context.CreateCommand();
        cmd.CommandText = "SELECT Id FROM FlashcardCards WHERE FactId IS NULL ORDER BY rowid;";
        await using var reader = await cmd.ExecuteReaderAsync(context.CancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(context.CancellationToken).ConfigureAwait(false))
            ids.Add(reader.GetString(0));
        return ids;
    }

    private static async Task<List<LegacyCard>> ReadCardsAsync(FlashcardMigrationContext context, IReadOnlyList<string> ids)
    {
        var cards = new List<LegacyCard>(ids.Count);
        await using var cmd = context.CreateCommand();
        var placeholders = string.Join(",", ids.Select((_, i) => $"$p{i}"));
        cmd.CommandText = $"""
            SELECT Id, DeckId, Type, Front, Back, TagsJson, IsFlagged, AttachmentsJson,
                   SourceType, SourceId, SourceLabel, CreatedAt, UpdatedAt, State
            FROM FlashcardCards WHERE Id IN ({placeholders});
            """;
        for (var i = 0; i < ids.Count; i++)
            cmd.Parameters.AddWithValue($"$p{i}", ids[i]);

        await using var reader = await cmd.ExecuteReaderAsync(context.CancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(context.CancellationToken).ConfigureAwait(false))
        {
            cards.Add(new LegacyCard(
                Id: reader.GetString(0),
                DeckId: reader.GetString(1),
                Type: reader.IsDBNull(2) ? ClassicTypeOrdinal : reader.GetInt32(2),
                Front: reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
                Back: reader.IsDBNull(4) ? string.Empty : reader.GetString(4),
                TagsJson: reader.IsDBNull(5) ? "[]" : reader.GetString(5),
                IsFlagged: !reader.IsDBNull(6) && reader.GetInt32(6) != 0,
                AttachmentsJson: reader.IsDBNull(7) ? "[]" : reader.GetString(7),
                SourceType: reader.IsDBNull(8) ? null : reader.GetString(8),
                SourceId: reader.IsDBNull(9) ? null : reader.GetString(9),
                SourceLabel: reader.IsDBNull(10) ? null : reader.GetString(10),
                CreatedAt: reader.GetString(11),
                UpdatedAt: reader.GetString(12),
                State: reader.IsDBNull(13) ? 0 : reader.GetInt32(13)));
        }

        return cards;
    }

    private static async Task MigrateCardAsync(FlashcardMigrationContext context, LegacyCard card)
    {
        var ordinals = card.Type == ClozeTypeOrdinal
            ? FlashcardGeneration.ClozeOrdinals(card.Front)
            : [];
        var asCloze = ordinals.Count > 0;

        var (typeId, frontFieldId, backFieldId) = asCloze
            ? (FlashcardCardType.ClozeId, FlashcardCardType.ClozeTextFieldId, FlashcardCardType.ClozeExtraFieldId)
            : (FlashcardCardType.BasicId, FlashcardCardType.BasicFrontFieldId, FlashcardCardType.BasicBackFieldId);

        var factId = Guid.NewGuid().ToString("N");
        await InsertFactAsync(context, factId, card, typeId, frontFieldId, backFieldId).ConfigureAwait(false);

        if (!asCloze)
        {
            // The card already is what its layout produces, so nothing about it changes except
            // that it now knows which material it came from.
            await AttachCardAsync(
                context, card.Id, factId, FlashcardCardType.RecognitionLayoutId, ClassicTypeOrdinal,
                card.Front, card.Back).ConfigureAwait(false);
            return;
        }

        var extra = card.Back.Trim();
        var lowest = ordinals[0];
        await AttachCardAsync(
            context, card.Id, factId, FlashcardGeneration.ClozeKey(lowest), ClozeTypeOrdinal,
            FlashcardGeneration.MaskCloze(card.Front, lowest, reveal: false),
            JoinParagraphs(FlashcardGeneration.MaskCloze(card.Front, lowest, reveal: true), extra)).ConfigureAwait(false);

        foreach (var ordinal in ordinals.Skip(1))
        {
            await InsertSiblingAsync(
                context, card, factId, FlashcardGeneration.ClozeKey(ordinal),
                FlashcardGeneration.MaskCloze(card.Front, ordinal, reveal: false),
                JoinParagraphs(FlashcardGeneration.MaskCloze(card.Front, ordinal, reveal: true), extra)).ConfigureAwait(false);
        }
    }

    private static async Task InsertFactAsync(
        FlashcardMigrationContext context, string factId, LegacyCard card,
        string typeId, string frontFieldId, string backFieldId)
    {
        await using var cmd = context.CreateCommand();
        cmd.CommandText = """
            INSERT INTO FlashcardFacts
                (Id, DeckId, TypeId, ValuesJson, MediaJson, TagsJson, IsFlagged,
                 SourceType, SourceId, SourceLabel, CreatedAt, UpdatedAt)
            VALUES ($id, $deck, $type, $values, $media, $tags, $flagged,
                 $srcType, $srcId, $srcLabel, $created, $updated);
            """;
        cmd.Parameters.AddWithValue("$id", factId);
        cmd.Parameters.AddWithValue("$deck", card.DeckId);
        cmd.Parameters.AddWithValue("$type", typeId);
        cmd.Parameters.AddWithValue("$values", ValuesJson(card, frontFieldId, backFieldId));
        cmd.Parameters.AddWithValue("$media", MediaJson(card.AttachmentsJson, frontFieldId, backFieldId));
        cmd.Parameters.AddWithValue("$tags", card.TagsJson);
        cmd.Parameters.AddWithValue("$flagged", card.IsFlagged ? 1 : 0);
        cmd.Parameters.AddWithValue("$srcType", (object?)card.SourceType ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$srcId", (object?)card.SourceId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$srcLabel", (object?)card.SourceLabel ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$created", card.CreatedAt);
        cmd.Parameters.AddWithValue("$updated", card.UpdatedAt);
        await cmd.ExecuteNonQueryAsync(context.CancellationToken).ConfigureAwait(false);
    }

    private static async Task AttachCardAsync(
        FlashcardMigrationContext context, string cardId, string factId, string layoutKey,
        int typeOrdinal, string front, string back)
    {
        await using var cmd = context.CreateCommand();
        cmd.CommandText = """
            UPDATE FlashcardCards
            SET FactId = $fact, LayoutKey = $key, Type = $type, Front = $front, Back = $back
            WHERE Id = $id;
            """;
        cmd.Parameters.AddWithValue("$fact", factId);
        cmd.Parameters.AddWithValue("$key", layoutKey);
        cmd.Parameters.AddWithValue("$type", typeOrdinal);
        cmd.Parameters.AddWithValue("$front", front);
        cmd.Parameters.AddWithValue("$back", back);
        cmd.Parameters.AddWithValue("$id", cardId);
        await cmd.ExecuteNonQueryAsync(context.CancellationToken).ConfigureAwait(false);
    }

    private static async Task InsertSiblingAsync(
        FlashcardMigrationContext context, LegacyCard source, string factId,
        string layoutKey, string front, string back)
    {
        var cardId = Guid.NewGuid().ToString("N");

        await using (var cmd = context.CreateCommand())
        {
            cmd.CommandText = """
                INSERT INTO FlashcardCards
                    (Id, DeckId, Type, Front, Back, TagsJson, State, IsFlagged,
                     AttachmentsJson, SourceType, SourceId, SourceLabel, CreatedAt, UpdatedAt, FactId, LayoutKey)
                VALUES ($id, $deck, $type, $front, $back, $tags, $state, $flagged,
                     $attach, $srcType, $srcId, $srcLabel, $created, $updated, $fact, $key);
                """;
            cmd.Parameters.AddWithValue("$id", cardId);
            cmd.Parameters.AddWithValue("$deck", source.DeckId);
            cmd.Parameters.AddWithValue("$type", ClozeTypeOrdinal);
            cmd.Parameters.AddWithValue("$front", front);
            cmd.Parameters.AddWithValue("$back", back);
            cmd.Parameters.AddWithValue("$tags", source.TagsJson);
            // A deck the user had suspended stays suspended in every part it turns out to have.
            cmd.Parameters.AddWithValue("$state", source.State);
            cmd.Parameters.AddWithValue("$flagged", source.IsFlagged ? 1 : 0);
            // Each deletion shows the source field on the front and the extra field on the back,
            // which is the side split the card already carried.
            cmd.Parameters.AddWithValue("$attach", source.AttachmentsJson);
            cmd.Parameters.AddWithValue("$srcType", (object?)source.SourceType ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$srcId", (object?)source.SourceId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$srcLabel", (object?)source.SourceLabel ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$created", source.CreatedAt);
            cmd.Parameters.AddWithValue("$updated", source.UpdatedAt);
            cmd.Parameters.AddWithValue("$fact", factId);
            cmd.Parameters.AddWithValue("$key", layoutKey);
            await cmd.ExecuteNonQueryAsync(context.CancellationToken).ConfigureAwait(false);
        }

        await using var schedule = context.CreateCommand();
        schedule.CommandText = """
            INSERT INTO FlashcardScheduling
                (CardId, DueDate, Stability, Difficulty, Reps, Lapses, FsrsState, LearningStepIndex, LastReviewedAt)
            VALUES ($id, $due, NULL, NULL, 0, 0, 0, 0, NULL);
            """;
        schedule.Parameters.AddWithValue("$id", cardId);
        schedule.Parameters.AddWithValue("$due", FlashcardSqlMap.Ts(context.Time.GetUtcNow()));
        await schedule.ExecuteNonQueryAsync(context.CancellationToken).ConfigureAwait(false);
    }

    private static string ValuesJson(LegacyCard card, string frontFieldId, string backFieldId)
    {
        var values = new JsonObject
        {
            [frontFieldId] = card.Front,
            [backFieldId] = card.Back,
        };
        return values.ToJsonString();
    }

    /// <summary>
    /// Rekeys the card's attachments from the side they hung off to the field that now owns them.
    /// </summary>
    /// <remarks>
    /// Done on the raw JSON rather than through the attachment record so that a property this
    /// build does not know about survives the move. An attachment written by a later build and
    /// read by this migration must come out the other side whole.
    /// </remarks>
    private static string MediaJson(string attachmentsJson, string frontFieldId, string backFieldId)
    {
        if (TryReadAttachments(attachmentsJson) is not { Count: > 0 } attachments)
            return "{}";

        var front = new JsonArray();
        var back = new JsonArray();
        foreach (var node in attachments.ToArray())
        {
            if (node is not JsonObject attachment)
                continue;
            attachments.Remove(node);
            (IsBackSide(attachment) ? back : front).Add(attachment);
        }

        var media = new JsonObject();
        if (front.Count > 0)
            media[frontFieldId] = front;
        if (back.Count > 0)
            media[backFieldId] = back;
        return media.ToJsonString();
    }

    /// <summary>
    /// The attachments the card was stored with, or null when the column holds something this
    /// build cannot read.
    /// </summary>
    /// <remarks>
    /// Every runtime read of this column falls back to no attachments rather than throwing, and the
    /// upgrade has to hold the same line. It runs inside the transaction that stamps the version,
    /// before anything else can touch the collection, so a throw here rolls the stamp back with it
    /// and the same row fails the same way on the next launch, taking the whole module down for one
    /// unreadable card. The raw text is left on the card either way, so nothing that could not be
    /// read is thrown away.
    /// </remarks>
    private static JsonArray? TryReadAttachments(string attachmentsJson)
    {
        try
        {
            return JsonNode.Parse(attachmentsJson) as JsonArray;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static bool IsBackSide(JsonObject attachment)
    {
        foreach (var property in attachment)
        {
            if (!string.Equals(property.Key, "Side", StringComparison.OrdinalIgnoreCase))
                continue;
            return string.Equals(
                property.Value?.GetValue<string>(),
                FlashcardAttachment.BackSide,
                StringComparison.OrdinalIgnoreCase);
        }

        return false;
    }

    private static string JoinParagraphs(params string[] parts) =>
        string.Join("\n\n", parts.Where(p => !string.IsNullOrEmpty(p)));

    private sealed record LegacyCard(
        string Id,
        string DeckId,
        int Type,
        string Front,
        string Back,
        string TagsJson,
        bool IsFlagged,
        string AttachmentsJson,
        string? SourceType,
        string? SourceId,
        string? SourceLabel,
        string CreatedAt,
        string UpdatedAt,
        int State);
}
