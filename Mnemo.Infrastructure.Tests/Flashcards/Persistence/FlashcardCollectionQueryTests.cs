using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// <see cref="ICardRepository.GetPageAsync"/> generalized for the collection-wide browser: a
/// null <see cref="FlashcardCardQuery.DeckId"/> spans every deck, the text filter runs through
/// FTS instead of a substring scan, and <see cref="FlashcardCardQuery.CardTypeId"/> restricts to
/// facts authored under one card type. The deck-scoped behavior these generalize is covered by
/// <see cref="FlashcardStoreTests"/>; this file only exercises what changed.
/// </summary>
public sealed class FlashcardCollectionQueryTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task GetPageAsync_NullDeckId_SpansEveryDeck()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckA = await h.SeedDeckAsync("deck-a");
        var deckB = await h.SeedDeckAsync("deck-b");

        await h.AddCardAsync(FlashcardStoreHarness.Card("a1", deckA, "front a", "back a"),
            FlashcardSchedule.NewFor("a1", Now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("b1", deckB, "front b", "back b"),
            FlashcardSchedule.NewFor("b1", Now));

        var page = await h.Store.ReadAsync((conn, ct) =>
            h.Cards.GetPageAsync(conn, new FlashcardCardQuery(null), Now, ct));

        Assert.Equal(2, page.TotalCount);
        Assert.Contains(page.Items, v => v.Card.Id == "a1");
        Assert.Contains(page.Items, v => v.Card.Id == "b1");
    }

    [Fact]
    public async Task GetPageAsync_DeckId_StillScopesToOneDeck_WhenSet()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckA = await h.SeedDeckAsync("deck-a");
        var deckB = await h.SeedDeckAsync("deck-b");

        await h.AddCardAsync(FlashcardStoreHarness.Card("a1", deckA, "front a", "back a"),
            FlashcardSchedule.NewFor("a1", Now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("b1", deckB, "front b", "back b"),
            FlashcardSchedule.NewFor("b1", Now));

        var page = await h.Store.ReadAsync((conn, ct) =>
            h.Cards.GetPageAsync(conn, new FlashcardCardQuery(deckA), Now, ct));

        Assert.Equal(1, page.TotalCount);
        Assert.Equal("a1", Assert.Single(page.Items).Card.Id);
    }

    [Fact]
    public async Task GetPageAsync_TextFilter_MatchesWholeWordsViaFts_AcrossDecks()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckA = await h.SeedDeckAsync("deck-a");
        var deckB = await h.SeedDeckAsync("deck-b");

        await h.AddCardAsync(FlashcardStoreHarness.Card("a1", deckA, "plate tectonics boundary", "divergent"),
            FlashcardSchedule.NewFor("a1", Now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("b1", deckB, "ocean crust", "recycled at subduction plate zones"),
            FlashcardSchedule.NewFor("b1", Now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("b2", deckB, "unrelated capital city", "Paris"),
            FlashcardSchedule.NewFor("b2", Now));

        var page = await h.Store.ReadAsync((conn, ct) =>
            h.Cards.GetPageAsync(conn, new FlashcardCardQuery(null, Text: "plate"), Now, ct));

        Assert.Equal(2, page.TotalCount);
        Assert.DoesNotContain(page.Items, v => v.Card.Id == "b2");
    }

    [Fact]
    public async Task GetPageAsync_CardTypeIdFilter_MatchesOnlyFactsOfThatType()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync();

        var vocab = await h.FactService.SaveFactAsync(Draft(FlashcardCardType.VocabularyId, new()
        {
            ["word"] = "Mitochondria",
            ["meaning"] = "The powerhouse of the cell",
        }));
        var basic = await h.FactService.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Amiodarone",
            ["back"] = "Class III",
        }));

        var page = await h.Store.ReadAsync((conn, ct) =>
            h.Cards.GetPageAsync(conn, new FlashcardCardQuery(null, CardTypeId: FlashcardCardType.VocabularyId), Now, ct));

        var vocabCardIds = vocab.Cards.Select(c => c.Id).ToHashSet();
        var basicCardIds = basic.Cards.Select(c => c.Id).ToHashSet();
        Assert.Equal(vocabCardIds.Count, page.TotalCount);
        Assert.All(page.Items, v => Assert.Contains(v.Card.Id, vocabCardIds));
        Assert.DoesNotContain(page.Items, v => basicCardIds.Contains(v.Card.Id));
    }

    [Fact]
    public async Task GetPageAsync_IncludesBuriedCards()
    {
        // Burying is scheduler visibility, not existence: the study queue skips a buried card,
        // but browsing and searching the collection must still find it.
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await h.SeedDeckAsync();

        await h.AddCardAsync(FlashcardStoreHarness.Card("buried", deckId, "buried front", "buried back"),
            FlashcardSchedule.NewFor("buried", Now) with { BuriedUntil = Now.AddDays(1) });

        var page = await h.Store.ReadAsync((conn, ct) =>
            h.Cards.GetPageAsync(conn, new FlashcardCardQuery(null), Now, ct));

        Assert.Contains(page.Items, v => v.Card.Id == "buried");
    }

    [Fact]
    public async Task BatchOperations_ActOnCardsSelectedAcrossDecks_InOneCall()
    {
        // The collection-wide browser selects rows from any mix of decks, then fires one batch
        // call over the ids in the selection. The batch endpoints already key off raw card ids
        // with no deck clause, so this is a regression guard rather than new plumbing.
        await using var h = new FlashcardStoreHarness(Now);
        var deckA = await h.SeedDeckAsync("deck-a");
        var deckB = await h.SeedDeckAsync("deck-b");
        var deckC = await h.SeedDeckAsync("deck-c");
        var svc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        await h.AddCardAsync(FlashcardStoreHarness.Card("a1", deckA, "front a", "back a"), FlashcardSchedule.NewFor("a1", Now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("b1", deckB, "front b", "back b"), FlashcardSchedule.NewFor("b1", Now));

        await svc.SetFlaggedAsync(["a1", "b1"], true);
        await svc.MoveCardsAsync(["a1", "b1"], deckC);

        var page = await h.Store.ReadAsync((conn, ct) =>
            h.Cards.GetPageAsync(conn, new FlashcardCardQuery(null), Now, ct));

        Assert.All(page.Items, v => Assert.Equal(deckC, v.Card.DeckId));
        Assert.All(page.Items, v => Assert.True(v.Card.IsFlagged));
    }

    private static FlashcardFactDraft Draft(
        string typeId,
        Dictionary<string, string> values,
        string? id = null,
        string deckId = "deck-1",
        IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>>? media = null) =>
        new(id, deckId, typeId, values, media ?? new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(), []);
}
