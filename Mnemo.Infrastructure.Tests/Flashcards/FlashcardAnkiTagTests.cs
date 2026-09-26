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

/// <summary>
/// Anki separates tags with spaces, so a tag with a space in it leaves with underscores instead and
/// comes back as one tag rather than as each of its words.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiTagTests
{
    [Fact]
    public async Task ExportThenImport_TagWithSpaces_ComesBackAsOneUnderscoredTag()
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_tags_{Guid.NewGuid():N}.apkg");
        try
        {
            await using (var source = new FlashcardStoreHarness())
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = NewCards(source);
                var deck = await library.CreateDeckAsync("Anatomy");
                await cards.CreateCardsAsync(deck.Id,
                [
                    new FlashcardCardDraft(
                        deck.Id, FlashcardType.Classic, "front", "back",
                        ["my tag", " two  words ", "plain"], Array.Empty<FlashcardAttachment>()),
                ]);

                var export = await NewAdapter(source, library, cards).ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            var note = Assert.Single((await AnkiPackageInspector.ReadAsync(apkg)).Notes);
            Assert.Equal(" my_tag two_words plain ", note.Tags);

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = NewCards(target);
            var import = await NewAdapter(target, targetLibrary, targetCards).ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var imported = Assert.Single(await targetLibrary.ListDecksAsync());
            var card = Assert.Single((await targetCards.ListCardsAsync(new FlashcardCardQuery(imported.Id))).Items).Card;
            Assert.Equal(new[] { "my_tag", "two_words", "plain" }, card.Tags.ToArray());
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    private static FlashcardCardService NewCards(FlashcardStoreHarness h) =>
        new(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

    private static FlashcardsAnkiFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        FlashcardCardService cardSvc) =>
        new(library, cardSvc, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            h.Clock, new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
}
