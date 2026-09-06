using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Saving material, and what that does to the cards it makes.
/// </summary>
/// <remarks>
/// The recurring question in here is what survives an edit. A card someone has been studying for
/// months is matched to its layout by key, so rewording a sentence, renaming a field or adding a
/// deletion has to leave that card and its schedule exactly where they were.
/// </remarks>
public sealed class FlashcardFactServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Saving_material_makes_the_card_its_type_describes()
    {
        await using var harness = await OpenAsync();

        var saved = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));

        var card = Assert.Single(saved.Cards);
        Assert.Equal("Amiodarone", card.Front);
        Assert.Equal("Class III", card.Back);
        Assert.Equal(FlashcardCardType.RecognitionLayoutId, card.LayoutKey);
        Assert.Equal(saved.Fact.Id, card.FactId);
        Assert.Equal(1, saved.Added);
    }

    [Fact]
    public async Task A_type_with_two_cards_makes_both_of_them()
    {
        await using var harness = await OpenAsync();

        var saved = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicReverseId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));

        Assert.Equal(2, saved.Cards.Count);
        var recall = saved.Cards.Single(c => c.LayoutKey == FlashcardCardType.RecallLayoutId);
        Assert.Equal("Class III", recall.Front);
        Assert.Equal("Amiodarone", recall.Back);
    }

    [Fact]
    public async Task Rewording_material_reaches_the_card_without_replacing_it()
    {
        await using var harness = await OpenAsync();
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));
        var cardId = first.Cards.Single().Id;

        var second = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III antiarrhythmic",
        }, id: first.Fact.Id));

        var card = Assert.Single(second.Cards);
        Assert.Equal(cardId, card.Id);
        Assert.Equal("Class III antiarrhythmic", card.Back);
        Assert.Equal(0, second.Added);
        Assert.Equal(0, second.Removed);
    }

    [Fact]
    public async Task Adding_a_deletion_adds_a_card_and_leaves_the_others_where_they_were()
    {
        await using var harness = await OpenAsync();
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.ClozeId, new()
        {
            ["text"] = "{{c1::Amiodarone}} is class III.",
            ["extra"] = string.Empty,
        }));
        var studied = first.Cards.Single();
        await StudyAsync(harness, studied.Id);

        var second = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.ClozeId, new()
        {
            ["text"] = "{{c1::Amiodarone}} is class {{c2::III}}.",
            ["extra"] = string.Empty,
        }, id: first.Fact.Id));

        Assert.Equal(2, second.Cards.Count);
        Assert.Equal(1, second.Added);

        var kept = second.Cards.Single(c => c.LayoutKey == "c1");
        Assert.Equal(studied.Id, kept.Id);
        var schedule = await harness.Store.ReadAsync((conn, ct) => harness.Schedules.GetAsync(conn, kept.Id, ct));
        Assert.Equal(4, schedule!.Reps);

        var added = second.Cards.Single(c => c.LayoutKey == "c2");
        var fresh = await harness.Store.ReadAsync((conn, ct) => harness.Schedules.GetAsync(conn, added.Id, ct));
        Assert.Equal(FlashcardFsrsState.New, fresh!.FsrsState);
    }

    [Fact]
    public async Task Removing_a_deletion_takes_only_the_card_it_made()
    {
        await using var harness = await OpenAsync();
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.ClozeId, new()
        {
            ["text"] = "{{c1::Amiodarone}} is class {{c2::III}}.",
            ["extra"] = string.Empty,
        }));
        var keptId = first.Cards.Single(c => c.LayoutKey == "c1").Id;
        var goneId = first.Cards.Single(c => c.LayoutKey == "c2").Id;

        var second = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.ClozeId, new()
        {
            ["text"] = "{{c1::Amiodarone}} is class III.",
            ["extra"] = string.Empty,
        }, id: first.Fact.Id));

        Assert.Equal(1, second.Removed);
        Assert.Equal(keptId, second.Cards.Single().Id);
        Assert.Null(await harness.Store.ReadAsync((conn, ct) => harness.Cards.GetAsync(conn, goneId, ct)));

        // Out of the collection, into the trash, with the schedule it had. Nothing an edit does to
        // material destroys a card outright.
        Assert.NotNull(await harness.Store.ReadAsync((conn, ct) => harness.Schedules.GetAsync(conn, goneId, ct)));
        Assert.Equal(goneId, Assert.Single(await harness.HeldAsync()).ItemId);
    }

    [Fact]
    public async Task Material_that_would_make_no_cards_is_refused_and_changes_nothing()
    {
        await using var harness = await OpenAsync();
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.ClozeId, new()
        {
            ["text"] = "{{c1::Amiodarone}} is class III.",
            ["extra"] = string.Empty,
        }));

        await Assert.ThrowsAsync<ArgumentException>(() => harness.FactService.SaveFactAsync(
            Draft(FlashcardCardType.ClozeId, new()
            {
                ["text"] = "Amiodarone is class III.",
                ["extra"] = string.Empty,
            }, id: first.Fact.Id)));

        var card = await harness.Store.ReadAsync((conn, ct) => harness.Cards.GetAsync(conn, first.Cards.Single().Id, ct));
        Assert.NotNull(card);
        var fact = await harness.FactService.GetFactAsync(first.Fact.Id);
        Assert.Equal("{{c1::Amiodarone}} is class III.", fact!.Value("text"));
    }

    [Fact]
    public async Task Filling_the_field_a_card_waits_on_brings_that_card_in()
    {
        await using var harness = await OpenAsync();
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.VocabularyId, new()
        {
            ["word"] = "Haus",
            ["meaning"] = "house",
            ["example"] = string.Empty,
        }));
        Assert.Equal(2, first.Cards.Count);

        var second = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.VocabularyId, new()
        {
            ["word"] = "Haus",
            ["meaning"] = "house",
            ["example"] = "Das Haus ist alt.",
        }, id: first.Fact.Id));

        Assert.Equal(3, second.Cards.Count);
        Assert.Equal(1, second.Added);
        Assert.Contains(second.Cards, c => c.LayoutKey == "in-context");
    }

    [Fact]
    public async Task Emptying_that_field_takes_the_card_back_out()
    {
        await using var harness = await OpenAsync();
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.VocabularyId, new()
        {
            ["word"] = "Haus",
            ["meaning"] = "house",
            ["example"] = "Das Haus ist alt.",
        }));

        var second = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.VocabularyId, new()
        {
            ["word"] = "Haus",
            ["meaning"] = "house",
            ["example"] = "   ",
        }, id: first.Fact.Id));

        Assert.Equal(2, second.Cards.Count);
        Assert.Equal(1, second.Removed);
    }

    [Fact]
    public async Task A_suspended_card_is_still_suspended_after_its_material_is_edited()
    {
        await using var harness = await OpenAsync();
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));
        var cardId = first.Cards.Single().Id;
        await harness.Store.WriteAsync((conn, tx, ct) =>
            harness.Cards.SetSuspendedAsync(conn, tx, [cardId], true, Now, ct));

        var second = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Blocks potassium channels",
        }, id: first.Fact.Id));

        Assert.Equal(FlashcardCardState.Suspended, second.Cards.Single().State);
    }

    [Fact]
    public async Task Media_on_a_field_reaches_the_side_the_card_shows_it_on()
    {
        await using var harness = await OpenAsync();

        var saved = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "What is this?",
            ["back"] = "An ECG",
        }, media: new Dictionary<string, IReadOnlyList<FlashcardAttachment>>
        {
            ["front"] = [new FlashcardAttachment("a1", FlashcardAttachment.FrontSide, "ecg.png", "ecg.png", 120)],
            ["back"] = [new FlashcardAttachment("a2", FlashcardAttachment.FrontSide, "lead.png", "lead.png", 90)],
        }));

        var card = Assert.Single(saved.Cards);
        Assert.Equal(FlashcardAttachment.FrontSide, card.Attachments.Single(a => a.Id == "a1").Side);
        // The side is decided by which template mentions the field, not by what was stored on the
        // attachment when it was uploaded.
        Assert.Equal(FlashcardAttachment.BackSide, card.Attachments.Single(a => a.Id == "a2").Side);
    }

    [Fact]
    public async Task Renaming_a_field_carries_into_the_templates_that_name_it()
    {
        await using var harness = await OpenAsync();
        var saved = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));

        var type = await harness.FactService.GetCardTypeAsync(FlashcardCardType.BasicId);
        var renamed = type! with
        {
            Fields = [.. type.Fields.Select(f => f.Id == "front" ? f with { Name = "Term" } : f)],
        };
        await harness.FactService.SaveCardTypeAsync(renamed);

        var card = await harness.Store.ReadAsync((conn, ct) => harness.Cards.GetAsync(conn, saved.Cards.Single().Id, ct));
        Assert.Equal("Amiodarone", card!.Front);
    }

    [Fact]
    public async Task Editing_a_card_type_reaches_the_cards_its_material_already_made()
    {
        await using var harness = await OpenAsync();
        var saved = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));

        var type = await harness.FactService.GetCardTypeAsync(FlashcardCardType.BasicId);
        await harness.FactService.SaveCardTypeAsync(type! with
        {
            Layouts = [.. type.Layouts, new FlashcardLayout("recall", "Recall", "{{Back}}", "{{Front}}")],
        });

        var cards = await harness.Store.ReadAsync((conn, ct) => harness.Cards.ListByDeckAsync(conn, "deck-1", ct));
        Assert.Equal(2, cards.Count);
        Assert.Contains(cards, c => c.LayoutKey == "recall" && c.Front == "Class III");
        Assert.Contains(cards, c => c.Id == saved.Cards.Single().Id);
    }

    [Fact]
    public async Task Removing_a_card_from_a_type_takes_that_card_from_every_piece_of_material()
    {
        await using var harness = await OpenAsync();
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicReverseId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));
        var second = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicReverseId, new()
        {
            ["front"] = "Digoxin",
            ["back"] = "Cardiac glycoside",
        }));

        var firstRecall = first.Cards.Single(c => c.LayoutKey == FlashcardCardType.RecallLayoutId);
        var secondRecall = second.Cards.Single(c => c.LayoutKey == FlashcardCardType.RecallLayoutId);
        await StudyAsync(harness, firstRecall.Id);

        var type = await harness.FactService.GetCardTypeAsync(FlashcardCardType.BasicReverseId);
        await harness.FactService.SaveCardTypeAsync(type! with
        {
            Layouts = [.. type.Layouts.Where(l => l.Id != FlashcardCardType.RecallLayoutId)],
        });

        // Removing a layout takes its cards out of every piece of material using the type, and the
        // trash holds each of them with the schedule it had.
        var held = (await harness.HeldAsync()).Select(entry => entry.ItemId).ToList();
        foreach (var gone in new[] { firstRecall, secondRecall })
        {
            Assert.Null(await harness.Store.ReadAsync((conn, ct) => harness.Cards.GetAsync(conn, gone.Id, ct)));
            Assert.NotNull(await harness.Store.ReadAsync((conn, ct) => harness.Schedules.GetAsync(conn, gone.Id, ct)));
            Assert.Contains(gone.Id, held);
        }

        foreach (var kept in new[] { first, second })
        {
            var recognition = kept.Cards.Single(c => c.LayoutKey == FlashcardCardType.RecognitionLayoutId);
            Assert.NotNull(await harness.Store.ReadAsync((conn, ct) => harness.Cards.GetAsync(conn, recognition.Id, ct)));
        }
    }

    [Fact]
    public async Task A_card_type_that_still_holds_material_is_not_deleted()
    {
        await using var harness = await OpenAsync();
        await harness.FactService.SaveCardTypeAsync(new FlashcardCardType(
            "custom", "Custom", false,
            [new FlashcardField("a", "A"), new FlashcardField("b", "B")],
            "a",
            [new FlashcardLayout("one", "One", "{{A}}", "{{B}}")]));
        await harness.FactService.SaveFactAsync(Draft("custom", new() { ["a"] = "x", ["b"] = "y" }));

        await Assert.ThrowsAsync<InvalidOperationException>(() => harness.FactService.DeleteCardTypeAsync("custom"));
        Assert.NotNull(await harness.FactService.GetCardTypeAsync("custom"));
    }

    [Fact]
    public async Task A_card_type_whose_only_material_is_in_the_trash_is_not_deleted()
    {
        await using var harness = await OpenAsync();
        await harness.FactService.SaveCardTypeAsync(new FlashcardCardType(
            "custom", "Custom", false,
            [new FlashcardField("a", "A"), new FlashcardField("b", "B")],
            "a",
            [new FlashcardLayout("one", "One", "{{A}}", "{{B}}")]));
        var saved = await harness.FactService.SaveFactAsync(Draft("custom", new() { ["a"] = "x", ["b"] = "y" }));
        await new FlashcardFactTrashSource(harness.Store).CaptureAsync(saved.Fact.Id, "e1");

        // The live count excludes trashed material, which still needs its type when restored.
        Assert.Equal(0, await harness.FactService.CountFactsUsingTypeAsync("custom"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => harness.FactService.DeleteCardTypeAsync("custom"));
        Assert.NotNull(await harness.FactService.GetCardTypeAsync("custom"));
    }

    [Fact]
    public async Task A_built_in_card_type_is_not_deleted()
    {
        await using var harness = await OpenAsync();

        Assert.False(await harness.FactService.DeleteCardTypeAsync(FlashcardCardType.BasicId));
        Assert.NotNull(await harness.FactService.GetCardTypeAsync(FlashcardCardType.BasicId));
    }

    [Fact]
    public async Task A_card_type_that_describes_no_cards_is_refused()
    {
        await using var harness = await OpenAsync();

        await Assert.ThrowsAsync<ArgumentException>(() => harness.FactService.SaveCardTypeAsync(
            new FlashcardCardType("empty", "Empty", false, [new FlashcardField("a", "A")], "a", [])));
    }

    [Fact]
    public async Task A_card_waiting_on_a_field_that_does_not_exist_is_refused()
    {
        await using var harness = await OpenAsync();

        await Assert.ThrowsAsync<ArgumentException>(() => harness.FactService.SaveCardTypeAsync(
            new FlashcardCardType(
                "custom", "Custom", false,
                [new FlashcardField("a", "A")],
                "a",
                [new FlashcardLayout("one", "One", "{{A}}", string.Empty, Requires: "missing")])));
    }

    [Fact]
    public async Task Deleting_material_deletes_the_cards_it_made()
    {
        await using var harness = await OpenAsync();
        var saved = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.ClozeId, new()
        {
            ["text"] = "{{c1::A}} and {{c2::B}}",
            ["extra"] = string.Empty,
        }));

        await harness.FactService.DeleteFactsAsync([saved.Fact.Id]);

        var cards = await harness.Store.ReadAsync((conn, ct) => harness.Cards.ListByDeckAsync(conn, "deck-1", ct));
        Assert.Empty(cards);
    }

    [Fact]
    public async Task Moving_material_to_another_deck_takes_its_cards_along()
    {
        await using var harness = await OpenAsync();
        await harness.SeedDeckAsync("deck-2");
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));

        await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }, id: first.Fact.Id, deckId: "deck-2"));

        Assert.Empty(await harness.Store.ReadAsync((conn, ct) => harness.Cards.ListByDeckAsync(conn, "deck-1", ct)));
        Assert.Single(await harness.Store.ReadAsync((conn, ct) => harness.Cards.ListByDeckAsync(conn, "deck-2", ct)));
    }

    [Fact]
    public async Task Moving_a_card_on_its_own_survives_a_later_edit_of_its_material()
    {
        await using var harness = await OpenAsync();
        await harness.SeedDeckAsync("deck-2");
        var first = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));
        var cardId = first.Cards.Single().Id;

        await harness.Store.WriteAsync((conn, tx, ct) =>
            harness.Cards.MoveManyAsync(conn, tx, [cardId], "deck-2", harness.Clock.Now, ct));

        var second = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III antiarrhythmic",
        }, id: first.Fact.Id));

        var card = Assert.Single(second.Cards);
        Assert.Equal(cardId, card.Id);
        Assert.Equal("deck-2", card.DeckId);
    }

    [Fact]
    public async Task The_material_behind_a_card_opens_from_the_card()
    {
        await using var harness = await OpenAsync();
        var saved = await harness.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));

        var fact = await harness.FactService.GetFactForCardAsync(saved.Cards.Single().Id);
        Assert.Equal(saved.Fact.Id, fact!.Id);
    }

    private static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    /// <summary>Puts a card through enough reviews that keeping them is visible.</summary>
    private static Task StudyAsync(FlashcardStoreHarness harness, string cardId) =>
        harness.Store.WriteAsync((conn, tx, ct) => harness.Schedules.UpsertAsync(
            conn, tx,
            new FlashcardSchedule(cardId, Now.AddDays(9), 41.5, 5.25, 4, 1, FlashcardFsrsState.Review, 0, Now),
            ct));

    private static FlashcardFactDraft Draft(
        string typeId,
        Dictionary<string, string> values,
        string? id = null,
        string deckId = "deck-1",
        IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>>? media = null) =>
        new(id, deckId, typeId, values, media ?? new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(), []);
}
