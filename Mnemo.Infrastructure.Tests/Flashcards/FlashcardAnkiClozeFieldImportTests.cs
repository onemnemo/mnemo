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
/// A cloze note type decides which of its fields holds the deletions, and shared decks routinely
/// put a title ahead of it. Reading the first field as the text instead landed every deletion row
/// as a separate basic card with the raw markers on its back and dropped the rest of the note.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiClozeFieldImportTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    private const string ClozeText = "{{c1::Lidocaine}} is class {{c2::Ib}}";

    private static readonly AnkiFixtureNoteType ClozeWithTitle = new(
        Id: 1700000000003L,
        Name: "Cloze with title",
        FieldNames: ["Title", "Text", "Extra"],
        Templates:
        [
            new AnkiFixtureTemplate("Cloze", "{{Title}}<br>{{cloze:Text}}", "{{Title}}<br>{{cloze:Text}}<br>{{Extra}}"),
        ],
        IsCloze: true);

    private static AnkiFixtureCard Note() =>
        new(
            "Pharmacology",
            "Antiarrhythmics",
            ClozeText,
            ExtraFields: ["Shortens repolarisation."],
            NoteType: ClozeWithTitle,
            CardRows: [new AnkiFixtureCardRow(0), new AnkiFixtureCardRow(1)]);

    [Fact]
    public async Task Import_ClozeFieldNamedByTheTemplate_MakesOneCardPerDeletionFromThatField()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, [Note()], new Dictionary<string, byte[]>());
        try
        {
            await using var h = new FlashcardStoreHarness(Now);
            var (result, cards) = await ImportAsync(h, apkg);

            Assert.Equal(new[] { "c1", "c2" }, cards.Select(c => c.LayoutKey).ToArray());
            Assert.Equal("[…] is class Ib", cards[0].Front);
            Assert.Equal("Lidocaine is class […]", cards[1].Front);
            Assert.All(cards, c => Assert.Equal(FlashcardType.Cloze, c.Type));

            var factId = Assert.Single(cards.Select(c => c.FactId).Distinct(StringComparer.Ordinal));
            var fact = await h.FactService.GetFactAsync(factId!);
            Assert.NotNull(fact);
            Assert.Equal(FlashcardCardType.ClozeId, fact.TypeId);
            Assert.Equal(ClozeText, fact.Value(FlashcardCardType.ClozeTextFieldId));

            // The fields the template shows around the deletions travel as the extra, so the title
            // and the note's own extra both survive rather than one replacing the text.
            Assert.Equal("Antiarrhythmics\n\nShortens repolarisation.", fact.Value(FlashcardCardType.ClozeExtraFieldId));
            Assert.DoesNotContain(result.Warnings, w => w.Key == "AnkiExtraFieldsDropped");
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_ClozeFieldWithNoTemplateToNameIt_IsTheFirstFieldHoldingADeletion()
    {
        // The current package layout keeps templates in an encoded config, so nothing says which
        // field the deletions live in. The markers themselves are the only signal left.
        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Modern, [Note()], new Dictionary<string, byte[]>());
        try
        {
            await using var h = new FlashcardStoreHarness(Now);
            var (result, cards) = await ImportAsync(h, apkg);

            Assert.Equal(new[] { "c1", "c2" }, cards.Select(c => c.LayoutKey).ToArray());
            Assert.Equal("[…] is class Ib", cards[0].Front);
            Assert.Equal("Lidocaine is class […]", cards[1].Front);

            var factId = Assert.Single(cards.Select(c => c.FactId).Distinct(StringComparer.Ordinal));
            var fact = await h.FactService.GetFactAsync(factId!);
            Assert.NotNull(fact);
            Assert.Equal(FlashcardCardType.ClozeId, fact.TypeId);
            Assert.Equal(ClozeText, fact.Value(FlashcardCardType.ClozeTextFieldId));
            // The field after the text is the extra, the way Anki's own cloze type lays it out,
            // so the explanation is kept over the title.
            Assert.Equal("Shortens repolarisation.", fact.Value(FlashcardCardType.ClozeExtraFieldId));

            // Without a template a card still has room for two fields, and the third is reported
            // rather than silently left behind.
            Assert.Contains(result.Warnings, w => w.Key == "AnkiExtraFieldsDropped");
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    private static async Task<(ImportExportResult Result, Flashcard[] Cards)> ImportAsync(FlashcardStoreHarness h, string apkg)
    {
        await h.Store.InitializeAsync();
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(
            library, cardService, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            h.Clock, new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));

        var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
        Assert.True(result.Success, result.ErrorMessage);

        var deck = Assert.Single(await library.ListDecksAsync());
        var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));
        var cards = page.Items.Select(v => v.Card).OrderBy(c => c.LayoutKey, StringComparer.Ordinal).ToArray();
        return (result, cards);
    }
}
