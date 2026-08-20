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
/// Covers exporting cards to an Anki package and reading the result back into a clean profile.
/// Card images live as attachments, so an export that looks anywhere else ships a deck of bare text.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiExportTests
{
    [Fact]
    public async Task ExportThenImport_CarriesImagesOnBothSides()
    {
        var assets = NewAssetDirectory();
        var frontImage = Path.Combine(assets, "front.png");
        var backImage = Path.Combine(assets, "back.jpg");
        await File.WriteAllBytesAsync(frontImage, PngBytes());
        await File.WriteAllBytesAsync(backImage, JpegBytes());

        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_export_{Guid.NewGuid():N}.apkg");

        try
        {
            await using (var source = new FlashcardStoreHarness())
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);
                var adapter = NewAdapter(source, library, cards);

                var deck = await library.CreateDeckAsync("Histology");
                await cards.CreateCardsAsync(deck.Id, new[]
                {
                    new FlashcardCardDraft(
                        deck.Id, FlashcardType.Classic, "Identify", "Epithelium", Array.Empty<string>(),
                        new[]
                        {
                            Attachment(FlashcardAttachment.FrontSide, frontImage, "front.png"),
                            Attachment(FlashcardAttachment.BackSide, backImage, "back.jpg"),
                        }),
                });

                var export = await adapter.ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);
            var targetAdapter = NewAdapter(target, targetLibrary, targetCards);

            var import = await targetAdapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
            var page = await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id));
            var card = Assert.Single(page.Items).Card;

            Assert.Equal(2, card.Attachments.Count);
            var front = Assert.Single(card.Attachments, a => a.Side == FlashcardAttachment.FrontSide);
            var back = Assert.Single(card.Attachments, a => a.Side == FlashcardAttachment.BackSide);
            Assert.Equal(PngBytes(), await File.ReadAllBytesAsync(front.FilePath));
            Assert.Equal(JpegBytes(), await File.ReadAllBytesAsync(back.FilePath));

            DeleteAll(card.Attachments);
        }
        finally
        {
            File.Delete(apkg);
            try { Directory.Delete(assets, recursive: true); } catch (IOException) { }
        }
    }

    [Fact]
    public async Task ExportThenImport_TwoImagesWithTheSameName_StayDistinct()
    {
        var assets = NewAssetDirectory();
        var firstDirectory = Path.Combine(assets, "one");
        var secondDirectory = Path.Combine(assets, "two");
        Directory.CreateDirectory(firstDirectory);
        Directory.CreateDirectory(secondDirectory);

        // Same filename, different pictures, which is what happens as soon as two cards get their
        // images from two different places.
        var first = Path.Combine(firstDirectory, "diagram.png");
        var second = Path.Combine(secondDirectory, "diagram.png");
        await File.WriteAllBytesAsync(first, PngBytes());
        await File.WriteAllBytesAsync(second, JpegBytes());

        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_export_{Guid.NewGuid():N}.apkg");

        try
        {
            await using (var source = new FlashcardStoreHarness())
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);
                var adapter = NewAdapter(source, library, cards);

                var deck = await library.CreateDeckAsync("Collisions");
                await cards.CreateCardsAsync(deck.Id, new[]
                {
                    new FlashcardCardDraft(
                        deck.Id, FlashcardType.Classic, "first", "a", Array.Empty<string>(),
                        new[] { Attachment(FlashcardAttachment.FrontSide, first, "diagram.png") }),
                    new FlashcardCardDraft(
                        deck.Id, FlashcardType.Classic, "second", "b", Array.Empty<string>(),
                        new[] { Attachment(FlashcardAttachment.FrontSide, second, "diagram.png") }),
                });

                var export = await adapter.ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);
            var targetAdapter = NewAdapter(target, targetLibrary, targetCards);

            var import = await targetAdapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
            var page = await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id));
            var byFront = page.Items.ToDictionary(v => v.Card.Front, v => v.Card, StringComparer.Ordinal);

            var firstAttachment = Assert.Single(byFront["first"].Attachments);
            var secondAttachment = Assert.Single(byFront["second"].Attachments);

            // Keyed by filename alone the second card resolves to the first card's picture, and the
            // deck ships showing the wrong image with nothing to hint at it.
            Assert.Equal(PngBytes(), await File.ReadAllBytesAsync(firstAttachment.FilePath));
            Assert.Equal(JpegBytes(), await File.ReadAllBytesAsync(secondAttachment.FilePath));

            DeleteAll(byFront["first"].Attachments);
            DeleteAll(byFront["second"].Attachments);
        }
        finally
        {
            File.Delete(apkg);
            try { Directory.Delete(assets, recursive: true); } catch (IOException) { }
        }
    }

    private static FlashcardAttachment Attachment(string side, string path, string displayName) =>
        new(Guid.NewGuid().ToString("N"), side, path, displayName, new FileInfo(path).Length, null);

    private static string NewAssetDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"mnemo_anki_assets_{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        return directory;
    }

    private static void DeleteAll(IReadOnlyList<FlashcardAttachment> attachments)
    {
        foreach (var attachment in attachments)
        {
            try { File.Delete(attachment.FilePath); } catch (IOException) { }
        }
    }

    private static FlashcardsAnkiFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        FlashcardCardService cardSvc) =>
        new(library, cardSvc, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock), new ImageAssetService());

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    private static byte[] PngBytes() => Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    private static byte[] JpegBytes() => Convert.FromBase64String(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==");
}
