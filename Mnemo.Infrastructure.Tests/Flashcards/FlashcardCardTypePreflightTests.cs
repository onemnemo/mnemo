using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// The count the card type editor asks for before it offers a save: how many cards the proposed
/// type would take out of the collection, and that asking costs the collection nothing.
/// </summary>
public sealed class FlashcardCardTypePreflightTests
{
    private static readonly DateTimeOffset Now = new(2026, 5, 1, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task It_counts_the_cards_a_removed_layout_would_take()
    {
        await using var h = await OpenAsync();
        await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        await SaveVocabularyAsync(h, "Buch", "book", string.Empty);

        var preflight = await h.FactService.PreviewCardTypeSaveAsync(WithoutProduction(await VocabularyAsync(h)));

        // Both pieces of material make a Production card. The second one's In context layout is
        // not firing, so it has no card there to lose.
        Assert.Equal(2, preflight.RemovedCardCount);
        Assert.Equal(2, preflight.AffectedFactCount);
    }

    [Fact]
    public async Task It_counts_the_material_a_newly_required_field_leaves_empty()
    {
        await using var h = await OpenAsync();
        await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        await SaveVocabularyAsync(h, "Buch", "book", string.Empty);
        var stored = await VocabularyAsync(h);

        var proposed = stored with
        {
            Layouts = [.. stored.Layouts.Select(layout =>
                layout.Id == "production" ? layout with { Requires = "example" } : layout)],
        };
        var preflight = await h.FactService.PreviewCardTypeSaveAsync(proposed);

        // Only the material with no example loses its Production card. The layout is still listed
        // under the same id, so a diff of layout ids would have reported nothing at all.
        Assert.Equal(1, preflight.RemovedCardCount);
        Assert.Equal(1, preflight.AffectedFactCount);
    }

    [Fact]
    public async Task It_counts_a_card_the_trash_is_already_holding_as_nothing_to_lose()
    {
        await using var h = await OpenAsync();
        var saved = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var production = saved.Cards.Single(c => c.LayoutKey == "production").Id;
        await h.Trash.DeleteAsync([new Core.Models.Trash.TrashDeleteRequest("card", production)]);

        var preflight = await h.FactService.PreviewCardTypeSaveAsync(WithoutProduction(await VocabularyAsync(h)));

        Assert.Equal(0, preflight.RemovedCardCount);
        Assert.Equal(0, preflight.AffectedFactCount);
    }

    [Fact]
    public async Task It_writes_nothing()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");

        await h.FactService.PreviewCardTypeSaveAsync(WithoutProduction(await VocabularyAsync(h)));

        Assert.Empty(await h.HeldAsync());
        foreach (var card in first.Cards)
            Assert.NotNull(await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, card.Id, ct)));
        Assert.Equal(3, (await VocabularyAsync(h)).Layouts.Count);
    }

    private static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    private static async Task<FlashcardCardType> VocabularyAsync(FlashcardStoreHarness h)
    {
        var type = await h.FactService.GetCardTypeAsync(FlashcardCardType.VocabularyId);
        Assert.NotNull(type);
        return type!;
    }

    private static FlashcardCardType WithoutProduction(FlashcardCardType type) =>
        type with { Layouts = [.. type.Layouts.Where(layout => layout.Id != "production")] };

    private static Task<FlashcardFactSaved> SaveVocabularyAsync(
        FlashcardStoreHarness h, string word, string meaning, string example) =>
        h.FactService.SaveFactAsync(new FlashcardFactDraft(
            null,
            "deck-1",
            FlashcardCardType.VocabularyId,
            new Dictionary<string, string> { ["word"] = word, ["meaning"] = meaning, ["example"] = example },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(),
            []));
}
