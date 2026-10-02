using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiLastStudiedTests
{
    [Fact]
    public async Task Import_WithReviewHistory_MarksTheDeckStudiedWhenItsNewestAnswerWasGiven()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var history = new FlashcardReviewHistoryService(h.Store, h.Reviews);
        var adapter = new FlashcardsAnkiFormatAdapter(
            library, cardService, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            h.Clock, history, new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));

        var apkg = Path.Combine(AppContext.BaseDirectory, "Flashcards", "Fixtures", "Anki", "anki21b-basic.apkg");
        var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
        Assert.True(result.Success, result.ErrorMessage);

        var deck = Assert.Single(await library.ListDecksAsync());
        var cards = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));
        var reviews = await history.ListForCardsAsync([.. cards.Items.Select(v => v.Card.Id)]);
        var newest = Assert.Single(reviews).ReviewedAt;

        var header = await library.GetDeckAsync(deck.Id);
        Assert.Equal(newest, header!.Header.LastStudied);
    }
}
