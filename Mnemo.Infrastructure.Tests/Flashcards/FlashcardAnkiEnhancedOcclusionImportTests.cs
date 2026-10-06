using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Image Occlusion Enhanced notes whose fields were renamed, imported end to end.</summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiEnhancedOcclusionImportTests
{
    private const string Set = "4be1c0de";

    private static readonly AnkiFixtureNoteType Renamed = new(
        1700000000001L,
        "Bildverdeckung",
        ["Kennung", "Kopf", "Bild", "Fragemaske", "Fuss", "Antwortmaske", "Originalmaske"],
        [new AnkiFixtureTemplate("Karte", "{{Bild}}{{Fragemaske}}", "{{Bild}}{{Antwortmaske}}")]);

    private static string Mask(bool firstAsked, bool secondAsked) => $"""
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
         <rect x="10" y="10" width="40" height="20" fill="{(firstAsked ? "#FF7E7E" : "#FFEBA2")}" id="{Set}-ao-1"/>
         <rect x="100" y="50" width="60" height="30" fill="{(secondAsked ? "#FF7E7E" : "#FFEBA2")}" id="{Set}-ao-2"/>
        </svg>
        """;

    private static AnkiFixtureCard Note(int ordinal) => new(
        "Anatomy",
        $"{Set}-ao-{ordinal}",
        "Heart",
        NoteType: Renamed,
        ExtraFields:
        [
            "<img src=\"heart.png\">",
            $"<img src=\"{Set}-ao-{ordinal}-Q.svg\">",
            "Left side",
            $"<img src=\"{Set}-ao-{ordinal}-A.svg\">",
            $"<img src=\"{Set}-ao-O.svg\">",
        ]);

    [Fact]
    public async Task Import_RenamedFields_FindsTheSetByWhatItsFieldsHold_AndLeavesOutACopiedNote()
    {
        var media = new Dictionary<string, byte[]>(StringComparer.Ordinal)
        {
            ["heart.png"] = Convert.FromBase64String(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
            [$"{Set}-ao-1-Q.svg"] = Encoding.UTF8.GetBytes(Mask(true, false)),
            [$"{Set}-ao-2-Q.svg"] = Encoding.UTF8.GetBytes(Mask(false, true)),
            [$"{Set}-ao-O.svg"] = Encoding.UTF8.GetBytes(Mask(false, false)),
        };
        var package = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, [Note(1), Note(2), Note(2)], media);

        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(
            library, cardService, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            h.Clock, new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = package });
            Assert.True(result.Success, result.ErrorMessage);

            var deck = Assert.Single(await library.ListDecksAsync(), d => d.Name == "Anatomy");
            var cards = (await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id))).Items.Select(v => v.Card).ToArray();
            Assert.Equal(2, cards.Length);
            Assert.All(cards, c => Assert.Equal(FlashcardType.Occlusion, c.Type));

            var fact = (await h.FactService.GetFactAsync(cards[0].FactId!))!;
            Assert.Equal("Heart", fact.Value(FlashcardCardType.OcclusionFrontFieldId));
            Assert.Equal("Left side", fact.Value(FlashcardCardType.OcclusionBackFieldId));
            Assert.Equal(2, FlashcardOcclusion.Parse(fact.Value(FlashcardCardType.OcclusionMasksFieldId)).Masks.Count);

            var repeats = Assert.Single(result.Warnings, w => w.Key == "AnkiOcclusionRepeatsSkippedMany");
            Assert.Equal(1, repeats.Count);
            Assert.DoesNotContain(result.Warnings, w => w.Key.StartsWith("AnkiMedia", StringComparison.Ordinal));
        }
        finally
        {
            File.Delete(package);
        }
    }
}
