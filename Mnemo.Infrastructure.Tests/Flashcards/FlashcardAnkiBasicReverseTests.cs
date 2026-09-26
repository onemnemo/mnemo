using System;
using System.Collections.Generic;
using System.Globalization;
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
/// Basic and reverse material travels as one note of Anki's "Basic (and reversed card)" type, two
/// cards off it. Written as two unrelated basic notes, each card came back as material of its own.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiBasicReverseTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    // The note type as Anki ships it, under its own id and a translated name: the shape is what
    // identifies it, not the name.
    private static readonly AnkiFixtureNoteType ReversedType = new(
        Id: 1342697561419L,
        Name: "Einfach (mit umgedrehter Karte)",
        FieldNames: ["Front", "Back"],
        Templates:
        [
            new AnkiFixtureTemplate("Card 1", "{{Front}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}"),
            new AnkiFixtureTemplate("Card 2", "{{Back}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}"),
        ]);

    [Fact]
    public async Task Export_BasicAndReverse_ShipsAsOneNoteOfAnkisOwnTwoCardType()
    {
        var apkg = NewPackagePath();
        try
        {
            await using (var h = await OpenAsync())
            {
                var saved = await h.FactService.SaveFactAsync(ReverseDraft());
                Assert.Equal(2, saved.Cards.Count);

                var export = await NewAdapter(h).ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            var contents = await AnkiPackageInspector.ReadAsync(apkg);
            var note = Assert.Single(contents.Notes);
            Assert.Equal(new[] { "perro", "dog" }, note.Fields.ToArray());
            Assert.Equal(2, contents.Cards.Count);
            Assert.All(contents.Cards, c => Assert.Equal(note.Id, c.NoteId));
            Assert.Equal(new[] { 0, 1 }, contents.Cards.Select(c => c.Ord).OrderBy(o => o).ToArray());

            using var models = JsonDocument.Parse(contents.ModelsJson);
            var model = models.RootElement.GetProperty(note.ModelId.ToString(CultureInfo.InvariantCulture));
            Assert.Equal("Basic (and reversed card)", model.GetProperty("name").GetString());
            Assert.Equal(0, model.GetProperty("type").GetInt32());
            Assert.Equal(new[] { "Front", "Back" }, model.GetProperty("flds").EnumerateArray().Select(f => f.GetProperty("name").GetString()).ToArray());
            var templates = model.GetProperty("tmpls").EnumerateArray().ToArray();
            Assert.Equal(new[] { "Card 1", "Card 2" }, templates.Select(t => t.GetProperty("name").GetString()).ToArray());
            Assert.Equal("{{Front}}", templates[0].GetProperty("qfmt").GetString());
            Assert.Equal("{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}", templates[0].GetProperty("afmt").GetString());
            Assert.Equal("{{Back}}", templates[1].GetProperty("qfmt").GetString());
            Assert.Equal("{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}", templates[1].GetProperty("afmt").GetString());
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task ExportThenImport_BasicAndReverse_ComesBackAsOneFactKeepingEachCardsScheduleAndFlag()
    {
        var apkg = NewPackagePath();
        var due = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero);
        try
        {
            await using (var h = await OpenAsync())
            {
                var saved = await h.FactService.SaveFactAsync(ReverseDraft());
                var recognition = saved.Cards.Single(c => c.LayoutKey == FlashcardCardType.RecognitionLayoutId);
                var recall = saved.Cards.Single(c => c.LayoutKey == FlashcardCardType.RecallLayoutId);
                await SetScheduleAsync(h, Review(recognition.Id, due.AddDays(10), reps: 4));
                await SetScheduleAsync(h, Review(recall.Id, due.AddDays(40), reps: 9));
                await NewCards(h).SetFlaggedAsync([recall.Id], flagged: true);

                var export = await NewAdapter(h).ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            var views = await ImportAsync(apkg);
            Assert.Equal(2, views.Count);
            var factId = Assert.Single(views.Select(v => v.Card.FactId).Distinct());
            Assert.NotNull(factId);

            var byLayout = views.ToDictionary(v => v.Card.LayoutKey!, StringComparer.Ordinal);
            var recognitionBack = byLayout[FlashcardCardType.RecognitionLayoutId];
            var recallBack = byLayout[FlashcardCardType.RecallLayoutId];
            Assert.Equal("perro", recognitionBack.Card.Front);
            Assert.Equal("dog", recallBack.Card.Front);
            Assert.Equal(4, recognitionBack.Schedule.Reps);
            Assert.Equal(9, recallBack.Schedule.Reps);
            Assert.Equal(FlashcardFsrsState.Review, recallBack.Schedule.FsrsState);
            Assert.False(recognitionBack.Card.IsFlagged);
            Assert.True(recallBack.Card.IsFlagged);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_NoteOfAnkisBasicAndReversedType_LandsAsOneFactWithBothCards()
    {
        var due = (int)Math.Ceiling((DateTimeOffset.UtcNow - AnkiPackageFixture.CollectionCreatedAt).TotalDays) + 20;
        var note = new AnkiFixtureCard(
            "Spanish", "gato", "cat", Tags: " animals ", NoteType: ReversedType,
            CardRows:
            [
                new AnkiFixtureCardRow(0, new AnkiFixtureScheduling(Type: 2, Queue: 2, Due: due, Interval: 12, Reps: 5, Lapses: 1)),
                new AnkiFixtureCardRow(1, new AnkiFixtureScheduling(Type: 2, Queue: -1, Due: due, Interval: 30, Reps: 7), Flags: 1),
            ]);

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, [note], new Dictionary<string, byte[]>());
        try
        {
            var views = await ImportAsync(apkg, async (h, factId) =>
            {
                var fact = await h.FactService.GetFactAsync(factId);
                Assert.NotNull(fact);
                Assert.Equal(FlashcardCardType.BasicReverseId, fact.TypeId);
                Assert.Equal("gato", fact.Value(FlashcardCardType.BasicFrontFieldId));
                Assert.Equal("cat", fact.Value(FlashcardCardType.BasicBackFieldId));
                Assert.Equal(new[] { "animals" }, fact.Tags.ToArray());
            });

            var byLayout = views.ToDictionary(v => v.Card.LayoutKey!, StringComparer.Ordinal);
            Assert.Equal(2, byLayout.Count);
            Assert.Equal("gato", byLayout[FlashcardCardType.RecognitionLayoutId].Card.Front);
            Assert.Equal("cat", byLayout[FlashcardCardType.RecallLayoutId].Card.Front);
            Assert.Equal(5, byLayout[FlashcardCardType.RecognitionLayoutId].Schedule.Reps);
            Assert.Equal(7, byLayout[FlashcardCardType.RecallLayoutId].Schedule.Reps);
            Assert.Equal(FlashcardCardState.Suspended, byLayout[FlashcardCardType.RecallLayoutId].Card.State);
            Assert.True(byLayout[FlashcardCardType.RecallLayoutId].Card.IsFlagged);
            Assert.False(byLayout[FlashcardCardType.RecognitionLayoutId].Card.IsFlagged);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_PairSplitAcrossTwoDecks_LeavesEachCardInItsOwnDeck()
    {
        var note = new AnkiFixtureCard(
            "Spanish", "gato", "cat", NoteType: ReversedType,
            CardRows: [new AnkiFixtureCardRow(0), new AnkiFixtureCardRow(1, DeckName: "Review")]);

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, [note], new Dictionary<string, byte[]>());
        try
        {
            await using var target = new FlashcardStoreHarness(Now);
            await target.Store.InitializeAsync();
            var library = NewLibrary(target);
            var cards = NewCards(target);
            var import = await NewAdapter(target, library, cards).ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var landed = new List<string>();
            foreach (var deck in await library.ListDecksAsync())
            {
                var views = (await cards.ListCardsAsync(new FlashcardCardQuery(deck.Id))).Items;
                landed.AddRange(views.Select(v => $"{deck.Name}: {v.Card.Front}"));
            }

            Assert.Equal(new[] { "Review: cat", "Spanish: gato" }, landed.Order(StringComparer.Ordinal).ToArray());
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Theory]
    [InlineData(0, "gato")]
    [InlineData(1, "cat")]
    public async Task Import_PairWithOneCardInThePackage_LandsAsThatOneCardOnly(int ord, string front)
    {
        var note = new AnkiFixtureCard("Spanish", "gato", "cat", NoteType: ReversedType, CardRows: [new AnkiFixtureCardRow(ord)]);

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, [note], new Dictionary<string, byte[]>());
        try
        {
            var view = Assert.Single(await ImportAsync(apkg, async (h, factId) =>
            {
                var fact = await h.FactService.GetFactAsync(factId);
                Assert.NotNull(fact);
                Assert.NotEqual(FlashcardCardType.BasicReverseId, fact.TypeId);
            }));
            Assert.Equal(front, view.Card.Front);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    /// <summary>Imports into a clean profile and returns every card that landed in its one deck.</summary>
    private static async Task<IReadOnlyList<FlashcardView>> ImportAsync(
        string apkg, Func<FlashcardStoreHarness, string, Task>? inspectFact = null)
    {
        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        var library = NewLibrary(target);
        var cards = NewCards(target);
        var import = await NewAdapter(target, library, cards).ImportAsync(new ImportExportRequest { FilePath = apkg });
        Assert.True(import.Success, import.ErrorMessage);

        var deck = Assert.Single(await library.ListDecksAsync());
        var views = (await cards.ListCardsAsync(new FlashcardCardQuery(deck.Id))).Items;
        var factId = Assert.Single(views.Select(v => v.Card.FactId).Distinct());
        Assert.NotNull(factId);
        if (inspectFact is not null)
            await inspectFact(target, factId!);
        return views;
    }

    private static FlashcardSchedule Review(string cardId, DateTimeOffset due, int reps) =>
        new(cardId, due, Stability: 20d, Difficulty: 5d, Reps: reps, Lapses: 0,
            FlashcardFsrsState.Review, LearningStepIndex: 0, LastReviewedAt: due.AddDays(-10));

    private static Task SetScheduleAsync(FlashcardStoreHarness harness, FlashcardSchedule schedule) =>
        harness.Store.WriteAsync((connection, transaction, cancellationToken) =>
            harness.Schedules.UpsertAsync(connection, transaction, schedule, cancellationToken));

    private static FlashcardFactDraft ReverseDraft() =>
        new(
            null,
            "deck-1",
            FlashcardCardType.BasicReverseId,
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [FlashcardCardType.BasicFrontFieldId] = "perro",
                [FlashcardCardType.BasicBackFieldId] = "dog",
            },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal),
            []);

    private static string NewPackagePath() => Path.Combine(Path.GetTempPath(), $"mnemo_anki_reverse_{Guid.NewGuid():N}.apkg");

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
            h.Clock, new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));
}
