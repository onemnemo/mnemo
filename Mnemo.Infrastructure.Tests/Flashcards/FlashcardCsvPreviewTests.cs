using System;
using System.IO;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// The CSV preview has to say what the import will do. The transfer dialog trusts it: a file it
/// calls importable is offered, and its counts are what the reader sees before pressing Import.
/// </summary>
public sealed class FlashcardCsvPreviewTests
{
    [Fact]
    public async Task PreviewImportAsync_EmptyFile_RefusesTheImportAndSaysWhy()
    {
        await using var h = new FlashcardStoreHarness();
        var adapter = NewAdapter(h);

        var csvPath = NewCsvPath();
        await File.WriteAllTextAsync(csvPath, string.Empty);
        try
        {
            var preview = await adapter.PreviewImportAsync(new ImportExportRequest { FilePath = csvPath });
            var import = await adapter.ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.False(preview.CanImport);
            Assert.False(import.Success);
            Assert.Equal(0, preview.DiscoveredCounts["flashcards"]);
            Assert.Equal(0, preview.DiscoveredCounts["decks"]);
            var warning = Assert.Single(preview.Warnings);
            Assert.Equal("CsvEmpty", warning.Key);
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task PreviewImportAsync_BlankLinesOnly_RefusesTheImport()
    {
        await using var h = new FlashcardStoreHarness();
        var adapter = NewAdapter(h);

        var csvPath = NewCsvPath();
        await File.WriteAllTextAsync(csvPath, "\n\n  \n");
        try
        {
            var preview = await adapter.PreviewImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.False(preview.CanImport);
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task PreviewImportAsync_HeaderAndNothingElse_ReportsTheOneDeckTheImportMakes()
    {
        await using var h = new FlashcardStoreHarness();
        var adapter = NewAdapter(h);

        var csvPath = NewCsvPath();
        await File.WriteAllTextAsync(csvPath, "front,back\n");
        try
        {
            var preview = await adapter.PreviewImportAsync(new ImportExportRequest { FilePath = csvPath });
            var import = await adapter.ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.True(preview.CanImport);
            Assert.True(import.Success, import.ErrorMessage);
            Assert.Equal(0, preview.DiscoveredCounts["flashcards"]);
            Assert.Equal(1, preview.DiscoveredCounts["decks"]);
            Assert.Equal(import.ProcessedCounts["decks"], preview.DiscoveredCounts["decks"]);
            Assert.Empty(preview.Warnings);
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    [Fact]
    public async Task PreviewImportAsync_DeckColumn_CountsDistinctDecksTheWayTheImportGroupsThem()
    {
        await using var h = new FlashcardStoreHarness();
        var adapter = NewAdapter(h);

        var csvPath = NewCsvPath();
        // "Geo" twice, "geo" once (a different deck by exact spelling), and one row with no deck,
        // which goes to the deck named after the file.
        await File.WriteAllTextAsync(csvPath,
            "deck,front,back\n\"Geo\",\"Q1\",\"A1\"\n\"geo\",\"Q2\",\"A2\"\n\"Geo\",\"Q3\",\"A3\"\n\"\",\"Q4\",\"A4\"\n");
        try
        {
            var preview = await adapter.PreviewImportAsync(new ImportExportRequest { FilePath = csvPath });
            var import = await adapter.ImportAsync(new ImportExportRequest { FilePath = csvPath });

            Assert.True(import.Success, import.ErrorMessage);
            Assert.Equal(3, preview.DiscoveredCounts["decks"]);
            Assert.Equal(4, preview.DiscoveredCounts["flashcards"]);
            Assert.Equal(import.ProcessedCounts["decks"], preview.DiscoveredCounts["decks"]);
            Assert.Equal(import.ProcessedCounts["flashcards"], preview.DiscoveredCounts["flashcards"]);
        }
        finally
        {
            File.Delete(csvPath);
        }
    }

    private static string NewCsvPath() => Path.Combine(Path.GetTempPath(), $"mnemo_csv_{Guid.NewGuid():N}.csv");

    private static FlashcardsCsvFormatAdapter NewAdapter(FlashcardStoreHarness h)
    {
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        return new FlashcardsCsvFormatAdapter(library, cards, new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock));
    }
}
