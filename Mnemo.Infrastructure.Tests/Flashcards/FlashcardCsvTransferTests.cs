using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Checks CSV header mapping, headerless input, and collection round trips.
/// </summary>
public sealed class FlashcardCsvTransferTests
{
    [Fact]
    public async Task ExportThenImport_TwoDecks_KeepsEveryFrontBackAndDeck()
    {
        await using var source = new FlashcardStoreHarness();
        var sourceLibrary = NewLibrary(source);
        var sourceCards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);

        var geo = await sourceLibrary.CreateDeckAsync("Geo");
        await sourceCards.CreateCardsAsync(geo.Id, new[] { Draft(geo.Id, "Q1", "A1"), Draft(geo.Id, "Q2", "A2") });
        var bio = await sourceLibrary.CreateDeckAsync("Bio");
        await sourceCards.CreateCardsAsync(bio.Id, new[] { Draft(bio.Id, "Q3", "A3") });

        var csvPath = NewCsvPath();
        try
        {
            var export = await NewAdapter(source, sourceLibrary, sourceCards)
                .ExportAsync(new ImportExportRequest { FilePath = csvPath });
            Assert.True(export.Success);

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);

            var import = await NewAdapter(target, targetLibrary, targetCards)
                .ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.True(import.Success, import.ErrorMessage);
            Assert.Equal(3, import.ProcessedCounts["flashcards"]);
            Assert.Equal(2, import.ProcessedCounts["decks"]);

            var decks = await targetLibrary.ListDecksAsync();
            Assert.Equal(
                new[] { "Bio", "Geo" },
                decks.Select(d => d.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray());

            var geoBack = await SidesAsync(targetCards, decks.Single(d => d.Name == "Geo").Id);
            Assert.Equal(new[] { ("Q1", "A1"), ("Q2", "A2") }, geoBack);
            var bioBack = await SidesAsync(targetCards, decks.Single(d => d.Name == "Bio").Id);
            Assert.Equal(new[] { ("Q3", "A3") }, bioBack);
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task ExportThenImport_OneDeck_KeepsEveryFrontAndBack()
    {
        await using var source = new FlashcardStoreHarness();
        var sourceLibrary = NewLibrary(source);
        var sourceCards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);

        var deck = await sourceLibrary.CreateDeckAsync("Geo");
        await sourceCards.CreateCardsAsync(deck.Id, new[] { Draft(deck.Id, "Q1", "A1"), Draft(deck.Id, "Q2", "A2") });

        var csvPath = NewCsvPath();
        try
        {
            await NewAdapter(source, sourceLibrary, sourceCards)
                .ExportAsync(new ImportExportRequest { FilePath = csvPath, Payload = new[] { deck.Id } });

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);

            var import = await NewAdapter(target, targetLibrary, targetCards)
                .ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.True(import.Success, import.ErrorMessage);
            var imported = Assert.Single(await targetLibrary.ListDecksAsync());
            Assert.Equal(new[] { ("Q1", "A1"), ("Q2", "A2") }, await SidesAsync(targetCards, imported.Id));
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task Import_HeaderInAnyOrder_ReadsColumnsByName()
    {
        var sides = await ImportSidesAsync("back,front\n\"A1\",\"Q1\"\n");

        Assert.Equal(new[] { ("Q1", "A1") }, sides);
    }

    [Fact]
    public async Task Import_FileWithNoHeader_ReadsTheFirstRowAsACard()
    {
        var sides = await ImportSidesAsync("\"Q1\",\"A1\"\n\"Q2\",\"A2\"\n");

        Assert.Equal(new[] { ("Q1", "A1"), ("Q2", "A2") }, sides);
    }

    [Fact]
    public async Task Import_RowWithNoFront_IsSkippedAndSaidSo()
    {
        await using var h = new FlashcardStoreHarness();
        var library = NewLibrary(h);
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var csvPath = NewCsvPath();
        await File.WriteAllTextAsync(csvPath, "front,back\n\"Q1\",\"A1\"\n\"\",\"orphan\"\n\"Q2\",\"A2\"\n");
        try
        {
            var result = await NewAdapter(h, library, cards).ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            Assert.Equal(new[] { ("Q1", "A1"), ("Q2", "A2") }, await SidesAsync(cards, deck.Id));

            var warning = Assert.Single(result.Warnings, w => w.Key == "CsvRowSkipped");
            Assert.Equal("3", warning.Params["row"]);
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task Import_ManyUnreadableRows_WarnsFiveTimesAndCountsTheRest()
    {
        await using var h = new FlashcardStoreHarness();
        var library = NewLibrary(h);
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var text = "front,back\n\"Q1\",\"A1\"\n" + string.Concat(Enumerable.Repeat("\"\",\"orphan\"\n", 8)) + "\"Q2\",\"A2\"\n";
        var csvPath = NewCsvPath();
        await File.WriteAllTextAsync(csvPath, text);
        try
        {
            var result = await NewAdapter(h, library, cards).ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.True(result.Success, result.ErrorMessage);
            Assert.Equal(5, result.Warnings.Count(w => w.Key == "CsvRowSkipped"));
            var overflow = Assert.Single(result.Warnings, w => w.Key == "CsvRowsSkippedMore");
            Assert.Equal("3", overflow.Params["count"]);

            var deck = Assert.Single(await library.ListDecksAsync());
            Assert.Equal(new[] { ("Q1", "A1"), ("Q2", "A2") }, await SidesAsync(cards, deck.Id));
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task Import_FileEndingInsideAQuotedValue_KeepsWhatItReadAndWarns()
    {
        await using var h = new FlashcardStoreHarness();
        var library = NewLibrary(h);
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var csvPath = NewCsvPath();
        await File.WriteAllTextAsync(csvPath, "front,back\n\"Q1\",\"A1\"\n\"Q2\",\"A2");
        try
        {
            var result = await NewAdapter(h, library, cards).ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            Assert.Equal(new[] { ("Q1", "A1"), ("Q2", "A2") }, await SidesAsync(cards, deck.Id));
            Assert.Contains(result.Warnings, w => w.Key == "CsvUnterminatedQuote");
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task Import_EmptyFile_FailsWithoutMakingADeck()
    {
        await using var h = new FlashcardStoreHarness();
        var library = NewLibrary(h);
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var csvPath = NewCsvPath();
        await File.WriteAllTextAsync(csvPath, string.Empty);
        try
        {
            var result = await NewAdapter(h, library, cards).ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.False(result.Success);
            Assert.Empty(await library.ListDecksAsync());
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task Import_HeaderAndNothingElse_MakesTheDeckTheFileNames()
    {
        await using var h = new FlashcardStoreHarness();
        var library = NewLibrary(h);
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var csvPath = NewCsvPath();
        await File.WriteAllTextAsync(csvPath, "front,back\n");
        try
        {
            var result = await NewAdapter(h, library, cards).ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            Assert.Equal(Path.GetFileNameWithoutExtension(csvPath), deck.Name);
            Assert.Empty(result.Warnings);
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task ExportThenImport_MultiLineBack_KeepsBothLines()
    {
        var sides = await RoundTripAsync("Q1", "- a\n- b");

        Assert.Equal(("Q1", "- a\n- b"), sides);
    }

    [Fact]
    public async Task ExportThenImport_EmptyBack_ComesBackEmpty()
    {
        var sides = await RoundTripAsync("Q1", string.Empty);

        Assert.Equal(("Q1", string.Empty), sides);
    }

    [Fact]
    public async Task ExportThenImport_TextWithCommasAndQuotes_ComesBackUnchanged()
    {
        var sides = await RoundTripAsync("Say \"hello\", twice", "a, b, and \"c\"");

        Assert.Equal(("Say \"hello\", twice", "a, b, and \"c\""), sides);
    }


    /// <summary>Exports one card through the real exporter and imports the file it wrote.</summary>
    private static async Task<(string Front, string Back)> RoundTripAsync(string front, string back)
    {
        await using var source = new FlashcardStoreHarness();
        var sourceLibrary = NewLibrary(source);
        var sourceCards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);

        var deck = await sourceLibrary.CreateDeckAsync("Geo");
        await sourceCards.CreateCardsAsync(deck.Id, new[] { Draft(deck.Id, front, back) });

        var csvPath = NewCsvPath();
        try
        {
            await NewAdapter(source, sourceLibrary, sourceCards)
                .ExportAsync(new ImportExportRequest { FilePath = csvPath, Payload = new[] { deck.Id } });

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);

            var result = await NewAdapter(target, targetLibrary, targetCards)
                .ImportAsync(new ImportExportRequest { FilePath = csvPath });
            Assert.True(result.Success, result.ErrorMessage);

            var imported = Assert.Single(await targetLibrary.ListDecksAsync());
            return Assert.Single(await SidesAsync(targetCards, imported.Id));
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    private static async Task<IReadOnlyList<(string Front, string Back)>> ImportSidesAsync(string text)
    {
        await using var h = new FlashcardStoreHarness();
        var library = NewLibrary(h);
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var csvPath = NewCsvPath();
        await File.WriteAllTextAsync(csvPath, text);
        try
        {
            var result = await NewAdapter(h, library, cards).ImportAsync(new ImportExportRequest { FilePath = csvPath });
            Assert.True(result.Success, result.ErrorMessage);

            var deck = Assert.Single(await library.ListDecksAsync());
            return await SidesAsync(cards, deck.Id);
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    private static async Task<IReadOnlyList<(string Front, string Back)>> SidesAsync(FlashcardCardService cards, string deckId)
    {
        var page = await cards.ListCardsAsync(new FlashcardCardQuery(deckId, Limit: 500));
        return page.Items
            .Select(v => (v.Card.Front, v.Card.Back))
            .OrderBy(s => s.Front, StringComparer.Ordinal)
            .ToList();
    }

    private static string NewCsvPath() => Path.Combine(Path.GetTempPath(), $"mnemo_csv_{Guid.NewGuid():N}.csv");

    private static FlashcardCardDraft Draft(string deckId, string front, string back) =>
        new(deckId, FlashcardType.Classic, front, back, Array.Empty<string>(), Array.Empty<FlashcardAttachment>());

    private static FlashcardsCsvFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        FlashcardCardService cards) =>
        new(library, cards, new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock));

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
}
