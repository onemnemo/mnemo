using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Cards still arrive from routes that hand over a front and a back rather than filling in a card
/// type, chiefly an import. Every card in the collection has to have material behind it, because
/// that is what the editor opens and what siblings are found through, so one is made on the way in.
/// </summary>
public sealed class FlashcardCardMaterialTests
{
    private static FlashcardCardService Cards(FlashcardStoreHarness h) =>
        new(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

    private static FlashcardCardDraft Draft(
        string front,
        string back,
        FlashcardType type = FlashcardType.Classic,
        IReadOnlyList<FlashcardAttachment>? attachments = null) =>
        new(
            DeckId: string.Empty,
            Type: type,
            Front: front,
            Back: back,
            Tags: ["imported"],
            Attachments: attachments ?? Array.Empty<FlashcardAttachment>());

    private static FlashcardAttachment Image(string id, string side) =>
        new(id, side, $"C:/images/{id}.png", $"{id}.png", 100);

    [Fact]
    public async Task a_card_written_side_by_side_gets_material_the_editor_can_open()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();

        var card = await Cards(h).CreateCardAsync(Draft("Which class blocks sodium?", "Class I") with { DeckId = deckId });

        var fact = await h.FactService.GetFactForCardAsync(card.Id);
        Assert.NotNull(fact);
        Assert.Equal(FlashcardCardType.BasicId, fact.TypeId);
        Assert.Equal("Which class blocks sodium?", fact.Value(FlashcardCardType.BasicFrontFieldId));
        Assert.Equal("Class I", fact.Value(FlashcardCardType.BasicBackFieldId));
        Assert.Equal(FlashcardCardType.RecognitionLayoutId, card.LayoutKey);
    }

    [Fact]
    public async Task the_material_keeps_the_tags_and_the_deck_the_card_landed_in()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();

        var card = await Cards(h).CreateCardAsync(Draft("front", "back") with { DeckId = deckId });

        var fact = await h.FactService.GetFactForCardAsync(card.Id);
        Assert.Equal(deckId, fact!.DeckId);
        Assert.Equal(["imported"], fact.Tags);
    }

    [Fact]
    public async Task attachments_move_from_the_side_they_arrived_on_to_the_field_that_owns_them()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var trace = Image("trace", FlashcardAttachment.FrontSide);
        var channel = Image("channel", FlashcardAttachment.BackSide);

        var card = await Cards(h).CreateCardAsync(
            Draft("front", "back", attachments: [trace, channel]) with { DeckId = deckId });

        var fact = await h.FactService.GetFactForCardAsync(card.Id);
        Assert.Equal(["trace"], fact!.MediaOn(FlashcardCardType.BasicFrontFieldId).Select(a => a.Id));
        Assert.Equal(["channel"], fact.MediaOn(FlashcardCardType.BasicBackFieldId).Select(a => a.Id));
    }

    [Fact]
    public async Task a_cloze_card_keeps_its_markers_in_the_material_and_shows_one_deletion()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var text = "{{c1::Lidocaine}} is class {{c2::Ib}}";

        var card = await Cards(h).CreateCardAsync(
            Draft(text, "Shortens repolarisation.", FlashcardType.Cloze) with { DeckId = deckId });

        var fact = await h.FactService.GetFactForCardAsync(card.Id);
        Assert.Equal(FlashcardCardType.ClozeId, fact!.TypeId);
        Assert.Equal(text, fact.Value(FlashcardCardType.ClozeTextFieldId));
        // The card stands for the lowest deletion, and shows it the way study needs to read it.
        Assert.Equal("c1", card.LayoutKey);
        Assert.Equal("[…] is class Ib", card.Front);
        Assert.Equal("Lidocaine is class Ib\n\nShortens repolarisation.", card.Back);
    }

    [Fact]
    public async Task a_cloze_card_with_no_deletion_becomes_ordinary_material_rather_than_none()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();

        var card = await Cards(h).CreateCardAsync(
            Draft("nothing is deleted here", "back", FlashcardType.Cloze) with { DeckId = deckId });

        var fact = await h.FactService.GetFactForCardAsync(card.Id);
        // Cloze material with no marker generates nothing, and losing a card to a classification
        // nobody typed is not an acceptable outcome of an import.
        Assert.Equal(FlashcardCardType.BasicId, fact!.TypeId);
        Assert.Equal("nothing is deleted here", card.Front);
    }

    [Fact]
    public async Task a_cloze_card_lands_as_one_card_rather_than_one_per_deletion()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();

        await Cards(h).CreateCardAsync(
            Draft("{{c1::a}} {{c2::b}} {{c3::c}}", "", FlashcardType.Cloze) with { DeckId = deckId });

        // An import that landed three cards for a package holding one would report a count nobody
        // could reconcile with what they imported.
        var page = await Cards(h).ListCardsAsync(new FlashcardCardQuery(deckId));
        Assert.Single(page.Items);
    }

    [Fact]
    public async Task a_batch_gives_every_card_its_own_material()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();

        var created = await Cards(h).CreateCardsAsync(deckId, [Draft("a", "1"), Draft("b", "2")]);

        var factIds = new List<string>();
        foreach (var card in created)
        {
            var fact = await h.FactService.GetFactForCardAsync(card.Id);
            Assert.NotNull(fact);
            factIds.Add(fact.Id);
        }

        Assert.Equal(2, factIds.Distinct(StringComparer.Ordinal).Count());
    }
}
