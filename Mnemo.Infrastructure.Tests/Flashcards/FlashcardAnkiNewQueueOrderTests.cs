using System;
using System.Collections.Generic;
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
public sealed class FlashcardAnkiNewQueueOrderTests
{
    [Fact]
    public async Task Import_NewCards_StudyInThePackagesQueueOrder()
    {
        // Written in one order, queued in another: a deck someone re-sorted, or a frequency list
        // whose notes were added out of order. The queue position is what Anki studies by.
        var words = Enumerable.Range(1, 20).Select(i => $"Word {i:D2}").ToArray();
        var notes = words
            .Select((word, i) => new AnkiFixtureCard(
                "Vocabulary", word, "x", Scheduling: new AnkiFixtureScheduling(Type: 0, Queue: 0, Due: words.Length - i)))
            .ToArray();
        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, notes, new Dictionary<string, byte[]>());

        try
        {
            await using var h = new FlashcardStoreHarness();
            await h.Store.InitializeAsync();
            var library = new FlashcardLibraryService(
                h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
            var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
            var adapter = new FlashcardsAnkiFormatAdapter(
                library, cardService, h.FactService,
                new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
                h.Clock, new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));

            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(result.Success, result.ErrorMessage);

            var deck = Assert.Single(await library.ListDecksAsync());
            var queue = await h.Store.ReadAsync((conn, ct) => h.Schedules.ListNewQueueAsync(conn, deck.Id, ct));
            var frontById = (await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id, Limit: 100))).Items
                .ToDictionary(v => v.Card.Id, v => v.Card.Front);

            Assert.Equal(words.Reverse(), queue.Select(e => frontById[e.CardId]));
            Assert.All(queue, e => Assert.True(e.DueDate <= DateTimeOffset.UtcNow.AddSeconds(1), "A new card must not be due in the future."));
        }
        finally
        {
            File.Delete(apkg);
        }
    }
}
