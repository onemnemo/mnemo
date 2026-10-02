using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Imports packages written by Anki itself (see Fixtures/Anki/generate_fixtures.py), so the note
/// types arrive exactly as a current Anki stores them in collection.anki21b.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiNoteTypeTests
{
    private static string Fixture(string name) =>
        Path.Combine(AppContext.BaseDirectory, "Flashcards", "Fixtures", "Anki", name);

    [Fact]
    public async Task Reader_ModernPackage_ReadsFieldsTemplatesAndStockKind()
    {
        var temp = Path.Combine(Path.GetTempPath(), $"mnemo-anki-nt-{Guid.NewGuid():N}");
        Directory.CreateDirectory(temp);
        try
        {
            var kinds = new Dictionary<string, AnkiNoteType>();
            foreach (var name in new[] { "anki21b-basic-reversed.apkg", "anki21b-four-field.apkg", "anki21b-image-occlusion.apkg" })
            {
                var dir = Path.Combine(temp, Path.GetFileNameWithoutExtension(name));
                Directory.CreateDirectory(dir);
                var contents = await AnkiPackageReader.ExtractAsync(Fixture(name), dir, default);
                Assert.Equal(AnkiPackageVersion.Latest, contents.Version);
                await using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
                {
                    DataSource = contents.CollectionPath,
                    Mode = SqliteOpenMode.ReadOnly,
                    Pooling = false,
                }.ToString());
                await connection.OpenAsync();
                AnkiNoteTypeReader.RegisterCollations(connection);
                kinds[name] = Assert.Single((await AnkiNoteTypeReader.ReadAsync(connection, string.Empty, default)).Values);
            }

            var reversed = kinds["anki21b-basic-reversed.apkg"];
            Assert.Equal(AnkiStockKind.BasicAndReversed, reversed.StockKind);
            Assert.Equal(new[] { "Front", "Back" }, reversed.FieldNames);
            Assert.Equal(new[] { 1 }, reversed.TemplateFor(1)!.FrontFields);

            var four = kinds["anki21b-four-field.apkg"];
            Assert.Equal(new[] { "Word", "Meaning", "Example", "Notes" }, four.FieldNames);
            Assert.Equal(new[] { 1, 2, 3 }, Assert.Single(four.Templates).BackFields);

            var occlusion = kinds["anki21b-image-occlusion.apkg"];
            Assert.True(occlusion.IsCloze);
            Assert.True(occlusion.IsImageOcclusion);
            Assert.Equal(0, occlusion.ClozeField);
        }
        finally
        {
            Directory.Delete(temp, recursive: true);
        }
    }

    [Fact]
    public async Task Import_ModernBasic_LandsEachNoteOnItsOwnFields()
    {
        await using var h = new FlashcardStoreHarness();
        var (result, cards) = await ImportAsync(h, Fixture("anki21b-basic.apkg"), "Geography");

        Assert.Equal(new[] { "Capital of France?", "Capital of Norway?" }, cards.Select(c => c.Front).Order(StringComparer.Ordinal));
        Assert.Contains(cards, c => c.Front == "Capital of France?" && c.Back == "Paris");
        Assert.DoesNotContain(result.Warnings, w => w.Key == "AnkiExtraFieldsDropped");
    }

    [Fact]
    public async Task Import_ModernBasicAndReversed_MakesOneFactWithBothDirections()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, cards) = await ImportAsync(h, Fixture("anki21b-basic-reversed.apkg"), "Vocabulary");

        Assert.Equal(2, cards.Length);
        var factId = Assert.Single(cards.Select(c => c.FactId).Distinct(StringComparer.Ordinal));
        var fact = await h.FactService.GetFactAsync(factId!);
        Assert.Equal(FlashcardCardType.BasicReverseId, fact!.TypeId);
        Assert.Equal(
            new[] { FlashcardCardType.RecallLayoutId, FlashcardCardType.RecognitionLayoutId }.Order(StringComparer.Ordinal),
            cards.Select(c => c.LayoutKey!).Order(StringComparer.Ordinal));
        Assert.Contains(cards, c => c.Front.Contains("der Hund", StringComparison.Ordinal));
        Assert.Contains(cards, c => c.Front.Contains("the dog", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("anki21b-four-field.apkg")]
    [InlineData("anki-legacy-four-field.apkg")]
    public async Task Import_FourFieldType_KeepsEveryFieldTheTemplateShows(string fixture)
    {
        await using var h = new FlashcardStoreHarness();
        var (result, cards) = await ImportAsync(h, Fixture(fixture), "Spanish");

        var card = Assert.Single(cards);
        Assert.Equal("el gato", card.Front);
        Assert.Contains("the cat", card.Back, StringComparison.Ordinal);
        Assert.Contains("El gato duerme.", card.Back, StringComparison.Ordinal);
        Assert.Contains("Masculine noun", card.Back, StringComparison.Ordinal);
        Assert.DoesNotContain(result.Warnings, w => w.Key == "AnkiExtraFieldsDropped");
    }

    [Fact]
    public async Task Import_ModernTypeInTheAnswer_KeepsTheAnswerOffTheQuestion()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, cards) = await ImportAsync(h, Fixture("anki21b-typing.apkg"), "Capitals");

        var card = Assert.Single(cards);
        Assert.Equal("Capital of France?", card.Front);
        Assert.Equal("Paris", card.Back);
    }

    [Fact]
    public async Task Import_ModernHint_PutsTheHintOnTheBackRatherThanTheQuestion()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, cards) = await ImportAsync(h, Fixture("anki21b-hint.apkg"), "Chemistry");

        var card = Assert.Single(cards);
        Assert.Equal("Symbol for gold?", card.Front);
        Assert.Contains("Au", card.Back, StringComparison.Ordinal);
        Assert.Contains("From the Latin aurum", card.Back, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Import_LegacyTypeInTheAnswer_KeepsTheAnswerOffTheQuestion()
    {
        var typing = new AnkiFixtureNoteType(
            1_700_000_000_301L,
            "Basic (type in the answer)",
            ["Front", "Back"],
            [new AnkiFixtureTemplate("Card 1", "{{Front}}\n\n{{type:Back}}", "{{Front}}<hr id=answer>{{type:Back}}")]);
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            [new AnkiFixtureCard("Capitals", "Capital of France?", "Paris", NoteType: typing)],
            new Dictionary<string, byte[]>());
        try
        {
            await using var h = new FlashcardStoreHarness();
            var (_, cards) = await ImportAsync(h, apkg, "Capitals");

            var card = Assert.Single(cards);
            Assert.Equal("Capital of France?", card.Front);
            Assert.Equal("Paris", card.Back);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_ModernCloze_KeepsTheExtraFromTheNamedField()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, cards) = await ImportAsync(h, Fixture("anki21b-cloze.apkg"), "History");

        Assert.Equal(new[] { "c1", "c2" }, cards.Select(c => c.LayoutKey!).Order(StringComparer.Ordinal));
        var fact = await h.FactService.GetFactAsync(cards[0].FactId!);
        Assert.Equal(FlashcardCardType.ClozeId, fact!.TypeId);
        Assert.Equal("Legend says so.", fact.Value(FlashcardCardType.ClozeExtraFieldId));
    }

    [Fact]
    public async Task Import_BuiltInImageOcclusion_StaysPlainCardsRatherThanCloze()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, cards) = await ImportAsync(h, Fixture("anki21b-image-occlusion.apkg"), "Anatomy");

        // One plain card per mask, as before; reading the masks as cloze text would put the shape
        // strings on the front of every card.
        Assert.Equal(2, cards.Length);
        foreach (var card in cards)
        {
            var fact = await h.FactService.GetFactAsync(card.FactId!);
            Assert.NotEqual(FlashcardCardType.ClozeId, fact!.TypeId);
        }

        Assert.All(cards, c =>
        {
            Assert.Equal(FlashcardType.Classic, c.Type);
            Assert.DoesNotContain("image-occlusion", c.Front, StringComparison.Ordinal);
            Assert.Contains("Label the map", c.Front, StringComparison.Ordinal);
            Assert.Contains("Extra text", c.Back, StringComparison.Ordinal);
            Assert.Contains(c.Attachments, a => a.Side == FlashcardAttachment.FrontSide);
        });
    }

    [Fact]
    public async Task Import_OverAnEarlierFlattenedImport_LeavesTheOldCardsAlone()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();

        // What an earlier build made of the reversed note: two plain forward cards, no fact.
        var oldDeck = await h.SeedDeckAsync("old-vocabulary");
        foreach (var id in new[] { "old-1", "old-2" })
        {
            await h.AddCardAsync(
                FlashcardStoreHarness.Card(id, oldDeck, "der Hund", "the dog"),
                FlashcardSchedule.NewFor(id, DateTimeOffset.UtcNow));
        }

        var (_, cards) = await ImportAsync(h, Fixture("anki21b-basic-reversed.apkg"), "Vocabulary");

        Assert.Equal(2, cards.Length);
        Assert.Empty(await h.HeldAsync());
        var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var old = await cardService.ListCardsAsync(new FlashcardCardQuery(oldDeck));
        Assert.Equal(new[] { "old-1", "old-2" }, old.Items.Select(v => v.Card.Id).Order(StringComparer.Ordinal));
    }

    private static async Task<(ImportExportResult Result, Flashcard[] Cards)> ImportAsync(
        FlashcardStoreHarness h,
        string apkg,
        string deckName)
    {
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

        var deck = Assert.Single(await library.ListDecksAsync(), d => d.Name == deckName);
        var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));
        return (result, page.Items.Select(v => v.Card).OrderBy(c => c.LayoutKey, StringComparer.Ordinal).ToArray());
    }
}
