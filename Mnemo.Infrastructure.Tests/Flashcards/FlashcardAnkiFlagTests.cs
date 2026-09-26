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

/// <summary>
/// A flag is a card marked for attention, and Anki keeps it per card as one of seven colors. A card
/// here has a single flag, so it leaves as red and any color comes back as flagged.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiFlagTests
{
    [Fact]
    public async Task ExportThenImport_KeepsWhichCardsAreFlagged()
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_flags_{Guid.NewGuid():N}.apkg");
        try
        {
            await using (var source = new FlashcardStoreHarness())
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = NewCards(source);
                var deck = await library.CreateDeckAsync("Anatomy");
                var created = await cards.CreateCardsAsync(deck.Id, [Draft(deck.Id, "flagged"), Draft(deck.Id, "plain")]);
                await cards.SetFlaggedAsync([created.Single(c => c.Front == "flagged").Id], flagged: true);

                var export = await NewAdapter(source, library, cards).ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            var contents = await AnkiPackageInspector.ReadAsync(apkg);
            var flagsByFront = contents.Cards.ToDictionary(
                c => contents.Notes.Single(n => n.Id == c.NoteId).Fields[0], c => c.Flags, StringComparer.Ordinal);
            Assert.Equal(1, flagsByFront["flagged"]);
            Assert.Equal(0, flagsByFront["plain"]);

            var imported = await ImportAsync(apkg);
            Assert.True(imported["flagged"]);
            Assert.False(imported["plain"]);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_AnyFlagColorFlagsTheCard_IncludingOneClozeDeletion()
    {
        var clozeType = new AnkiFixtureNoteType(
            Id: 1700000000001L,
            Name: "Cloze",
            FieldNames: ["Text", "Extra"],
            Templates: [new AnkiFixtureTemplate("Cloze", "{{cloze:Text}}", "{{cloze:Text}}<br>{{Extra}}")],
            IsCloze: true);
        var notes = new[]
        {
            new AnkiFixtureCard("Deck", "green", "back", CardRows: [new AnkiFixtureCardRow(0, Flags: 3)]),
            new AnkiFixtureCard("Deck", "purple", "back", CardRows: [new AnkiFixtureCardRow(0, Flags: 7)]),
            new AnkiFixtureCard("Deck", "none", "back"),
            new AnkiFixtureCard("Deck", "bits above the color", "back", CardRows: [new AnkiFixtureCardRow(0, Flags: 8)]),
            new AnkiFixtureCard(
                "Deck", "{{c1::one}} and {{c2::two}}", "", NoteType: clozeType,
                CardRows: [new AnkiFixtureCardRow(0), new AnkiFixtureCardRow(1, Flags: 2)]),
        };

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, notes, new Dictionary<string, byte[]>());
        try
        {
            var imported = await ImportAsync(apkg);
            Assert.True(imported["green"]);
            Assert.True(imported["purple"]);
            Assert.False(imported["none"]);
            Assert.False(imported["bits above the color"]);
            Assert.False(imported["[…] and two"]);
            Assert.True(imported["one and […]"]);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    /// <summary>Imports a package into a clean profile and reports each card's flag by its front.</summary>
    private static async Task<Dictionary<string, bool>> ImportAsync(string apkg)
    {
        await using var target = new FlashcardStoreHarness();
        await target.Store.InitializeAsync();
        var library = NewLibrary(target);
        var cards = NewCards(target);
        var import = await NewAdapter(target, library, cards).ImportAsync(new ImportExportRequest { FilePath = apkg });
        Assert.True(import.Success, import.ErrorMessage);

        var deck = Assert.Single(await library.ListDecksAsync());
        var page = await cards.ListCardsAsync(new FlashcardCardQuery(deck.Id));
        return page.Items.ToDictionary(v => v.Card.Front, v => v.Card.IsFlagged, StringComparer.Ordinal);
    }

    private static FlashcardCardDraft Draft(string deckId, string front) =>
        new(deckId, FlashcardType.Classic, front, "back", Array.Empty<string>(), Array.Empty<FlashcardAttachment>());

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
