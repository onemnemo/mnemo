using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;
using static Mnemo.Infrastructure.Tests.Flashcards.OcclusionTestKit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Grouping and ungrouping masks: a group is one card keyed by an opaque label.</summary>
public sealed class FlashcardOcclusionGroupTests
{
    [Fact]
    public async Task Restoring_a_group_card_brings_back_every_member_with_the_shared_label()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(
            Mask("aa", 0, "One", group: "bb"), Mask("bb", 1, "Two", group: "bb"), Mask("cc", 2, "Three")));
        var group = CardFor(first, "mbb").Id;
        await StudyAsync(h, group, reps: 3);
        await SaveAsync(h, Doc(Mask("cc", 2, "Three")), first.Fact.Id);

        var restored = Assert.Single(await h.Trash.RestoreAsync([Assert.Single(await h.HeldAsync()).Id]));

        Assert.Equal(TrashRestoreOutcome.Restored, restored.Outcome);
        var masks = (await MasksAsync(h, first.Fact.Id)).Masks;
        Assert.Equal(["aa", "bb"], masks.Where(m => m.Group == "bb").Select(m => m.Id).Order(StringComparer.Ordinal));
        Assert.Equal(3, (await ScheduleAsync(h, group))!.Reps);
    }

    [Fact]
    public async Task Grouping_keeps_the_first_members_card_and_puts_the_others_in_the_trash()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0, "One"), Mask("bb", 1, "Two"), Mask("cc", 2, "Three")));
        var cardA = CardFor(first, "maa").Id;
        var cardB = CardFor(first, "mbb").Id;
        await StudyAsync(h, cardA, reps: 7);

        var grouped = await SaveAsync(
            h, Doc(Mask("aa", 0, "One", group: "aa"), Mask("bb", 1, "Two", group: "aa"), Mask("cc", 2, "Three")), first.Fact.Id);

        Assert.Equal(1, grouped.Removed);
        Assert.Equal(cardA, CardFor(grouped, "maa").Id);
        Assert.Equal("One, Two", CardFor(grouped, "maa").Back);
        Assert.Equal(7, (await ScheduleAsync(h, cardA))!.Reps);
        Assert.Null(await LiveCardAsync(h, cardB));
        Assert.Equal(cardB, Assert.Single(await h.HeldAsync()).ItemId);
    }

    [Fact]
    public async Task Reordering_after_grouping_keeps_the_group_key()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0, group: "aa"), Mask("bb", 1, group: "aa")));
        var card = CardFor(first, "maa").Id;

        var reordered = await SaveAsync(h, Doc(Mask("bb", 0, group: "aa"), Mask("aa", 1, group: "aa")), first.Fact.Id);

        Assert.Equal(0, reordered.Added);
        Assert.Equal(0, reordered.Removed);
        Assert.Equal(card, CardFor(reordered, "maa").Id);
    }

    [Fact]
    public async Task Deleting_the_anchor_mask_keeps_the_group_card()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0, group: "aa"), Mask("bb", 1, group: "aa"), Mask("cc", 2, group: "aa")));
        var card = CardFor(first, "maa").Id;
        await StudyAsync(h, card, reps: 9);

        var edited = await SaveAsync(h, Doc(Mask("bb", 1, group: "aa"), Mask("cc", 2, group: "aa")), first.Fact.Id);

        Assert.Equal(0, edited.Removed);
        Assert.Equal(card, CardFor(edited, "maa").Id);
        Assert.Equal(9, (await ScheduleAsync(h, card))!.Reps);
    }

    [Fact]
    public async Task Shrinking_a_group_to_one_member_keeps_its_card()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0, group: "aa"), Mask("bb", 1, group: "aa")));
        var card = CardFor(first, "maa").Id;

        var edited = await SaveAsync(h, Doc(Mask("bb", 1, group: "aa")), first.Fact.Id);

        Assert.Equal(0, edited.Removed);
        Assert.Equal(card, CardFor(edited, "maa").Id);
    }

    [Fact]
    public async Task Ungrouping_restores_the_other_members_old_cards_with_their_history()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)));
        var cardA = CardFor(first, "maa").Id;
        var cardB = CardFor(first, "mbb").Id;
        await StudyAsync(h, cardB, reps: 8);
        var grouped = await SaveAsync(h, Doc(Mask("aa", 0, group: "aa"), Mask("bb", 1, group: "aa")), first.Fact.Id);

        var ungrouped = await SaveAsync(h, Doc(Mask("aa", 0), Mask("bb", 1)), grouped.Fact.Id);

        Assert.Equal(cardA, CardFor(ungrouped, "maa").Id);
        Assert.Equal(cardB, CardFor(ungrouped, "mbb").Id);
        Assert.Empty(await h.HeldAsync());
        Assert.Equal(8, (await ScheduleAsync(h, cardB))!.Reps);
    }

    [Fact]
    public async Task Ungrouping_after_the_anchor_is_gone_lets_the_lowest_member_take_the_label_as_its_id()
    {
        await using var h = await OpenAsync();
        var first = await SaveAsync(h, Doc(Mask("aa", 0, group: "aa"), Mask("bb", 1, group: "aa"), Mask("cc", 2, group: "aa")));
        var card = CardFor(first, "maa").Id;
        await StudyAsync(h, card, reps: 2);
        var shrunk = await SaveAsync(h, Doc(Mask("bb", 1, group: "aa"), Mask("cc", 2, group: "aa")), first.Fact.Id);

        // The editor renames the lowest member to the old label as it clears the group.
        var ungrouped = await SaveAsync(h, Doc(Mask("aa", 1), Mask("cc", 2)), shrunk.Fact.Id);

        Assert.Equal(card, CardFor(ungrouped, "maa").Id);
        Assert.Equal(1, ungrouped.Added);
        Assert.Equal(2, (await ScheduleAsync(h, card))!.Reps);
    }

    [Fact]
    public async Task Cards_keep_distinct_keys_even_when_the_stored_masks_would_collide()
    {
        await using var h = await OpenAsync();

        var saved = await SaveAsync(h, Doc(
            Mask("xx", 0, "Plain"), Mask("yy", 1, "Grouped", group: "xx"), Mask("zz", 2, "Other")));

        Assert.Equal(["mxx", "mzz"], saved.Cards.Select(c => c.LayoutKey).Order(StringComparer.Ordinal));
        Assert.Equal(2, saved.Cards.Select(c => c.Id).Distinct().Count());
    }
}
