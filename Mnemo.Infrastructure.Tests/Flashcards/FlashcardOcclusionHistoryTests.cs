using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;
using static Mnemo.Infrastructure.Tests.Flashcards.OcclusionTestKit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Which card an edit to an occlusion fact keeps, adds or trashes. A kept key keeps the schedule.</summary>
public sealed class FlashcardOcclusionHistoryTests
{
    [Fact]
    public async Task Each_mask_makes_one_occlusion_card_keyed_by_its_id()
    {
        await using var h = await OpenAsync();

        var saved = await SaveAsync(h, Doc(Mask("aa", 0, "One"), Mask("bb", 1, "Two")));

        Assert.Equal(["maa", "mbb"], saved.Cards.Select(c => c.LayoutKey).Order(StringComparer.Ordinal));
        Assert.All(saved.Cards, c => Assert.Equal(FlashcardType.Occlusion, c.Type));
        Assert.Equal(2, saved.Added);
    }

    [Fact]
    public async Task Moving_resizing_relabelling_and_reordering_keep_every_card_and_its_history()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0, "One"), Mask("bb", 1, "Two")));
        var cardA = CardFor(first, "maa").Id;
        await StudyAsync(h, cardA, reps: 6);

        var edited = await SaveAsync(
            h,
            Doc(
                Mask("bb", 0, "Two renamed"),
                Mask("aa", 1, "One renamed") with { X = 0.6, W = 0.3 }),
            first.Fact.Id);

        Assert.Equal(0, edited.Added);
        Assert.Equal(0, edited.Removed);
        Assert.Equal(cardA, CardFor(edited, "maa").Id);
        Assert.Equal(6, (await ScheduleAsync(h, cardA))!.Reps);
        Assert.Equal("One renamed", CardFor(edited, "maa").Back);
    }

    [Fact]
    public async Task Changing_the_mode_keeps_every_card()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)));

        var edited = await SaveAsync(h, Doc(FlashcardOcclusion.HideOne, Mask("aa", 0), Mask("bb", 1)), first.Fact.Id);

        Assert.Equal(0, edited.Added);
        Assert.Equal(0, edited.Removed);
        Assert.Equal(
            first.Cards.Select(c => c.Id).Order(StringComparer.Ordinal),
            edited.Cards.Select(c => c.Id).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Adding_a_mask_adds_exactly_one_card()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0)));

        var edited = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)), first.Fact.Id);

        Assert.Equal(1, edited.Added);
        Assert.Equal(2, edited.Cards.Count);
    }

    [Fact]
    public async Task Deleting_a_mask_puts_only_its_card_in_the_trash_with_its_history()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0, "One"), Mask("bb", 1, "Two")));
        var cardB = CardFor(first, "mbb").Id;
        await StudyAsync(h, cardB, reps: 4);

        var edited = await SaveAsync(h, Doc(Mask("aa", 0, "One")), first.Fact.Id);

        Assert.Equal(1, edited.Removed);
        Assert.Null(await LiveCardAsync(h, cardB));
        var entry = Assert.Single(await h.HeldAsync());
        Assert.Equal(cardB, entry.ItemId);
        Assert.Equal(entry.Id, await SweptTrashIdAsync(h, cardB));
        Assert.Equal(4, (await ScheduleAsync(h, cardB))!.Reps);
    }

    [Fact]
    public async Task Restoring_a_deleted_mask_card_brings_the_mask_and_the_history_back()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0, "One"), Mask("bb", 1, "Two") with { X = 0.55 }));
        var cardB = CardFor(first, "mbb").Id;
        await StudyAsync(h, cardB, reps: 4);
        await SaveAsync(h, Doc(Mask("aa", 0, "One")), first.Fact.Id);

        var entry = Assert.Single(await h.HeldAsync());
        var restored = Assert.Single(await h.Trash.RestoreAsync([entry.Id]));

        Assert.Equal(TrashRestoreOutcome.Restored, restored.Outcome);
        Assert.NotNull(await LiveCardAsync(h, cardB));
        Assert.Equal(4, (await ScheduleAsync(h, cardB))!.Reps);
        var masks = (await MasksAsync(h, first.Fact.Id)).Masks;
        Assert.Equal(["aa", "bb"], masks.Select(m => m.Id));
        var back = masks.Single(m => m.Id == "bb");
        Assert.Equal("Two", back.Label);
        Assert.Equal(0.55, back.X);
        Assert.Equal(1, back.Order);
    }

    [Fact]
    public async Task A_restored_mask_goes_to_the_end_of_the_order()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1), Mask("cc", 2)));
        await SaveAsync(h, Doc(Mask("aa", 0), Mask("cc", 2)), first.Fact.Id);

        await h.Trash.RestoreAsync([Assert.Single(await h.HeldAsync()).Id]);

        var masks = (await MasksAsync(h, first.Fact.Id)).Masks;
        Assert.Equal(["aa", "cc", "bb"], masks.OrderBy(m => m.Order).Select(m => m.Id));
    }

    [Fact]
    public async Task Restoring_still_works_after_the_image_was_replaced()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)));
        var cardB = CardFor(first, "mbb").Id;
        var second = await SaveAsync(h, Doc(Mask("aa", 0)), first.Fact.Id);
        await SaveAsync(h, Doc(Mask("aa", 0)), second.Fact.Id, imageId: "other");

        var restored = Assert.Single(await h.Trash.RestoreAsync([Assert.Single(await h.HeldAsync()).Id]));

        Assert.Equal(TrashRestoreOutcome.Restored, restored.Outcome);
        Assert.NotNull(await LiveCardAsync(h, cardB));
    }

    [Fact]
    public async Task A_card_swept_without_a_snapshot_is_still_refused_when_nothing_generates_it()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)));
        var cardB = CardFor(first, "mbb").Id;
        await SaveAsync(h, Doc(Mask("aa", 0)), first.Fact.Id);
        await ExecuteAsync(h, "UPDATE FlashcardCards SET SweptMaskJson = NULL WHERE Id = $id;", ("$id", cardB));

        var refused = Assert.Single(await h.Trash.RestoreAsync([Assert.Single(await h.HeldAsync()).Id]));

        Assert.Equal(TrashRestoreOutcome.NoLongerGenerated, refused.Outcome);
        Assert.Null(await LiveCardAsync(h, cardB));
    }

    [Fact]
    public async Task Saving_the_deleted_mask_back_takes_its_card_out_of_the_trash()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)));
        var cardB = CardFor(first, "mbb").Id;
        await StudyAsync(h, cardB, reps: 5);
        await SaveAsync(h, Doc(Mask("aa", 0)), first.Fact.Id);

        var again = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)), first.Fact.Id);

        Assert.Equal(cardB, CardFor(again, "mbb").Id);
        Assert.Empty(await h.HeldAsync());
        Assert.Equal(5, (await ScheduleAsync(h, cardB))!.Reps);
    }

    [Fact]
    public async Task A_fact_with_no_masks_is_refused_and_leaves_its_cards()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0)));

        await Assert.ThrowsAsync<ArgumentException>(() => SaveAsync(h, Doc(), first.Fact.Id));

        Assert.NotNull(await LiveCardAsync(h, CardFor(first, "maa").Id));
    }

    [Fact]
    public async Task The_trash_lists_an_occlusion_fact_by_its_front_text_or_the_type_name()
    {
        await using var h = await OpenAsync();
        var titled = await SaveAsync(h, Doc(Mask("aa", 0)), front: "Plant cell");
        var untitled = await SaveAsync(h, Doc(Mask("aa", 0)), front: string.Empty);

        await h.Trash.DeleteAsync([
            new TrashDeleteRequest(FlashcardFactTrashSource.TrashKind, titled.Fact.Id),
            new TrashDeleteRequest(FlashcardFactTrashSource.TrashKind, untitled.Fact.Id)]);

        var titles = (await h.HeldAsync()).Select(e => e.Title).Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(["Image occlusion", "Plant cell"], titles);
    }

    [Fact]
    public async Task Deleting_one_card_leaves_the_shared_image_on_the_fact()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)));

        await h.Trash.DeleteAsync([new TrashDeleteRequest(FlashcardCardTrashSource.TrashKind, CardFor(first, "maa").Id)]);

        var fact = await h.FactService.GetFactAsync(first.Fact.Id);
        Assert.Single(fact!.MediaOn(FlashcardCardType.OcclusionImageFieldId));
        Assert.Equal("img1", (await LiveCardAsync(h, CardFor(first, "mbb").Id))!.Attachments.Single().Id);

        // The file is still named by the collection, so the cleanup pass keeps it.
        var referenced = await FlashcardAssetReferences.CollectReferencedPathsAsync(h.Store);
        Assert.True(FlashcardAssetReferences.Contains(referenced, "C:/images/img1.png"));
    }
}
