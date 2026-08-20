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
/// A cloze note is one piece of material that makes one card per deletion. Importing it as a card
/// per row instead cost the collection everything material is for: every sibling showed the same
/// deletion, and answering one held none of the others back.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiClozeImportTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    private const string ClozeText = "{{c1::Lidocaine}} is class {{c2::Ib}} and blocks {{c3::sodium}} channels";

    private static readonly AnkiFixtureNoteType ClozeNoteType = new(
        Id: 1700000000001L,
        Name: "Cloze",
        FieldNames: ["Text", "Extra"],
        Templates: [new AnkiFixtureTemplate("Cloze", "{{cloze:Text}}", "{{cloze:Text}}<br>{{Extra}}")],
        IsCloze: true);

    /// <summary>Days from the fixture collection's creation to a date comfortably in the future.</summary>
    private static int DaysToFuture(int extraDays) =>
        (int)Math.Ceiling((DateTimeOffset.UtcNow - AnkiPackageFixture.CollectionCreatedAt).TotalDays) + extraDays;

    [Fact]
    public async Task Import_MultiDeletionNote_MakesOneCardPerDeletionOffOnePieceOfMaterial()
    {
        var apkg = await WriteAsync(ClozeNote("Pharmacology", ClozeText, "Shortens repolarisation.", Rows(0, 1, 2)));
        try
        {
            await using var world = await ImportAsync(apkg);

            var cards = world.Cards.OrderBy(c => c.LayoutKey, StringComparer.Ordinal).ToArray();
            Assert.Equal(new[] { "c1", "c2", "c3" }, cards.Select(c => c.LayoutKey).ToArray());

            // One fact behind all three is what makes them siblings: it is what the editor opens,
            // what burying acts on, and what a later edit regenerates every one of them from.
            var factId = Assert.Single(cards.Select(c => c.FactId).Distinct(StringComparer.Ordinal));
            Assert.NotNull(factId);

            var fact = await world.Facts.GetFactAsync(factId!);
            Assert.NotNull(fact);
            Assert.Equal(FlashcardCardType.ClozeId, fact.TypeId);
            Assert.Equal(ClozeText, fact.Value(FlashcardCardType.ClozeTextFieldId));
            Assert.Equal("Shortens repolarisation.", fact.Value(FlashcardCardType.ClozeExtraFieldId));

            // Each card hides its own deletion and shows the others, which is the context that makes
            // the question answerable. Three cards reading the same way is the defect this covers.
            Assert.Equal("[…] is class Ib and blocks sodium channels", cards[0].Front);
            Assert.Equal("Lidocaine is class […] and blocks sodium channels", cards[1].Front);
            Assert.Equal("Lidocaine is class Ib and blocks […] channels", cards[2].Front);
            Assert.Equal(3, cards.Select(c => c.Front).Distinct(StringComparer.Ordinal).Count());

            foreach (var card in cards)
            {
                Assert.Equal(FlashcardType.Cloze, card.Type);
                Assert.Equal(
                    "Lidocaine is class Ib and blocks sodium channels\n\nShortens repolarisation.", card.Back);
            }
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_MultiDeletionNote_GivesEachCardTheHistoryItsOwnRowCarried()
    {
        // Three deletions studied to three different points. Handing them one schedule between them,
        // or resetting them all, is what carrying a history across is meant to avoid.
        var first = DaysToFuture(10);
        var second = DaysToFuture(40);
        var third = DaysToFuture(90);
        var apkg = await WriteAsync(ClozeNote("Pharmacology", ClozeText, "Extra",
        [
            new AnkiFixtureCardRow(0, new AnkiFixtureScheduling(Type: 2, Queue: 2, Due: first, Interval: 8, Reps: 4, Lapses: 1)),
            new AnkiFixtureCardRow(1, new AnkiFixtureScheduling(Type: 2, Queue: 2, Due: second, Interval: 30, Reps: 9, Lapses: 2)),
            new AnkiFixtureCardRow(2, new AnkiFixtureScheduling(Type: 2, Queue: -1, Due: third, Interval: 60, Reps: 12, Lapses: 3)),
        ]));

        try
        {
            await using var world = await ImportAsync(apkg);
            var views = world.Views.ToDictionary(v => v.Card.LayoutKey!, StringComparer.Ordinal);

            Assert.Equal(AnkiPackageFixture.CollectionCreatedAt.AddDays(first), views["c1"].Schedule.DueDate);
            Assert.Equal(AnkiPackageFixture.CollectionCreatedAt.AddDays(second), views["c2"].Schedule.DueDate);
            Assert.Equal(AnkiPackageFixture.CollectionCreatedAt.AddDays(third), views["c3"].Schedule.DueDate);

            Assert.Equal(new[] { 4, 9, 12 }, new[] { "c1", "c2", "c3" }.Select(k => views[k].Schedule.Reps).ToArray());
            Assert.Equal(new[] { 1, 2, 3 }, new[] { "c1", "c2", "c3" }.Select(k => views[k].Schedule.Lapses).ToArray());

            // Suspension is per card in the other app too, and silently un-suspending puts a card
            // somebody deliberately set aside back in the queue.
            Assert.Equal(FlashcardCardState.Active, views["c1"].Card.State);
            Assert.Equal(FlashcardCardState.Active, views["c2"].Card.State);
            Assert.Equal(FlashcardCardState.Suspended, views["c3"].Card.State);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_DeletionThePackageHadNoCardFor_StartsNewRatherThanBorrowingASiblingsSchedule()
    {
        // Anki lost the row for the second deletion. The card the text still asks for is made, and
        // it starts new rather than inheriting whichever sibling happened to sit next to it.
        var due = DaysToFuture(30);
        var apkg = await WriteAsync(ClozeNote("Pharmacology", ClozeText, "Extra",
        [
            new AnkiFixtureCardRow(0, new AnkiFixtureScheduling(Type: 2, Queue: 2, Due: due, Interval: 20, Reps: 7)),
            new AnkiFixtureCardRow(2, new AnkiFixtureScheduling(Type: 2, Queue: 2, Due: due, Interval: 20, Reps: 7)),
        ]));

        try
        {
            await using var world = await ImportAsync(apkg);
            var views = world.Views.ToDictionary(v => v.Card.LayoutKey!, StringComparer.Ordinal);

            Assert.Equal(3, views.Count);
            Assert.Equal(FlashcardFsrsState.Review, views["c1"].Schedule.FsrsState);
            Assert.Equal(FlashcardFsrsState.New, views["c2"].Schedule.FsrsState);
            Assert.Equal(0, views["c2"].Schedule.Reps);
            Assert.Equal(FlashcardFsrsState.Review, views["c3"].Schedule.FsrsState);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_ClozeSiblings_HoldEachOtherBackWhenOneIsAnswered()
    {
        var apkg = await WriteAsync(ClozeNote("Pharmacology", ClozeText, "Extra", Rows(0, 1, 2)));
        try
        {
            await using var world = await ImportAsync(apkg);

            var session = await world.Study.StartSessionAsync(
                new FlashcardSessionRequest(world.DeckId, FlashcardSessionMode.Review));
            Assert.Equal(3, session.Progress.Total);

            await session.GradeAsync(FlashcardReviewGrade.Easy);

            // Sharing one piece of material is exactly what lets this happen. Under a fact per card
            // the run carried on through two more views of the same sentence.
            Assert.True(session.IsFinished);
            Assert.Equal(1, session.Progress.Total);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_ClozeNoteWithNoDeletionInIt_StillLandsAsACard()
    {
        // A note type says cloze, the text says nothing of the kind. Losing the card to a
        // classification nobody typed is not an acceptable outcome of an import.
        var apkg = await WriteAsync(ClozeNote("Pharmacology", "Nothing is deleted here", "Extra", Rows(0)));
        try
        {
            await using var world = await ImportAsync(apkg);

            var card = Assert.Single(world.Cards);
            Assert.Equal("Nothing is deleted here", card.Front);
            Assert.Equal(FlashcardCardType.RecognitionLayoutId, card.LayoutKey);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_SiblingsSpreadOverTwoDecks_KeepsTheNoteWholeAndSaysSo()
    {
        var cards = new[]
        {
            ClozeNote("Pharmacology", ClozeText, "Extra",
            [
                new AnkiFixtureCardRow(0),
                new AnkiFixtureCardRow(1),
                new AnkiFixtureCardRow(2, DeckName: "Overflow"),
            ]),
        };

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, cards, new Dictionary<string, byte[]>());
        try
        {
            await using var h = new FlashcardStoreHarness(Now);
            await h.Store.InitializeAsync();
            var library = NewLibrary(h);
            var cardService = NewCards(h);

            var result = await NewAdapter(h, library, cardService)
                .ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(result.Success, result.ErrorMessage);

            // Material cannot be split, so the whole note goes to the deck holding most of it. The
            // deck that lost a card is left with none rather than with a second copy of the note.
            var deck = Assert.Single(await library.ListDecksAsync());
            Assert.Equal("Pharmacology", deck.Name);

            var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            Assert.Equal(3, page.Items.Count);
            Assert.Contains(result.Warnings, w => w.Key == "AnkiClozeSiblingsFiledTogether");
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_NoteWhoseRowsAreTemplates_IsLeftExactlyAsItWas()
    {
        // The reversed pair is what a cloze note is not: its rows name templates, so each one keeps
        // standing for itself, with its own material, exactly as before.
        var reversed = new AnkiFixtureNoteType(
            Id: 1700000000002L,
            Name: "Basic (and reversed card)",
            FieldNames: ["Front", "Back"],
            Templates:
            [
                new AnkiFixtureTemplate("Card 1", "{{Front}}", "{{FrontSide}}{{Back}}"),
                new AnkiFixtureTemplate("Card 2", "{{Back}}", "{{FrontSide}}{{Front}}"),
            ]);

        var cards = new[] { new AnkiFixtureCard("Vocabulary", "Ephemeral", "Short lived", NoteType: reversed) };
        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, cards, new Dictionary<string, byte[]>());
        try
        {
            await using var world = await ImportAsync(apkg);

            Assert.Equal(2, world.Cards.Count);
            Assert.Equal(
                new[] { "Ephemeral", "Short lived" },
                world.Cards.Select(c => c.Front).OrderBy(f => f, StringComparer.Ordinal).ToArray());

            // Each row still gets material of its own, which is the shape every non cloze import has
            // always had and the shape a card written side by side gets everywhere else.
            var factIds = world.Cards.Select(c => c.FactId).Distinct(StringComparer.Ordinal).ToArray();
            Assert.Equal(2, factIds.Length);
            Assert.All(world.Cards, c => Assert.Equal(FlashcardType.Classic, c.Type));
            Assert.All(world.Cards, c => Assert.Equal(FlashcardCardType.RecognitionLayoutId, c.LayoutKey));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    // --- helpers ---

    private static AnkiFixtureCard ClozeNote(
        string deckName, string text, string extra, IReadOnlyList<AnkiFixtureCardRow> rows) =>
        new(deckName, text, extra, NoteType: ClozeNoteType, CardRows: rows);

    private static AnkiFixtureCardRow[] Rows(params int[] ordinals) =>
        [.. ordinals.Select(ord => new AnkiFixtureCardRow(ord))];

    private static Task<string> WriteAsync(AnkiFixtureCard note) =>
        AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, [note], new Dictionary<string, byte[]>());

    /// <summary>An imported package, with the services that read what it landed.</summary>
    private sealed class ImportedWorld : IAsyncDisposable
    {
        public required FlashcardStoreHarness Harness { get; init; }
        public required string DeckId { get; init; }
        public required IReadOnlyList<FlashcardView> Views { get; init; }
        public required FlashcardStudyService Study { get; init; }

        public IReadOnlyList<Flashcard> Cards => [.. Views.Select(v => v.Card)];

        public FlashcardFactService Facts => Harness.FactService;

        public ValueTask DisposeAsync() => Harness.DisposeAsync();
    }

    private static async Task<ImportedWorld> ImportAsync(string apkg)
    {
        var h = new FlashcardStoreHarness(Now);
        try
        {
            await h.Store.InitializeAsync();
            var library = NewLibrary(h);
            var cardService = NewCards(h);

            var result = await NewAdapter(h, library, cardService)
                .ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(result.Success, result.ErrorMessage);

            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));

            return new ImportedWorld
            {
                Harness = h,
                DeckId = deck.Id,
                Views = page.Items,
                Study = new FlashcardStudyService(
                    h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, h.Facts,
                    new FsrsScheduler(h.Clock), h.Clock),
            };
        }
        catch
        {
            await h.DisposeAsync();
            throw;
        }
    }

    private static FlashcardCardService NewCards(FlashcardStoreHarness h) =>
        new(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

    private static FlashcardsAnkiFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        FlashcardCardService cardSvc) =>
        new(library, cardSvc, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService());

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
}
