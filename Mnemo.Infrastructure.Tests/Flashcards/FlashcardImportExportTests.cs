using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Covers the flashcard import/export pipeline after the cut-over from the legacy whole-corpus JSON
/// store to the relational store: CSV import lands a deck + bulk cards on the Standard preset, and the
/// .mnemo payload handler round-trips content plus best-effort FSRS scheduling while keeping the
/// on-disk wire shape unchanged.
/// </summary>
public sealed class FlashcardImportExportTests
{
    // --- CSV ---

    [Fact]
    public async Task CsvImport_CreatesDeck_AndBulkCardsOnStandardPreset()
    {
        await using var h = new FlashcardStoreHarness();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var adapter = new FlashcardsCsvFormatAdapter(library, cardSvc, presetSvc);

        var csvPath = Path.Combine(Path.GetTempPath(), $"mnemo_csv_{Guid.NewGuid():N}.csv");
        await File.WriteAllTextAsync(csvPath,
            "front,back\n\"Capital of France?\",\"Paris\"\n\"2+2\",\"4\"\n");
        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.True(result.Success);
            Assert.Equal(2, result.ProcessedCounts["flashcards"]);
            var decks = await library.ListDecksAsync();
            var deck = Assert.Single(decks);
            Assert.Equal(FlashcardPreset.StandardPresetId, deck.Header.PresetId);
            Assert.Equal(2, deck.TotalCards);

            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            Assert.Contains(page.Items, v => v.Card.Front == "Capital of France?" && v.Card.Back == "Paris");
            // Imported cards arrive FSRS-new, due now.
            Assert.All(page.Items, v => Assert.Equal(FlashcardFsrsState.New, v.Schedule.FsrsState));
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task CsvExport_SingleDeck_WritesFrontBackRows()
    {
        await using var h = new FlashcardStoreHarness();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var adapter = new FlashcardsCsvFormatAdapter(library, cardSvc, presetSvc);

        var deck = await library.CreateDeckAsync("Geo");
        await cardSvc.CreateCardsAsync(deck.Id, new[]
        {
            Draft(deck.Id, "Q1", "A1"),
            Draft(deck.Id, "Q2", "A2")
        });

        var csvPath = Path.Combine(Path.GetTempPath(), $"mnemo_csv_out_{Guid.NewGuid():N}.csv");
        try
        {
            var result = await adapter.ExportAsync(new ImportExportRequest { FilePath = csvPath, Payload = new[] { deck.Id } });

            Assert.True(result.Success);
            Assert.Equal(2, result.ProcessedCounts["flashcards"]);
            var lines = await File.ReadAllLinesAsync(csvPath);
            Assert.Equal("front,back", lines[0]);
            Assert.Contains(lines, l => l.Contains("Q1") && l.Contains("A1"));
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    // --- .mnemo payload handler ---

    [Fact]
    public async Task MnemoExport_ProducesLegacyShapedSnapshot_WithFsrsFields()
    {
        await using var h = new FlashcardStoreHarness();
        var handler = NewHandler(h);
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var deck = await library.CreateDeckAsync("Biology");
        var created = await cardSvc.CreateCardsAsync(deck.Id, new[] { Draft(deck.Id, "Cell?", "Unit of life") });
        // Give the card a reviewed FSRS schedule so export carries non-default state.
        var reviewed = new FlashcardSchedule(created[0].Id, DateTimeOffset.UtcNow.AddDays(5), 8.2, 5.1, 3, 1, FlashcardFsrsState.Review, 0, DateTimeOffset.UtcNow);
        await h.Store.WriteAsync((c, tx, ct) => h.Schedules.UpsertAsync(c, tx, reviewed, ct));

        var export = await handler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });

        Assert.Equal(1, export.ItemCount);
        var json = System.Text.Encoding.UTF8.GetString(ReadDeckJson(export.Files["flashcards.db"]));
        // Wire shape is legacy camelCase with FSRS fields on the card.
        Assert.Contains("\"cards\"", json);
        Assert.Contains("\"stability\":8.2", json);
        Assert.Contains("\"fsrsState\":2", json);          // Review
        Assert.Contains("\"schedulingAlgorithm\":1", json); // Fsrs
    }

    [Fact]
    public async Task MnemoRoundTrip_LandsCards_AndCarriesFsrsSchedule()
    {
        // Export from one store.
        await using var source = new FlashcardStoreHarness();
        var sourceHandler = NewHandler(source);
        var sourceLibrary = NewLibrary(source);
        var sourceCards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);

        var deck = await sourceLibrary.CreateDeckAsync("History");
        var created = await sourceCards.CreateCardsAsync(deck.Id, new[] { Draft(deck.Id, "1066?", "Hastings") });
        var due = DateTimeOffset.UtcNow.AddDays(9);
        await source.Store.WriteAsync((c, tx, ct) => source.Schedules.UpsertAsync(c, tx,
            new FlashcardSchedule(created[0].Id, due, 12.0, 6.3, 4, 0, FlashcardFsrsState.Review, 0, DateTimeOffset.UtcNow), ct));

        var export = await sourceHandler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });

        // Import into a fresh store.
        await using var target = new FlashcardStoreHarness();
        await target.Store.InitializeAsync();
        var targetHandler = NewHandler(target);
        var targetLibrary = NewLibrary(target);
        var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);

        var import = await targetHandler.ImportAsync(BuildImportContext(export.Files, ImportConflictPolicy.KeepBoth));

        Assert.Equal(1, import.ImportedCount);
        var decks = await targetLibrary.ListDecksAsync();
        var importedDeck = Assert.Single(decks);
        Assert.Equal("History", importedDeck.Name);
        Assert.Equal(FlashcardPreset.StandardPresetId, importedDeck.Header.PresetId);

        var page = await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id));
        var view = Assert.Single(page.Items);
        Assert.Equal("1066?", view.Card.Front);
        // FSRS scheduling carried over.
        Assert.Equal(FlashcardFsrsState.Review, view.Schedule.FsrsState);
        Assert.Equal(12.0, view.Schedule.Stability);
        Assert.Equal(4, view.Schedule.Reps);
        Assert.Equal(due, view.Schedule.DueDate, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task MnemoExport_ReembedsAttachments_AsInlineTokens()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"mnemo_export_img_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        try
        {
            var imagePath = Path.Combine(tempDir, "diagram.png");
            await File.WriteAllBytesAsync(imagePath, new byte[64]);

            await using var h = new FlashcardStoreHarness();
            var handler = NewHandler(h);
            var library = NewLibrary(h);
            var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

            var deck = await library.CreateDeckAsync("Biology");
            var attachment = new FlashcardAttachment(
                Guid.NewGuid().ToString("N"), FlashcardAttachment.FrontSide, imagePath, "diagram.png", 64, "a diagram");
            var draft = new FlashcardCardDraft(
                deck.Id, FlashcardType.Classic, "Cell?", "Unit of life",
                Array.Empty<string>(), new[] { attachment });
            await cardSvc.CreateCardsAsync(deck.Id, new[] { draft });

            var export = await handler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });
            var json = System.Text.Encoding.UTF8.GetString(ReadDeckJson(export.Files["flashcards.db"]));

            Assert.Contains("![a diagram]", json);
            Assert.Contains("(diagram.png)", json);
            // Absolute image paths can disclose the exporting account name.
            Assert.DoesNotContain(imagePath.Replace("\\", "\\\\"), json);
        }
        finally
        {
            try { Directory.Delete(tempDir, recursive: true); } catch { /* best effort */ }
        }
    }

    [Fact]
    public async Task MnemoRoundTrip_ReimportsReembeddedTokens_BackIntoAttachments()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"mnemo_roundtrip_img_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        try
        {
            var imagePath = Path.Combine(tempDir, "diagram.png");
            await File.WriteAllBytesAsync(imagePath, new byte[64]);

            await using var source = new FlashcardStoreHarness();
            var sourceHandler = NewHandler(source);
            var sourceLibrary = NewLibrary(source);
            var sourceCards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);

            var deck = await sourceLibrary.CreateDeckAsync("Biology");
            var attachment = new FlashcardAttachment(
                Guid.NewGuid().ToString("N"), FlashcardAttachment.FrontSide, imagePath, "diagram.png", 64, "a diagram");
            var draft = new FlashcardCardDraft(
                deck.Id, FlashcardType.Classic, "Cell?", "Unit of life",
                Array.Empty<string>(), new[] { attachment });
            await sourceCards.CreateCardsAsync(deck.Id, new[] { draft });

            var export = await sourceHandler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetHandler = NewHandler(target);
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);

            var import = await targetHandler.ImportAsync(BuildImportContext(export.Files, ImportConflictPolicy.KeepBoth));
            Assert.Equal(1, import.ImportedCount);

            var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
            var page = await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id));
            var view = Assert.Single(page.Items);

            Assert.Equal("Cell?", view.Card.Front);
            Assert.DoesNotContain("![", view.Card.Front);
            var reimportedAttachment = Assert.Single(view.Card.Attachments);
            Assert.Equal(FlashcardAttachment.FrontSide, reimportedAttachment.Side);
            Assert.Equal("diagram.png", reimportedAttachment.DisplayName);
            Assert.Equal("a diagram", reimportedAttachment.Caption);
        }
        finally
        {
            try { Directory.Delete(tempDir, recursive: true); } catch { /* best effort */ }
        }
    }

    [Fact]
    public async Task MnemoRoundTrip_CarriesAttachmentBytes_ToAMachineWithoutTheOriginal()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"mnemo_backup_img_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        var imageBytes = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 };
        var imagePath = Path.Combine(tempDir, $"card_image_{Guid.NewGuid():N}.png");
        await File.WriteAllBytesAsync(imagePath, imageBytes);

        await using var source = new FlashcardStoreHarness();
        var sourceHandler = NewHandler(source);
        var sourceLibrary = NewLibrary(source);
        var sourceCards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);

        var deck = await sourceLibrary.CreateDeckAsync("Biology");
        var attachment = new FlashcardAttachment(
            Guid.NewGuid().ToString("N"), FlashcardAttachment.FrontSide, imagePath, "diagram.png", imageBytes.Length, "a diagram");
        await sourceCards.CreateCardsAsync(deck.Id, new[]
        {
            new FlashcardCardDraft(deck.Id, FlashcardType.Classic, "Cell?", "Unit of life", Array.Empty<string>(), new[] { attachment })
        });

        var export = await sourceHandler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });

        // The package has to stand on its own. Losing the original is exactly the case a backup is
        // taken for, so the restore below has nothing but the package to work from.
        Directory.Delete(tempDir, recursive: true);

        await using var target = new FlashcardStoreHarness();
        await target.Store.InitializeAsync();
        var targetHandler = NewHandler(target);
        var targetLibrary = NewLibrary(target);
        var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);

        var import = await targetHandler.ImportAsync(BuildImportContext(export.Files, ImportConflictPolicy.KeepBoth));
        Assert.Equal(1, import.ImportedCount);

        var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
        var page = await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id));
        var card = Assert.Single(page.Items).Card;
        var restored = Assert.Single(card.Attachments);

        Assert.Equal("Cell?", card.Front);
        Assert.True(File.Exists(restored.FilePath), restored.FilePath);
        Assert.Equal(imageBytes, await File.ReadAllBytesAsync(restored.FilePath));
        Assert.Equal("diagram.png", restored.DisplayName);
        Assert.Equal("a diagram", restored.Caption);
        File.Delete(restored.FilePath);
    }

    [Fact]
    public async Task MnemoRoundTrip_KeepsSuspensionAndFlags()
    {
        await using var source = new FlashcardStoreHarness();
        var sourceHandler = NewHandler(source);
        var sourceLibrary = NewLibrary(source);
        var sourceCards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);

        var deck = await sourceLibrary.CreateDeckAsync("States");
        var created = await sourceCards.CreateCardsAsync(deck.Id, new[]
        {
            Draft(deck.Id, "suspended", "a"),
            Draft(deck.Id, "flagged", "b"),
            Draft(deck.Id, "plain", "c"),
        });
        await sourceCards.SetSuspendedAsync(new[] { created[0].Id }, true);
        await sourceCards.SetFlaggedAsync(new[] { created[1].Id }, true);

        var export = await sourceHandler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });

        await using var target = new FlashcardStoreHarness();
        await target.Store.InitializeAsync();
        var targetHandler = NewHandler(target);
        var targetLibrary = NewLibrary(target);
        var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);

        await targetHandler.ImportAsync(BuildImportContext(export.Files, ImportConflictPolicy.KeepBoth));

        var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
        var page = await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id));
        var byFront = page.Items.ToDictionary(v => v.Card.Front, v => v.Card, StringComparer.Ordinal);

        // A card the user took out of study coming back active puts it straight back in the queue.
        Assert.Equal(FlashcardCardState.Suspended, byFront["suspended"].State);
        Assert.True(byFront["flagged"].IsFlagged);
        Assert.Equal(FlashcardCardState.Active, byFront["plain"].State);
        Assert.False(byFront["plain"].IsFlagged);
    }

    [Fact]
    public async Task MnemoImport_Skip_LeavesExistingDeckUntouched()
    {
        await using var h = new FlashcardStoreHarness();
        var handler = NewHandler(h);
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var deck = await library.CreateDeckAsync("Geo");
        await cardSvc.CreateCardsAsync(deck.Id, new[] { Draft(deck.Id, "Q", "A") });
        var export = await handler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });

        // Re-import the same package (same deck id) with Skip: nothing new lands.
        var import = await handler.ImportAsync(BuildImportContext(export.Files, ImportConflictPolicy.Skip));

        Assert.Equal(0, import.ImportedCount);
        Assert.Equal(1, import.SkippedCount);
        Assert.Single(await library.ListDecksAsync());
    }

    // --- helpers ---

    private static FlashcardCardDraft Draft(string deckId, string front, string back) =>
        new(deckId, FlashcardType.Classic, front, back, Array.Empty<string>(), Array.Empty<FlashcardAttachment>());

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    private static FlashcardsMnemoPayloadHandler NewHandler(FlashcardStoreHarness h) =>
        FlashcardPackageFixture.Handler(h);

    private static MnemoPayloadImportContext BuildImportContext(IReadOnlyDictionary<string, byte[]> files, ImportConflictPolicy policy) =>
        new()
        {
            Entry = new MnemoPackageEntry { PayloadType = "flashcards", Path = "flashcards" },
            Options = new MnemoPackageImportOptions { ConflictPolicy = policy },
            Files = new Dictionary<string, byte[]>(files)
        };

    /// <summary>Reads the first Decks.Json blob out of the exported flashcards.db bytes.</summary>
    private static byte[] ReadDeckJson(byte[] dbBytes)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo_read_{Guid.NewGuid():N}.db");
        try
        {
            File.WriteAllBytes(tempPath, dbBytes);
            // Pooling is off so disposing the connection releases the temp file for the delete
            // below, without a process wide pool clear that would disrupt other collections'
            // live connections.
            using var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={tempPath};Pooling=False");
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Json FROM Decks LIMIT 1";
            var json = (string)cmd.ExecuteScalar()!;
            return System.Text.Encoding.UTF8.GetBytes(json);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }
}
