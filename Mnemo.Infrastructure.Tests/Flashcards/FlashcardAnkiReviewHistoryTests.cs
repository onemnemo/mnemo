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
/// A collection's review history is the part of it that took years to build, and until now leaving
/// or arriving cost all of it. These cover it crossing in both directions: the answers land as real
/// review rows, marked with where they came from, attached to the card that was actually answered,
/// and they go back out again in a package another app can read.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiReviewHistoryTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    /// <summary>Anki's revlog type for an answer given from the learning queue.</summary>
    private const int Learn = 0;

    /// <summary>Anki's revlog type for an answer given from the review queue.</summary>
    private const int Review = 1;

    /// <summary>Anki's revlog type for an answer given inside a filtered deck, which is its cram.</summary>
    private const int Filtered = 3;

    /// <summary>Anki's revlog type for a reschedule somebody did by hand.</summary>
    private const int Manual = 4;

    private const string ClozeText = "{{c1::Lidocaine}} is class {{c2::Ib}} and blocks {{c3::sodium}} channels";

    private static readonly AnkiFixtureNoteType ClozeNoteType = new(
        Id: 1700000000001L,
        Name: "Cloze",
        FieldNames: ["Text", "Extra"],
        Templates: [new AnkiFixtureTemplate("Cloze", "{{cloze:Text}}", "{{cloze:Text}}<br>{{Extra}}")],
        IsCloze: true);

    /// <summary>Three answers on one card: learned, remembered, then forgotten.</summary>
    private static IReadOnlyList<AnkiFixtureReview> ThreeAnswers() =>
    [
        new(Now.AddDays(-20), Ease: 3, Interval: 1, LastInterval: 0, Type: Learn),
        new(Now.AddDays(-10), Ease: 3, Interval: 10, LastInterval: 1, Type: Review),
        new(Now.AddDays(-3), Ease: 1, Interval: -600, LastInterval: 10, Type: Review),
    ];

    [Fact]
    public async Task Import_ReviewLog_LandsAsAnsweredRowsMarkedAsHavingComeFromElsewhere()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            [new AnkiFixtureCard("Pharmacology", "Lidocaine", "Class Ib", Reviews: ThreeAnswers())],
            new Dictionary<string, byte[]>());

        try
        {
            await using var world = await ImportAsync(apkg);

            var card = Assert.Single(world.Cards);
            var reviews = await world.HistoryForAsync(card.Id);
            Assert.Equal(3, reviews.Count);

            Assert.Equal(
                new[] { FlashcardReviewGrade.Good, FlashcardReviewGrade.Good, FlashcardReviewGrade.Again },
                reviews.Select(r => r.Grade).ToArray());
            Assert.Equal(
                ThreeAnswers().Select(a => a.At).ToArray(),
                reviews.Select(r => r.ReviewedAt).ToArray());

            // An answer that came from somewhere else says so. Retention and the fit read it exactly
            // like any other, and the marker is what lets analytics separate them later on.
            Assert.All(reviews, r => Assert.Equal(FlashcardReviewOrigin.Imported, r.Origin));

            // One synthetic session for the whole import, so the rows a package brought in can be
            // found together rather than looking like a session somebody sat through.
            var sessionId = Assert.Single(reviews.Select(r => r.SessionId).Distinct(StringComparer.Ordinal));
            Assert.True(FlashcardImportedReviews.IsImportedSession(sessionId));

            // The state an answer ended in comes from the interval it set, and the state it started
            // from is the one before it ended in. The first answer on a card starts from New, which
            // is what lets a fit replay the card at all.
            Assert.Equal(
                new FlashcardFsrsState?[] { FlashcardFsrsState.New, FlashcardFsrsState.Review, FlashcardFsrsState.Review },
                reviews.Select(r => r.StateBefore).ToArray());
            Assert.Equal(
                new[] { FlashcardFsrsState.Review, FlashcardFsrsState.Review, FlashcardFsrsState.Relearning },
                reviews.Select(r => r.StateAfter).ToArray());

            // Both intervals cross as the days they are, whichever of the two units the package
            // spelled them in.
            Assert.Equal(new[] { 0d, 1d, 10d }, reviews.Select(r => r.ElapsedDays).ToArray());
            Assert.Equal(new[] { 1d, 10d, 600d / 86400d }, reviews.Select(r => r.ScheduledDays).ToArray());

            var warning = Assert.Single(world.Warnings, w => w.Key == "AnkiReviewHistoryImported");
            Assert.Equal("3", warning.Params["count"]);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_ClozeNoteHistory_StaysOnTheDeletionThatWasActuallyAnswered()
    {
        // Three deletions of one note, each answered a different number of times. Attaching the
        // history to the note rather than to its rows would hand all of it to one card.
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            [
                new AnkiFixtureCard("Pharmacology", ClozeText, "Shortens repolarisation.", NoteType: ClozeNoteType, CardRows:
                [
                    new AnkiFixtureCardRow(0, Reviews: [new AnkiFixtureReview(Now.AddDays(-9), 3, 5, 0, Learn)]),
                    new AnkiFixtureCardRow(1, Reviews:
                    [
                        new AnkiFixtureReview(Now.AddDays(-8), 3, 2, 0, Learn),
                        new AnkiFixtureReview(Now.AddDays(-6), 2, 4, 2, Review),
                    ]),
                    new AnkiFixtureCardRow(2),
                ]),
            ],
            new Dictionary<string, byte[]>());

        try
        {
            await using var world = await ImportAsync(apkg);
            var byKey = world.Cards.ToDictionary(c => c.LayoutKey!, StringComparer.Ordinal);
            Assert.Equal(3, byKey.Count);

            Assert.Single(await world.HistoryForAsync(byKey["c1"].Id));
            Assert.Equal(2, (await world.HistoryForAsync(byKey["c2"].Id)).Count);

            // The package had no answers for the third deletion, and inventing some from a sibling
            // would be worse than the card starting where it honestly is.
            Assert.Empty(await world.HistoryForAsync(byKey["c3"].Id));

            var second = await world.HistoryForAsync(byKey["c2"].Id);
            Assert.Equal(
                new[] { FlashcardReviewGrade.Good, FlashcardReviewGrade.Hard },
                second.Select(r => r.Grade).ToArray());
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_ReviewLog_CountsTowardsRetentionAndReachesTheOptimizer()
    {
        // The reason to carry a history across at all. A deck that arrives with years of answers and
        // then reports nothing known about it has kept the rows and thrown away their point.
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            [new AnkiFixtureCard("Pharmacology", "Lidocaine", "Class Ib", Reviews: ThreeAnswers())],
            new Dictionary<string, byte[]>());

        try
        {
            await using var world = await ImportAsync(apkg);

            var stats = new FlashcardStatsService(
                world.Harness.Store, world.Harness.Reviews, world.Harness.TestAttempts,
                world.Harness.Decks, world.Harness.Presets, world.Harness.Clock);

            // Two of the three answers were remembered, and none of them was a learning step.
            Assert.Equal(67, await stats.GetTrueRetentionAsync(world.DeckId));

            var optimizer = new FlashcardOptimizerService(
                world.Harness.Store, world.Harness.Presets, world.Harness.Reviews);
            var optimization = await optimizer.OptimizePresetAsync(FlashcardPreset.StandardPresetId);

            Assert.NotNull(optimization);
            Assert.Equal(3, optimization!.ReviewsAvailable);

            // A chain the model can replay, with the two answers a day or more apart scored. Zero
            // here would mean the rows landed somewhere the fit never looks.
            Assert.Equal(2, optimization.ReviewsScored);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_RowsThatAreNotAnswers_AreNotReadAsGradesNobodyGave()
    {
        // Setting a due date by hand is written into the same table with no button pressed, and an
        // answer inside a filtered deck is that app's cram, which is never recorded here either.
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            [
                new AnkiFixtureCard("Pharmacology", "Lidocaine", "Class Ib", Reviews:
                [
                    new AnkiFixtureReview(Now.AddDays(-20), Ease: 3, Interval: 1, Type: Learn),
                    new AnkiFixtureReview(Now.AddDays(-15), Ease: 0, Interval: 30, Type: Manual),
                    new AnkiFixtureReview(Now.AddDays(-12), Ease: 4, Interval: 20, Type: Filtered),
                ]),
            ],
            new Dictionary<string, byte[]>());

        try
        {
            await using var world = await ImportAsync(apkg);

            var card = Assert.Single(world.Cards);
            var review = Assert.Single(await world.HistoryForAsync(card.Id));
            Assert.Equal(Now.AddDays(-20), review.ReviewedAt);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task ExportThenImport_HistorySurvivesTheRoundTrip()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            [
                new AnkiFixtureCard("Pharmacology", "Lidocaine", "Class Ib", Reviews: ThreeAnswers()),
                new AnkiFixtureCard("Pharmacology", "Amiodarone", "Class III", Reviews:
                [
                    new AnkiFixtureReview(Now.AddDays(-4), Ease: 4, Interval: 25, LastInterval: 6, Type: Review),
                ]),
            ],
            new Dictionary<string, byte[]>());

        var written = Path.Combine(Path.GetTempPath(), $"mnemo_anki_history_{Guid.NewGuid():N}.apkg");

        try
        {
            await using (var world = await ImportAsync(apkg))
            {
                var export = await world.Adapter.ExportAsync(new ImportExportRequest { FilePath = written });
                Assert.True(export.Success, export.ErrorMessage);
            }

            // Read the file itself rather than only importing it back: a round trip that checks only
            // itself proves the two halves agree, not that the package is one another app can read.
            var contents = await AnkiPackageInspector.ReadAsync(written);
            Assert.Equal(4, contents.Reviews.Count);
            Assert.Equal(
                ThreeAnswers().Select(a => a.At.ToUnixTimeMilliseconds()).OrderBy(id => id).ToArray(),
                contents.Reviews.Where(r => r.Ease != 4).Select(r => r.Id).OrderBy(id => id).ToArray());

            // The queue an answer came from is written back out as the state it started in, so the
            // learning step does not arrive claiming to have been a scheduled review.
            var learned = Assert.Single(contents.Reviews, r => r.Id == Now.AddDays(-20).ToUnixTimeMilliseconds());
            Assert.Equal(Learn, learned.Type);
            Assert.Equal(1, learned.Interval);

            await using var again = await ImportAsync(written);
            var byFront = again.Cards.ToDictionary(c => c.Front, StringComparer.Ordinal);

            var lidocaine = await again.HistoryForAsync(byFront["Lidocaine"].Id);
            Assert.Equal(
                new[] { FlashcardReviewGrade.Good, FlashcardReviewGrade.Good, FlashcardReviewGrade.Again },
                lidocaine.Select(r => r.Grade).ToArray());
            Assert.Equal(ThreeAnswers().Select(a => a.At).ToArray(), lidocaine.Select(r => r.ReviewedAt).ToArray());
            Assert.Equal(new[] { 1d, 10d, 600d / 86400d }, lidocaine.Select(r => r.ScheduledDays).ToArray());

            var amiodarone = Assert.Single(await again.HistoryForAsync(byFront["Amiodarone"].Id));
            Assert.Equal(FlashcardReviewGrade.Easy, amiodarone.Grade);
            Assert.Equal(Now.AddDays(-4), amiodarone.ReviewedAt);
            Assert.Equal(6d, amiodarone.ElapsedDays);
        }
        finally
        {
            File.Delete(apkg);
            File.Delete(written);
        }
    }

    [Fact]
    public async Task Export_CardTheTrashIsHolding_DoesNotShipItsHistory()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            [
                new AnkiFixtureCard("Pharmacology", "Lidocaine", "Class Ib", Reviews: ThreeAnswers()),
                new AnkiFixtureCard("Pharmacology", "Amiodarone", "Class III", Reviews:
                [
                    new AnkiFixtureReview(Now.AddDays(-4), Ease: 4, Interval: 25, LastInterval: 6, Type: Review),
                ]),
            ],
            new Dictionary<string, byte[]>());

        var written = Path.Combine(Path.GetTempPath(), $"mnemo_anki_held_{Guid.NewGuid():N}.apkg");

        try
        {
            await using (var world = await ImportAsync(apkg))
            {
                var held = Assert.Single(world.Cards, c => c.Front == "Amiodarone");
                await world.HoldAsync(held.Id);

                var export = await world.Adapter.ExportAsync(new ImportExportRequest { FilePath = written });
                Assert.True(export.Success, export.ErrorMessage);
            }

            var contents = await AnkiPackageInspector.ReadAsync(written);

            // A deleted card is not in the package, and neither is anything it was answered with.
            // Its history is kept and comes back with it; a package of the deck must not carry away
            // what somebody deleted.
            Assert.Single(contents.Cards);
            Assert.Equal(3, contents.Reviews.Count);
            Assert.DoesNotContain(contents.Reviews, r => r.Id == Now.AddDays(-4).ToUnixTimeMilliseconds());
        }
        finally
        {
            File.Delete(apkg);
            File.Delete(written);
        }
    }

    // --- helpers ---

    /// <summary>An imported package, with the services that read what it landed.</summary>
    private sealed class ImportedWorld : IAsyncDisposable
    {
        public required FlashcardStoreHarness Harness { get; init; }
        public required string DeckId { get; init; }
        public required IReadOnlyList<Flashcard> Cards { get; init; }
        public required IReadOnlyList<TransferWarning> Warnings { get; init; }
        public required FlashcardsAnkiFormatAdapter Adapter { get; init; }

        public Task<IReadOnlyList<FlashcardReviewLog>> HistoryForAsync(string cardId) =>
            Harness.Store.ReadAsync((conn, ct) => Harness.Reviews.ListForCardsAsync(conn, [cardId], ct));

        /// <summary>
        /// Puts one card in the trash, written the way the trash writes it. The column is the whole
        /// mechanism: a held card keeps its row, its schedule and its history, and simply stops
        /// being part of the library until it is restored.
        /// </summary>
        public Task HoldAsync(string cardId) =>
            Harness.Store.WriteAsync(async (conn, tx, ct) =>
            {
                await using var cmd = conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = "UPDATE FlashcardCards SET TrashId = $trash WHERE Id = $id;";
                cmd.Parameters.AddWithValue("$trash", "trash-entry");
                cmd.Parameters.AddWithValue("$id", cardId);
                await cmd.ExecuteNonQueryAsync(ct);
            });

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
            var adapter = NewAdapter(h, library, cardService);

            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(result.Success, result.ErrorMessage);

            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id, Limit: 200));

            return new ImportedWorld
            {
                Harness = h,
                DeckId = deck.Id,
                Cards = [.. page.Items.Select(v => v.Card)],
                Warnings = result.Warnings,
                Adapter = adapter,
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
            new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
}
