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

/// <summary>The fixtures, the import call and the assertions the Anki image occlusion import tests share.</summary>
internal static class AnkiOcclusionImportKit
{
    internal const double Tolerance = 1e-4;

    internal static string Fixture(string name) =>
        Path.Combine(AppContext.BaseDirectory, "Flashcards", "Fixtures", "Anki", name);

    internal sealed record Note(FlashcardFact Fact, OcclusionDocument Doc, Flashcard[] Cards);

    internal static void AssertBox(OcclusionMask mask, double x, double y, double w, double h)
    {
        Assert.Equal(x, mask.X, Tolerance);
        Assert.Equal(y, mask.Y, Tolerance);
        Assert.Equal(w, mask.W, Tolerance);
        Assert.Equal(h, mask.H, Tolerance);
    }

    internal static void AssertPoints(OcclusionMask mask, params (double X, double Y)[] expected)
    {
        Assert.Equal(expected.Length, mask.Points!.Count);
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(expected[i].X, mask.Points[i][0], Tolerance);
            Assert.Equal(expected[i].Y, mask.Points[i][1], Tolerance);
        }
    }

    internal static int CountOf(ImportExportResult result, string keyStem) =>
        result.Warnings.Single(w => w.Key == keyStem + "Many").Count!.Value;

    internal static Task<IReadOnlyList<FlashcardReviewLog>> ReviewsAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync((conn, ct) => h.Reviews.ListForCardsAsync(conn, [cardId], ct));

    internal static async Task<(ImportExportResult Result, Flashcard[] Cards)> ImportAsync(FlashcardStoreHarness h, string name)
    {
        await h.Store.InitializeAsync();
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(
            library, cardService, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            h.Clock, new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));

        var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = Fixture(name) });
        Assert.True(result.Success, result.ErrorMessage);

        var deck = Assert.Single(await library.ListDecksAsync(), d => d.Name == "Anatomy");
        var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));
        return (result, page.Items.Select(v => v.Card).ToArray());
    }

    internal static async Task<Dictionary<string, Note>> NotesAsync(FlashcardStoreHarness h, Flashcard[] cards)
    {
        var notes = new Dictionary<string, Note>(StringComparer.Ordinal);
        foreach (var group in cards.Where(c => c.FactId is not null).GroupBy(c => c.FactId))
        {
            var fact = (await h.FactService.GetFactAsync(group.Key!))!;
            var doc = FlashcardOcclusion.Parse(fact.Value(FlashcardCardType.OcclusionMasksFieldId));
            notes[fact.Value(FlashcardCardType.OcclusionFrontFieldId)] = new Note(fact, doc, [.. group]);
        }

        return notes;
    }

    internal static async Task<(ImportExportResult Result, Note Note)> ImportNoteAsync(
        FlashcardStoreHarness h, string name, string header)
    {
        var (result, cards) = await ImportAsync(h, name);
        var notes = await NotesAsync(h, cards);
        var note = notes[header];
        Assert.Equal(FlashcardCardType.OcclusionId, note.Fact.TypeId);
        return (result, note);
    }
}
