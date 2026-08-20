using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
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
/// A piece of material whose cards are its deletions has to leave as one note. Written out a note
/// per card it arrives as unrelated cards that all show the same sentence with the same word
/// blanked, answering one holds none of the others back, and editing the sentence reaches one of
/// them, which is everything material is for.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiClozeExportTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    private const string ClozeText = "{{c1::Lidocaine}} is class {{c2::Ib}} and blocks {{c3::sodium}} channels";

    /// <summary>Anki's note type kind for cloze, which is what makes a card per deletion.</summary>
    private const int ClozeModelKind = 1;

    [Fact]
    public async Task Export_MaterialWhoseCardsAreDeletions_ShipsAsOneNoteWithARowPerDeletion()
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_cloze_{Guid.NewGuid():N}.apkg");
        try
        {
            await using (var h = await OpenAsync())
            {
                var saved = await h.FactService.SaveFactAsync(ClozeDraft());
                Assert.Equal(3, saved.Cards.Count);

                var export = await NewAdapter(h).ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            var contents = await AnkiPackageInspector.ReadAsync(apkg);

            // One note, holding the sentence as it was written, deletions and all. The cards render
            // one deletion each; the note is the material behind them.
            var note = Assert.Single(contents.Notes);
            Assert.Equal(ClozeText, note.Fields[0]);
            Assert.Equal("Shortens repolarisation.", note.Fields[1]);

            // Three rows off that one note, numbered from zero for the deletion written as c1.
            Assert.Equal(3, contents.Cards.Count);
            Assert.All(contents.Cards, c => Assert.Equal(note.Id, c.NoteId));
            Assert.Equal(new[] { 0, 1, 2 }, contents.Cards.Select(c => c.Ord).OrderBy(o => o).ToArray());

            // A note type that says cloze. Filed under a basic one the receiving app would make a
            // single card carrying the raw markup rather than the deletions.
            using var models = JsonDocument.Parse(contents.ModelsJson);
            var model = models.RootElement.GetProperty(note.ModelId.ToString(System.Globalization.CultureInfo.InvariantCulture));
            Assert.Equal(ClozeModelKind, model.GetProperty("type").GetInt32());
            Assert.Equal("{{cloze:Text}}", model.GetProperty("tmpls")[0].GetProperty("qfmt").GetString());
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task ExportThenImport_MaterialWhoseCardsAreDeletions_ComesBackAsOnePiece()
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_cloze_{Guid.NewGuid():N}.apkg");
        try
        {
            await using (var source = await OpenAsync())
            {
                await source.FactService.SaveFactAsync(ClozeDraft());
                var export = await NewAdapter(source).ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            await using var target = new FlashcardStoreHarness(Now);
            await target.Store.InitializeAsync();
            var library = NewLibrary(target);
            var cards = NewCards(target);

            var import = await NewAdapter(target, library, cards).ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cards.ListCardsAsync(new FlashcardCardQuery(deck.Id));

            var imported = page.Items.Select(v => v.Card).OrderBy(c => c.LayoutKey, StringComparer.Ordinal).ToArray();
            Assert.Equal(new[] { "c1", "c2", "c3" }, imported.Select(c => c.LayoutKey).ToArray());

            var factId = Assert.Single(imported.Select(c => c.FactId).Distinct(StringComparer.Ordinal));
            var fact = await target.FactService.GetFactAsync(factId!);
            Assert.NotNull(fact);
            Assert.Equal(FlashcardCardType.ClozeId, fact!.TypeId);
            Assert.Equal(ClozeText, fact.Value(FlashcardCardType.ClozeTextFieldId));
            Assert.Equal("Shortens repolarisation.", fact.Value(FlashcardCardType.ClozeExtraFieldId));

            // Each card asks its own deletion with the rest of the sentence showing. Three cards
            // reading the same way is what a note per card produces.
            Assert.Equal("[…] is class Ib and blocks sodium channels", imported[0].Front);
            Assert.Equal(3, imported.Select(c => c.Front).Distinct(StringComparer.Ordinal).Count());
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    // --- helpers ---

    private static FlashcardFactDraft ClozeDraft() =>
        new(
            null,
            "deck-1",
            FlashcardCardType.ClozeId,
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [FlashcardCardType.ClozeTextFieldId] = ClozeText,
                [FlashcardCardType.ClozeExtraFieldId] = "Shortens repolarisation.",
            },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal),
            []);

    private static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    private static FlashcardCardService NewCards(FlashcardStoreHarness h) =>
        new(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    private static FlashcardsAnkiFormatAdapter NewAdapter(FlashcardStoreHarness h) =>
        NewAdapter(h, NewLibrary(h), NewCards(h));

    private static FlashcardsAnkiFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        FlashcardCardService cardSvc) =>
        new(library, cardSvc, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService());
}
