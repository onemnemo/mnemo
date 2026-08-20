using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;
using Mnemo.Infrastructure.Services.Packaging;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Covers the layout every current Anki build exports: a compressed collection database on the
/// newer schema, a binary media table, and compressed media payloads. Everything Anki has shipped
/// in years arrives this way, so a reader that only understands the older layout imports nothing.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiModernPackageTests
{
    [Fact]
    public async Task Import_ModernPackage_ReadsCardsAndDeckName()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var adapter = NewAdapter(h, library, cardSvc);

        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Modern,
            [new AnkiFixtureCard("Pharmacology", "What blocks beta receptors?", "Beta blockers")],
            new Dictionary<string, byte[]>());

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());

            // The newer schema blanks the column the older reader took deck names from. Reading it
            // anyway imports every deck under a placeholder built from its numeric id.
            Assert.Equal("Pharmacology", deck.Name);

            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            var card = Assert.Single(page.Items).Card;
            Assert.Equal("What blocks beta receptors?", card.Front);
            Assert.Equal("Beta blockers", card.Back);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Preview_ModernPackage_CountsCards()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var adapter = NewAdapter(h, library, cardSvc);

        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Modern,
            [
                new AnkiFixtureCard("Anatomy", "Front one", "Back one"),
                new AnkiFixtureCard("Anatomy", "Front two", "Back two"),
            ],
            new Dictionary<string, byte[]>());

        try
        {
            var preview = await adapter.PreviewImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.True(preview.CanImport);
            Assert.Equal(2, preview.DiscoveredCounts["flashcards"]);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_ModernPackageMedia_LandsAsAttachment()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var adapter = NewAdapter(h, library, cardSvc);

        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Modern,
            [new AnkiFixtureCard("Histology", "Identify: <img src=\"slide.png\">", "Epithelium")],
            new Dictionary<string, byte[]> { ["slide.png"] = PngBytes() });

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            var attachment = Assert.Single(Assert.Single(page.Items).Card.Attachments);

            Assert.Equal("slide.png", attachment.DisplayName);
            Assert.Equal(".png", Path.GetExtension(attachment.FilePath));

            // The payload is compressed inside the archive, so a copy that skipped decompression
            // would store a file that is not a PNG at all.
            Assert.Equal(PngBytes(), await File.ReadAllBytesAsync(attachment.FilePath));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_ModernPackage_KeepsDeckHierarchySeparator()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var adapter = NewAdapter(h, library, cardSvc);

        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Modern,
            [new AnkiFixtureCard("Medicine::Cardiology::Arrhythmias", "Front", "Back")],
            new Dictionary<string, byte[]>());

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            var folders = await library.ListFoldersAsync();

            // The newer schema separates the levels with a control character. Left as-is the name
            // reaches the user with an unprintable box in it.
            Assert.Equal("Arrhythmias", deck.Name);
            Assert.Equal(new[] { "Cardiology", "Medicine" }, folders.Select(f => f.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray());
            Assert.DoesNotContain(AnkiPackageFixture.UnitSeparator, deck.Name);
            Assert.All(folders, f => Assert.DoesNotContain(AnkiPackageFixture.UnitSeparator, f.Name));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Extract_CompressedPayloadLargerThanTheLimit_StopsMidCopy()
    {
        // A quarter of a megabyte of zeros compresses to a few dozen bytes, which is exactly the
        // shape of a decompression bomb: nothing in the archive's own numbers looks large.
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Modern,
            [new AnkiFixtureCard("Bomb", "Front", "Back")],
            new Dictionary<string, byte[]> { ["huge.bin"] = new byte[256 * 1024] });

        var destination = Path.Combine(Path.GetTempPath(), $"mnemo_anki_bomb_{Guid.NewGuid():N}");
        Directory.CreateDirectory(destination);
        var limits = new MnemoPackageService.PackageReadLimits(
            MaxEntryCount: 50_000,
            MaxEntryBytes: 100 * 1024,
            MaxTotalBytes: 2L * 1024 * 1024 * 1024,
            MaxPathDepth: 32);

        try
        {
            await Assert.ThrowsAsync<InvalidDataException>(
                () => AnkiPackageReader.ExtractAsync(apkg, destination, limits, CancellationToken.None));

            Assert.All(
                Directory.GetFiles(destination),
                path => Assert.True(new FileInfo(path).Length <= limits.MaxEntryBytes, path));
        }
        finally
        {
            File.Delete(apkg);
            try { Directory.Delete(destination, recursive: true); } catch (IOException) { }
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

    /// <summary>A real 1x1 PNG, so the import stores what the bytes actually are.</summary>
    private static byte[] PngBytes() => Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
}
