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
/// A multi-deck CSV names each deck with the folders it sits in, joined by <c>::</c> the way Anki
/// does, so two decks that share a name in different folders come back apart and in place.
/// </summary>
public sealed class FlashcardCsvDeckPathTests
{
    [Fact]
    public async Task ExportThenImport_SameNamedDecksInTwoFolders_StayApartInTheirFolders()
    {
        var csv = await ExportAsync(async (library, cards) =>
        {
            await library.SaveFolderAsync(new FlashcardFolder("lang", "Languages", null, 0));
            await library.SaveFolderAsync(new FlashcardFolder("es", "Spanish", "lang", 1));
            await library.SaveFolderAsync(new FlashcardFolder("fr", "French", null, 2));
            await AddDeckAsync(library, cards, "Vocab", "es", "hola");
            await AddDeckAsync(library, cards, "Vocab", "fr", "bonjour");
            await AddDeckAsync(library, cards, "Loose", null, "free");
        });

        try
        {
            var text = await File.ReadAllTextAsync(csv);
            Assert.Contains("\"Languages::Spanish::Vocab\",\"hola\"", text, StringComparison.Ordinal);
            Assert.Contains("\"French::Vocab\",\"bonjour\"", text, StringComparison.Ordinal);
            Assert.Contains("\"Loose\",\"free\"", text, StringComparison.Ordinal);

            var landed = await ImportAsync(csv);
            Assert.Equal(
                new[] { "French/Vocab: bonjour", "Languages/Spanish/Vocab: hola", "Loose: free" },
                landed);
        }
        finally
        {
            File.Delete(csv);
        }
    }

    [Fact]
    public async Task Import_PathIntoAnExistingFolder_ReusesIt()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cards = NewCards(h);
        await library.SaveFolderAsync(new FlashcardFolder("es", "Spanish", null, 0));

        var csv = NewCsvPath();
        await File.WriteAllTextAsync(csv, "deck,front,back\n\"Spanish::Verbs\",\"ir\",\"to go\"\n");
        try
        {
            var result = await NewAdapter(h, library, cards).ImportAsync(new ImportExportRequest { FilePath = csv });
            Assert.True(result.Success, result.ErrorMessage);

            Assert.Single(await library.ListFoldersAsync());
            var deck = Assert.Single(await library.ListDecksAsync());
            Assert.Equal("Verbs", deck.Name);
            Assert.Equal("es", deck.Header.FolderId);
        }
        finally
        {
            File.Delete(csv);
        }
    }

    [Fact]
    public async Task Import_SeparatorInADeckCell_MakesFoldersEvenInAnOlderFile()
    {
        var csv = NewCsvPath();
        await File.WriteAllTextAsync(csv, "deck,front,back\n\" A :: :: B \",\"one\",\"1\"\n\"::\",\"two\",\"2\"\n");
        try
        {
            var landed = await ImportAsync(csv);
            // A cell that is nothing but separators names no folder, so it stays the deck's name.
            Assert.Equal(new[] { "::: two", "A/B: one" }, landed);
        }
        finally
        {
            File.Delete(csv);
        }
    }

    private static async Task AddDeckAsync(
        FlashcardLibraryService library, FlashcardCardService cards, string name, string? folderId, string front)
    {
        var deck = await library.CreateDeckAsync(name, folderId);
        await cards.CreateCardsAsync(deck.Id,
            [new FlashcardCardDraft(deck.Id, FlashcardType.Classic, front, "back", Array.Empty<string>(), Array.Empty<FlashcardAttachment>())]);
    }

    /// <summary>Builds a library, exports every deck in it, and returns the file.</summary>
    private static async Task<string> ExportAsync(Func<FlashcardLibraryService, FlashcardCardService, Task> build)
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cards = NewCards(h);
        await build(library, cards);

        var csv = NewCsvPath();
        var export = await NewAdapter(h, library, cards).ExportAsync(new ImportExportRequest { FilePath = csv });
        Assert.True(export.Success, export.ErrorMessage);
        return csv;
    }

    /// <summary>Imports into a clean profile and lists each card as "folder/.../deck: front", sorted.</summary>
    private static async Task<string[]> ImportAsync(string csv)
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cards = NewCards(h);
        var result = await NewAdapter(h, library, cards).ImportAsync(new ImportExportRequest { FilePath = csv });
        Assert.True(result.Success, result.ErrorMessage);

        var folders = (await library.ListFoldersAsync()).ToDictionary(f => f.Id, StringComparer.Ordinal);
        var landed = new List<string>();
        foreach (var deck in await library.ListDecksAsync())
        {
            var path = new List<string> { deck.Name };
            for (var id = deck.Header.FolderId; id is not null && folders.TryGetValue(id, out var folder); id = folder.ParentId)
                path.Insert(0, folder.Name);

            var page = await cards.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            landed.AddRange(page.Items.Select(v => $"{string.Join('/', path)}: {v.Card.Front}"));
        }

        return [.. landed.Order(StringComparer.Ordinal)];
    }

    private static string NewCsvPath() => Path.Combine(Path.GetTempPath(), $"mnemo_csv_{Guid.NewGuid():N}.csv");

    private static FlashcardCardService NewCards(FlashcardStoreHarness h) =>
        new(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

    private static FlashcardsCsvFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        FlashcardCardService cards) =>
        new(library, cards, new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock));

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
}
