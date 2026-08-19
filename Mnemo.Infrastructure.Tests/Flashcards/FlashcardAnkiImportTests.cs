using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Covers the Anki (.apkg) image reroute: imported <c>&lt;img&gt;</c> tags become
/// <see cref="FlashcardAttachment"/>s (up to 3 per side; overflow appended as inline markdown tokens)
/// rather than image blocks. The canonical body is the text field and blocks carry no image payloads.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiImportTests
{
    private const char UnitSeparator = '';

    [Fact]
    public async Task Import_ImageInField_LandsAsAttachment_NotBlock()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        var apkg = await BuildApkgAsync(
            deckName: "Biology",
            frontHtml: "What is this? <img src=\"diagram.png\">",
            backHtml: "A cell",
            media: new Dictionary<string, byte[]> { ["diagram.png"] = PngBytes() });

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            var card = Assert.Single(page.Items).Card;

            var attachment = Assert.Single(card.Attachments);
            Assert.Equal(FlashcardAttachment.FrontSide, attachment.Side);
            Assert.Equal("diagram.png", attachment.DisplayName);
            Assert.True(attachment.SizeBytes > 0);
            Assert.True(File.Exists(attachment.FilePath));

            // Anki stores media under numbered names, so the stored copy has to take its
            // extension from the bytes. Without one the file is not a servable asset id and
            // every imported image renders as a broken placeholder.
            var storedName = Path.GetFileName(attachment.FilePath);
            Assert.Equal(".png", Path.GetExtension(storedName));
            Assert.Equal(storedName, Path.GetFileName(storedName));
            Assert.DoesNotContain("..", storedName, StringComparison.Ordinal);

            // No image blocks anywhere — the block pipeline is text-only now.
            var allBlocks = (card.FrontBlocks ?? Array.Empty<Block>())
                .Concat(card.BackBlocks ?? Array.Empty<Block>());
            Assert.DoesNotContain(allBlocks, b => b.Type == BlockType.Image);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_FourImagesOnOneSide_KeepsThreeAttachments_AndAppendsOverflowToken()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        var apkg = await BuildApkgAsync(
            deckName: "Overflow",
            frontHtml: "<img src=\"a.png\"><img src=\"b.png\"><img src=\"c.png\"><img src=\"d.png\">",
            backHtml: "back",
            media: new Dictionary<string, byte[]>
            {
                ["a.png"] = PngBytes(),
                ["b.png"] = PngBytes(),
                ["c.png"] = PngBytes(),
                ["d.png"] = PngBytes()
            });

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            var card = Assert.Single(page.Items).Card;

            Assert.Equal(3, card.Attachments.Count);
            Assert.All(card.Attachments, a => Assert.Equal(FlashcardAttachment.FrontSide, a.Side));
            // The 4th image is kept visible as an inline markdown token, never dropped.
            Assert.Contains("![d.png](", card.Front, StringComparison.Ordinal);
            Assert.Contains(result.Warnings, w => w.Contains("exceeded", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_MissingCollectionDatabase_CleansUpExtractedTempDirectory()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        // A .apkg with no collection.anki21/anki2 fails after the temp directory is already
        // extracted; both call sites must still remove it rather than leaking it in %TEMP%.
        var apkg = await BuildBrokenApkgAsync();

        try
        {
            var before = LeftoverImportDirectories();

            var preview = await adapter.PreviewImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.False(preview.CanImport);

            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.False(result.Success);

            var after = LeftoverImportDirectories();
            Assert.Equal(before, after);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_MediaNamedAsTheWrongType_StoresTheTypeTheBytesCarry()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        var apkg = await BuildApkgAsync(
            deckName: "Mislabelled",
            frontHtml: "<img src=\"photo.png\">",
            backHtml: "back",
            media: new Dictionary<string, byte[]> { ["photo.png"] = JpegBytes() });

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            var attachment = Assert.Single(Assert.Single(page.Items).Card.Attachments);

            Assert.Equal(".jpg", Path.GetExtension(attachment.FilePath));
            Assert.Equal("photo.png", attachment.DisplayName);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_NonImageMedia_IsRefusedWithAWarning()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        var apkg = await BuildApkgAsync(
            deckName: "NotAnImage",
            frontHtml: "<img src=\"report.pdf\">",
            backHtml: "back",
            media: new Dictionary<string, byte[]> { ["report.pdf"] = "%PDF-1.4 not an image"u8.ToArray() });

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            Assert.Empty(Assert.Single(page.Items).Card.Attachments);
            Assert.Contains(result.Warnings, w => w.Contains("report.pdf", StringComparison.Ordinal));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Import_SrcPointingOutsideThePackage_CopiesNothing(bool absolute)
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        // A real image outside the package, so only the containment check can stop it being
        // copied. A non-image would be refused for the wrong reason and prove nothing.
        var outsideName = $"mnemo_anki_outside_{Guid.NewGuid():N}.png";
        var outsidePath = Path.Combine(Path.GetTempPath(), outsideName);
        await File.WriteAllBytesAsync(outsidePath, PngBytes());

        var src = absolute ? outsidePath : "../" + outsideName;
        var apkg = await BuildApkgAsync(
            deckName: "Traversal",
            frontHtml: $"<img src=\"{src.Replace("\\", "/", StringComparison.Ordinal)}\">",
            backHtml: "back",
            media: new Dictionary<string, byte[]>());

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            Assert.Empty(Assert.Single(page.Items).Card.Attachments);
            Assert.Contains(result.Warnings, w => w.Contains("was not found in package", StringComparison.Ordinal));
            Assert.True(File.Exists(outsidePath));
        }
        finally
        {
            File.Delete(apkg);
            File.Delete(outsidePath);
        }
    }

    [Fact]
    public async Task Import_PackageEntryEscapingTheWorkingDirectory_WritesNothingOutside()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        var apkg = await BuildApkgAsync("Escape", "front", "back", new Dictionary<string, byte[]>());
        var escapeName = $"mnemo_anki_escape_{Guid.NewGuid():N}.png";
        var escapePath = Path.Combine(Path.GetTempPath(), escapeName);

        // The working directory sits directly under the temp directory, so one level up is enough
        // for an archive entry to plant a file where nothing asked it to.
        await using (var file = File.Open(apkg, FileMode.Open, FileAccess.ReadWrite))
        using (var archive = new ZipArchive(file, ZipArchiveMode.Update))
        {
            var entry = archive.CreateEntry("../" + escapeName, CompressionLevel.NoCompression);
            await using var stream = entry.Open();
            await stream.WriteAsync(PngBytes());
        }

        try
        {
            var before = LeftoverImportDirectories();

            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.False(result.Success);
            Assert.False(File.Exists(escapePath));
            Assert.Equal(before, LeftoverImportDirectories());
        }
        finally
        {
            File.Delete(apkg);
            File.Delete(escapePath);
        }
    }

    // --- helpers ---

    /// <summary>A real 1x1 PNG, so the import stores what the bytes actually are.</summary>
    private static byte[] PngBytes() => Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    /// <summary>A real 1x1 JPEG.</summary>
    private static byte[] JpegBytes() => Convert.FromBase64String(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==");

    private static HashSet<string> LeftoverImportDirectories() =>
        new(Directory.GetDirectories(Path.GetTempPath(), "mnemo-anki-import-*"), StringComparer.OrdinalIgnoreCase);

    /// <summary>Writes a .apkg zip containing no collection.anki21/anki2, for temp-cleanup coverage.</summary>
    private static async Task<string> BuildBrokenApkgAsync()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"mnemo_anki_broken_fixture_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempRoot);
        await File.WriteAllTextAsync(Path.Combine(tempRoot, "not-a-collection.txt"), "no database here");

        var apkgPath = Path.Combine(Path.GetTempPath(), $"mnemo_anki_broken_{Guid.NewGuid():N}.apkg");
        ZipFile.CreateFromDirectory(tempRoot, apkgPath, CompressionLevel.Optimal, includeBaseDirectory: false);
        try { Directory.Delete(tempRoot, recursive: true); } catch (IOException) { }
        return apkgPath;
    }

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    /// <summary>Writes a minimal single-note, single-card package in the older layout.</summary>
    private static Task<string> BuildApkgAsync(
        string deckName,
        string frontHtml,
        string backHtml,
        IReadOnlyDictionary<string, byte[]> media) =>
        AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            [new AnkiFixtureCard(deckName, frontHtml, backHtml)],
            media);
}
