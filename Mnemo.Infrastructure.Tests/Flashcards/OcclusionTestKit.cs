using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Builds and reads image occlusion facts for the history tests.</summary>
internal static class OcclusionTestKit
{
    public static readonly DateTimeOffset Now = new(2026, 5, 1, 9, 0, 0, TimeSpan.Zero);

    internal static OcclusionMask Mask(string id, int order, string? label = null, string? group = null) =>
        new(id, FlashcardOcclusion.Rect, 0.1 + order * 0.01, 0.1, 0.2, 0.2, null, label, group, order);

    internal static string Doc(params OcclusionMask[] masks) => Doc(FlashcardOcclusion.HideAll, masks);

    internal static string Doc(string mode, params OcclusionMask[] masks) =>
        FlashcardOcclusion.Serialize(new OcclusionDocument(mode, masks));

    internal static Flashcard CardFor(FlashcardFactSaved saved, string key) =>
        saved.Cards.Single(c => c.LayoutKey == key);

    internal static Task<FlashcardFactSaved> SaveAsync(
        FlashcardStoreHarness h, string masks, string? id = null, string imageId = "img1", string front = "Q") =>
        h.FactService.SaveFactAsync(new FlashcardFactDraft(
            id,
            "deck-1",
            FlashcardCardType.OcclusionId,
            new Dictionary<string, string>
            {
                [FlashcardCardType.OcclusionFrontFieldId] = front,
                [FlashcardCardType.OcclusionMasksFieldId] = masks,
            },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>
            {
                [FlashcardCardType.OcclusionImageFieldId] =
                    [new FlashcardAttachment(imageId, FlashcardAttachment.FrontSide, $"C:/images/{imageId}.png", $"{imageId}.png", 10)],
            },
            []));

    internal static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    internal static async Task<OcclusionDocument> MasksAsync(FlashcardStoreHarness h, string factId)
    {
        var fact = await h.FactService.GetFactAsync(factId);
        return FlashcardOcclusion.Parse(fact!.Value(FlashcardCardType.OcclusionMasksFieldId));
    }

    internal static Task<Flashcard?> LiveCardAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, cardId, ct));

    internal static Task<FlashcardSchedule?> ScheduleAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, cardId, ct));

    internal static Task StudyAsync(FlashcardStoreHarness h, string cardId, int reps) =>
        h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            var schedule = await h.Schedules.GetAsync(conn, cardId, ct);
            await h.Schedules.UpsertAsync(conn, tx, schedule! with
            {
                Reps = reps,
                Stability = 12.5,
                Difficulty = 4.5,
                FsrsState = FlashcardFsrsState.Review,
            }, ct);
        });

    internal static Task<string?> SweptTrashIdAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT SweptTrashId FROM FlashcardCards WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", cardId);
            return await cmd.ExecuteScalarAsync(ct) as string;
        });

    internal static Task<string?> SnapshotAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT SweptMaskJson FROM FlashcardCards WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", cardId);
            return await cmd.ExecuteScalarAsync(ct) as string;
        });

    /// <summary>Runs one statement; each pair is a named parameter and its value.</summary>
    internal static Task<int> ExecuteAsync(FlashcardStoreHarness h, string sql, params (string Name, object Value)[] args) =>
        h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = sql;
            foreach (var (name, value) in args)
                cmd.Parameters.AddWithValue(name, value);
            return await cmd.ExecuteNonQueryAsync(ct);
        });
}
