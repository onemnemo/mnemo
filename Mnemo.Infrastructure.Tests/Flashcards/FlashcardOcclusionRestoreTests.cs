using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;
using static Mnemo.Infrastructure.Tests.Flashcards.OcclusionTestKit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Restoring an occlusion card a save swept away, and the cases where the restore must change nothing.</summary>
public sealed class FlashcardOcclusionRestoreTests
{
    private static async Task<(FlashcardFactSaved First, string CardB, string EntryId)> DeletedMaskAsync(
        FlashcardStoreHarness h)
    {
        var first = await SaveAsync(h, Doc(Mask("aa", 0, "One"), Mask("bb", 1, "Two")), front: "Old front");
        var cardB = CardFor(first, "mbb").Id;
        await StudyAsync(h, cardB, reps: 3);
        await SaveAsync(h, Doc(Mask("aa", 0, "One")), first.Fact.Id, front: "Old front");
        return (first, cardB, Assert.Single(await h.HeldAsync()).Id);
    }

    [Fact]
    public async Task Restoring_after_the_fact_was_edited_brings_the_card_up_to_date()
    {
        await using var h = await OpenAsync();
        var (first, cardB, entryId) = await DeletedMaskAsync(h);
        await SaveAsync(h, Doc(Mask("aa", 0, "One")), first.Fact.Id, imageId: "other", front: "New front");
        var before = await h.FactService.GetFactAsync(first.Fact.Id);

        var restored = Assert.Single(await h.Trash.RestoreAsync([entryId]));

        Assert.Equal(TrashRestoreOutcome.Restored, restored.Outcome);
        var card = await LiveCardAsync(h, cardB);
        Assert.Equal("New front", card!.Front);
        Assert.Equal("Two", card.Back);
        Assert.Equal("other", card.Attachments.Single().Id);
        Assert.Equal(3, (await ScheduleAsync(h, cardB))!.Reps);

        var after = await h.FactService.GetFactAsync(first.Fact.Id);
        Assert.True(after!.UpdatedAt > before!.UpdatedAt);
        Assert.Equal("New front", after.Value(FlashcardCardType.OcclusionFrontFieldId));
        Assert.Null(await SnapshotAsync(h, cardB));
    }

    [Fact]
    public async Task A_save_that_makes_a_swept_card_again_takes_it_out_of_the_trash_up_to_date()
    {
        await using var h = await OpenAsync();
        var (first, cardB, entryId) = await DeletedMaskAsync(h);

        await SaveAsync(h, Doc(Mask("aa", 0, "One"), Mask("bb", 1, "Two")), first.Fact.Id, front: "New front");

        Assert.DoesNotContain(await h.HeldAsync(), e => e.Id == entryId);
        var card = await LiveCardAsync(h, cardB);
        Assert.Equal("New front", card!.Front);
        Assert.Equal(3, (await ScheduleAsync(h, cardB))!.Reps);
    }

    [Fact]
    public async Task A_second_restore_of_the_same_entry_changes_nothing()
    {
        await using var h = await OpenAsync();
        var (first, cardB, entryId) = await DeletedMaskAsync(h);
        await h.Trash.RestoreAsync([entryId]);
        var masks = Doc((await MasksAsync(h, first.Fact.Id)).Masks.ToArray());

        var again = Assert.Single(await h.Trash.RestoreAsync([entryId]));

        Assert.NotEqual(TrashRestoreOutcome.Restored, again.Outcome);
        Assert.Equal(masks, Doc((await MasksAsync(h, first.Fact.Id)).Masks.ToArray()));
        Assert.NotNull(await LiveCardAsync(h, cardB));
    }

    [Fact]
    public async Task A_refused_restore_leaves_the_fact_the_snapshot_and_the_card_untouched()
    {
        await using var h = await OpenAsync();
        var (first, cardB, entryId) = await DeletedMaskAsync(h);
        var before = await h.FactService.GetFactAsync(first.Fact.Id);
        var snapshot = await SnapshotAsync(h, cardB);

        var refused = Assert.Single(await h.Trash.RestoreAsync([entryId], new TrashRestoreTarget("no-such-deck")));

        Assert.Equal(TrashRestoreOutcome.DestinationRequired, refused.Outcome);
        var after = await h.FactService.GetFactAsync(first.Fact.Id);
        Assert.Equal(before!.Values, after!.Values);
        Assert.Equal(before.UpdatedAt, after.UpdatedAt);
        Assert.Equal(snapshot, await SnapshotAsync(h, cardB));
        Assert.Null(await LiveCardAsync(h, cardB));
        Assert.Single(await h.HeldAsync());

        var retry = Assert.Single(await h.Trash.RestoreAsync([entryId]));
        Assert.Equal(TrashRestoreOutcome.Restored, retry.Outcome);
    }

    [Fact]
    public async Task A_masks_field_nothing_can_read_is_not_overwritten()
    {
        await using var h = await OpenAsync();
        var (first, cardB, entryId) = await DeletedMaskAsync(h);
        await ExecuteAsync(
            h,
            "UPDATE FlashcardFacts SET ValuesJson = json_set(ValuesJson, '$.masks', $v) WHERE Id = $id;",
            ("$v", "{not json"), ("$id", first.Fact.Id));

        var refused = Assert.Single(await h.Trash.RestoreAsync([entryId]));

        Assert.Equal(TrashRestoreOutcome.NoLongerGenerated, refused.Outcome);
        var fact = await h.FactService.GetFactAsync(first.Fact.Id);
        Assert.Equal("{not json", fact!.Value(FlashcardCardType.OcclusionMasksFieldId));
        Assert.NotNull(await SnapshotAsync(h, cardB));
        Assert.Null(await LiveCardAsync(h, cardB));
    }

    [Fact]
    public async Task A_restore_that_would_pass_the_mask_cap_is_refused()
    {
        await using var h = await OpenAsync();
        var full = Enumerable.Range(0, FlashcardOcclusion.MaxMasks).Select(i => Mask($"z{i}", 0) with { X = 0.1, Order = i }).ToArray();
        var first = await SaveAsync(h, Doc(full));
        var cardLast = CardFor(first, $"mz{FlashcardOcclusion.MaxMasks - 1}").Id;
        await SaveAsync(h, Doc(full[..^1]), first.Fact.Id);
        await SaveAsync(h, Doc([.. full[..^1], Mask("extra", 0) with { X = 0.1, Order = FlashcardOcclusion.MaxMasks }]), first.Fact.Id);

        var refused = Assert.Single(await h.Trash.RestoreAsync([Assert.Single(await h.HeldAsync()).Id]));

        Assert.Equal(TrashRestoreOutcome.NoLongerGenerated, refused.Outcome);
        Assert.Null(await LiveCardAsync(h, cardLast));
        Assert.Equal(FlashcardOcclusion.MaxMasks, (await MasksAsync(h, first.Fact.Id)).Masks.Count);
    }

    [Fact]
    public async Task A_stale_snapshot_cannot_bring_masks_back()
    {
        await using var h = await OpenAsync();
        var (first, cardB, entryId) = await DeletedMaskAsync(h);
        await ExecuteAsync(h, "UPDATE FlashcardCards SET SweptTrashId = 'older' WHERE Id = $id;", ("$id", cardB));

        var refused = Assert.Single(await h.Trash.RestoreAsync([entryId]));

        Assert.Equal(TrashRestoreOutcome.NoLongerGenerated, refused.Outcome);
        Assert.Equal(["aa"], (await MasksAsync(h, first.Fact.Id)).Masks.Select(m => m.Id));
    }

    [Fact]
    public async Task Saving_the_mask_back_clears_the_snapshot()
    {
        await using var h = await OpenAsync();
        var (first, cardB, _) = await DeletedMaskAsync(h);
        Assert.NotNull(await SnapshotAsync(h, cardB));

        await SaveAsync(h, Doc(Mask("aa", 0, "One"), Mask("bb", 1, "Two")), first.Fact.Id, front: "Old front");

        Assert.Null(await SnapshotAsync(h, cardB));
    }

    [Fact]
    public async Task Restoring_when_the_fact_already_makes_the_card_keeps_the_masks_and_clears_the_snapshot()
    {
        await using var h = await OpenAsync();
        var (first, cardB, entryId) = await DeletedMaskAsync(h);
        var withBb = Doc(Mask("aa", 0, "One"), Mask("bb", 1, "Typed by hand"));
        await ExecuteAsync(
            h,
            "UPDATE FlashcardFacts SET ValuesJson = json_set(ValuesJson, '$.masks', $v) WHERE Id = $id;",
            ("$v", withBb), ("$id", first.Fact.Id));

        var restored = Assert.Single(await h.Trash.RestoreAsync([entryId]));

        Assert.Equal(TrashRestoreOutcome.Restored, restored.Outcome);
        Assert.Equal("Typed by hand", (await MasksAsync(h, first.Fact.Id)).Masks.Single(m => m.Id == "bb").Label);
        Assert.Null(await SnapshotAsync(h, cardB));
        Assert.NotNull(await LiveCardAsync(h, cardB));
    }

    [Fact]
    public void Merging_skips_an_id_the_fact_already_has_and_appends_the_rest()
    {
        var current = new OcclusionDocument(FlashcardOcclusion.HideAll, [Mask("aa", 4, "Mine"), Mask("bb", 5, "Mine")]);
        var snapshot = new OcclusionDocument(FlashcardOcclusion.HideAll, [Mask("bb", 0, "Old"), Mask("cc", 1, "Old")]);

        var merged = FlashcardOcclusionSnapshots.Merge(current, snapshot);

        Assert.Equal(["aa", "bb", "cc"], merged.Masks.Select(m => m.Id));
        Assert.Equal("Mine", merged.Masks[1].Label);
        Assert.Equal(6, merged.Masks[2].Order);
    }

    [Fact]
    public async Task Retyping_an_occlusion_fact_is_refused_and_keeps_its_cards()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)));

        await Assert.ThrowsAsync<ArgumentException>(() => h.FactService.SaveFactAsync(new FlashcardFactDraft(
            first.Fact.Id,
            "deck-1",
            FlashcardCardType.BasicId,
            new Dictionary<string, string>
            {
                [FlashcardCardType.BasicFrontFieldId] = "Q",
                [FlashcardCardType.BasicBackFieldId] = "A",
            },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(),
            [])));

        var fact = await h.FactService.GetFactAsync(first.Fact.Id);
        Assert.Equal(FlashcardCardType.OcclusionId, fact!.TypeId);
        Assert.Empty(await h.HeldAsync());
    }
}
