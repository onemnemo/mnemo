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

/// <summary>Formats that cannot hold masks leave occlusion cards out and say so, and a backup carries them whole.</summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardOcclusionTransferTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    private const string Masks =
        """{"v":1,"mode":"hideOne","masks":[{"id":"aa","shape":"rect","x":0.1,"y":0.1,"w":0.2,"h":0.2,"label":"One","order":0},{"id":"bb","shape":"ellipse","x":0.5,"y":0.5,"w":0.2,"h":0.2,"group":"bb","order":1}]}""";

    [Fact]
    public async Task An_anki_export_leaves_occlusion_cards_out_and_counts_them()
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_occl_{Guid.NewGuid():N}.apkg");
        try
        {
            await using (var h = await OpenAsync())
            {
                await SaveBasicAsync(h);
                await SaveOcclusionAsync(h);

                var export = await NewAnki(h).ExportAsync(new ImportExportRequest { FilePath = apkg });

                Assert.True(export.Success, export.ErrorMessage);
                var warning = Assert.Single(export.Warnings, w => w.Key == "ExportOcclusionSkippedMany");
                Assert.Equal("ExportOcclusionSkippedOne", warning.OneKey);
                Assert.Equal(2, warning.Count);
                Assert.Equal(1, export.ProcessedCounts["flashcards"]);
            }

            var contents = await AnkiPackageInspector.ReadAsync(apkg);
            Assert.Single(contents.Notes);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task A_csv_export_leaves_occlusion_cards_out_and_counts_them()
    {
        var csv = Path.Combine(Path.GetTempPath(), $"mnemo_csv_occl_{Guid.NewGuid():N}.csv");
        try
        {
            await using var h = await OpenAsync();
            await SaveBasicAsync(h);
            await SaveOcclusionAsync(h);
            var adapter = new FlashcardsCsvFormatAdapter(
                NewLibrary(h),
                new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock),
                new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock));

            var export = await adapter.ExportAsync(
                new ImportExportRequest { FilePath = csv, Payload = "deck-1" });

            Assert.True(export.Success, export.ErrorMessage);
            var warning = Assert.Single(export.Warnings, w => w.Key == "ExportOcclusionSkippedMany");
            Assert.Equal(2, warning.Count);
            Assert.Equal(1, export.ProcessedCounts["flashcards"]);
            Assert.DoesNotContain("One", await File.ReadAllTextAsync(csv), StringComparison.Ordinal);
        }
        finally
        {
            File.Delete(csv);
        }
    }

    [Fact]
    public async Task A_backup_carries_an_occlusion_fact_and_its_cards_whole()
    {
        var images = FlashcardPackageFixture.NewImagesDirectory();
        var imagePath = Path.Combine(images, "diagram.png");
        await File.WriteAllBytesAsync(imagePath, [1, 2, 3, 4]);

        await using var source = await OpenAsync();
        var saved = await SaveOcclusionAsync(source, imagePath);

        var package = await FlashcardPackageFixture.Handler(source, images)
            .ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        await FlashcardPackageFixture.Handler(target, FlashcardPackageFixture.NewImagesDirectory())
            .ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var fact = await target.FactService.GetFactAsync(saved.Fact.Id);
        Assert.NotNull(fact);
        Assert.Equal(FlashcardCardType.OcclusionId, fact!.TypeId);
        Assert.Equal(Masks, fact.Value(FlashcardCardType.OcclusionMasksFieldId));
        Assert.Single(fact.MediaOn(FlashcardCardType.OcclusionImageFieldId));

        var cards = await target.Store.ReadAsync(async (conn, ct) =>
        {
            var found = new List<Flashcard>();
            foreach (var key in await target.Facts.GetCardKeysAsync(conn, saved.Fact.Id, ct))
                found.Add((await target.Cards.GetAsync(conn, key.CardId, ct))!);
            return found;
        });
        Assert.Equal(["maa", "mbb"], cards.Select(c => c.LayoutKey).Order(StringComparer.Ordinal));
        Assert.All(cards, c => Assert.Equal(FlashcardType.Occlusion, c.Type));
        Assert.NotNull(await target.FactService.GetCardTypeAsync(FlashcardCardType.OcclusionId));
    }

    private static Task<FlashcardFactSaved> SaveOcclusionAsync(FlashcardStoreHarness h, string? imagePath = null) =>
        h.FactService.SaveFactAsync(new FlashcardFactDraft(
            null,
            "deck-1",
            FlashcardCardType.OcclusionId,
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [FlashcardCardType.OcclusionFrontFieldId] = "Label the cell",
                [FlashcardCardType.OcclusionMasksFieldId] = Masks,
            },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal)
            {
                [FlashcardCardType.OcclusionImageFieldId] =
                    [new FlashcardAttachment("img1", FlashcardAttachment.FrontSide, imagePath ?? "C:/images/diagram.png", "diagram.png", 4)],
            },
            []));

    private static Task<FlashcardFactSaved> SaveBasicAsync(FlashcardStoreHarness h) =>
        h.FactService.SaveFactAsync(new FlashcardFactDraft(
            null,
            "deck-1",
            FlashcardCardType.BasicId,
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [FlashcardCardType.BasicFrontFieldId] = "Capital of France",
                [FlashcardCardType.BasicBackFieldId] = "Paris",
            },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal),
            []));

    private static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    private static FlashcardsAnkiFormatAdapter NewAnki(FlashcardStoreHarness h) =>
        new(NewLibrary(h), new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock), h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            h.Clock, new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));
}
