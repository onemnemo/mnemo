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
/// Covers exporting cards to an Anki package and reading the result back into a clean profile.
/// Card images live as attachments, so an export that looks anywhere else ships a deck of bare text.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiExportTests
{
    [Fact]
    public async Task ExportThenImport_CarriesAStudiedSuspendedScheduleAndMemory()
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_schedule_{Guid.NewGuid():N}.apkg");
        var due = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero).AddDays(30);

        try
        {
            await using (var source = new FlashcardStoreHarness())
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);
                var adapter = NewAdapter(source, library, cards);
                var sourceDeck = await library.CreateDeckAsync("Physiology");
                var card = Assert.Single(await cards.CreateCardsAsync(sourceDeck.Id,
                [
                    new FlashcardCardDraft(
                        sourceDeck.Id,
                        FlashcardType.Classic,
                        "Action potential",
                        "Depolarisation",
                        Array.Empty<string>(),
                        Array.Empty<FlashcardAttachment>()),
                ]));

                await SetScheduleAsync(source, new FlashcardSchedule(
                    card.Id,
                    due,
                    Stability: 123.45678d,
                    Difficulty: 6.1236d,
                    Reps: 14,
                    Lapses: 3,
                    FlashcardFsrsState.Review,
                    LearningStepIndex: 0,
                    LastReviewedAt: due.AddDays(-45)));
                await cards.SetSuspendedAsync([card.Id], suspended: true);

                var export = await adapter.ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            var contents = await AnkiPackageInspector.ReadAsync(apkg);
            var packageCard = Assert.Single(contents.Cards);
            var collectionCreatedAt = DateTimeOffset.FromUnixTimeSeconds(contents.CollectionCreatedAtUnixSeconds);

            Assert.Equal(2, packageCard.Type);
            Assert.Equal(-1, packageCard.Queue);
            Assert.Equal((long)Math.Round((due - collectionCreatedAt).TotalDays), packageCard.Due);
            Assert.Equal(45, packageCard.Interval);
            Assert.Equal(2500, packageCard.Factor);
            Assert.Equal(14, packageCard.Reps);
            Assert.Equal(3, packageCard.Lapses);
            Assert.Equal("{\"s\":123.4568,\"d\":6.124}", packageCard.Data);

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);
            var import = await NewAdapter(target, targetLibrary, targetCards)
                .ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
            var imported = Assert.Single((await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id))).Items);
            Assert.Equal(FlashcardCardState.Suspended, imported.Card.State);
            Assert.Equal(FlashcardFsrsState.Review, imported.Schedule.FsrsState);
            Assert.Equal(collectionCreatedAt.AddDays(packageCard.Due), imported.Schedule.DueDate);
            Assert.Equal(45d, (imported.Schedule.DueDate - imported.Schedule.LastReviewedAt!.Value).TotalDays);
            Assert.Equal(14, imported.Schedule.Reps);
            Assert.Equal(3, imported.Schedule.Lapses);
            Assert.Equal(123.4568d, imported.Schedule.Stability);
            Assert.Equal(6.124d, imported.Schedule.Difficulty);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-10)]
    public async Task ExportThenImport_CarriesReviewDatesAtOrBeforeTheCollectionEpoch(int dueOffsetDays)
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_overdue_{Guid.NewGuid():N}.apkg");
        // A fixed zone without daylight saving keeps whole-day arithmetic exact all year round.
        var zone = TimeZoneInfo.CreateCustomTimeZone("Export+2", TimeSpan.FromHours(2), "Export+2", "Export+2");
        var now = DateTimeOffset.UtcNow;

        try
        {
            DateTimeOffset due;
            DateTimeOffset lastReviewedAt;
            await using (var source = new FlashcardStoreHarness(now, zone))
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);
                var adapter = NewAdapter(source, library, cards);
                var deck = await library.CreateDeckAsync("Overdue");
                var card = Assert.Single(await cards.CreateCardsAsync(deck.Id, [Draft(deck.Id, "Front")]));
                due = source.Clock.DueAfterDays(now, dueOffsetDays, FlashcardPreset.DefaultNextDayStartsAtHour);
                lastReviewedAt = due.AddDays(-30);

                await SetScheduleAsync(source, new FlashcardSchedule(
                    card.Id,
                    due,
                    Stability: 30d,
                    Difficulty: 5d,
                    Reps: 8,
                    Lapses: 1,
                    FlashcardFsrsState.Review,
                    LearningStepIndex: 0,
                    lastReviewedAt));

                var export = await adapter.ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            var contents = await AnkiPackageInspector.ReadAsync(apkg);
            var packageCard = Assert.Single(contents.Cards);
            var collectionCreatedAt = DateTimeOffset.FromUnixTimeSeconds(contents.CollectionCreatedAtUnixSeconds);
            Assert.True(packageCard.Due <= 0);
            Assert.Equal(due, collectionCreatedAt.AddDays(packageCard.Due));

            await using var target = new FlashcardStoreHarness(now, zone);
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);
            var import = await NewAdapter(target, targetLibrary, targetCards)
                .ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
            var imported = Assert.Single((await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id))).Items);
            Assert.Equal(due, imported.Schedule.DueDate);
            Assert.Equal(lastReviewedAt, imported.Schedule.LastReviewedAt);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task ExportThenImport_KeepsReviewDaysWhenTheStudyDayStartsFarFromUtcMidnight()
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_daystart_{Guid.NewGuid():N}.apkg");
        // Eight hours behind UTC puts a four o'clock study-day start twelve hours past UTC midnight,
        // which is where a UTC epoch rounded every review card a day late.
        var zone = TimeZoneInfo.CreateCustomTimeZone("Export-8", TimeSpan.FromHours(-8), "Export-8", "Export-8");
        var now = DateTimeOffset.UtcNow;
        var dayStartHour = FlashcardPreset.DefaultNextDayStartsAtHour;

        try
        {
            DateTimeOffset due;
            await using (var source = new FlashcardStoreHarness(now, zone))
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);
                var adapter = NewAdapter(source, library, cards);
                var deck = await library.CreateDeckAsync("Physiology");
                var card = Assert.Single(await cards.CreateCardsAsync(deck.Id, [Draft(deck.Id, "Front")]));
                due = source.Clock.DueAfterDays(now, 20, dayStartHour);
                await SetScheduleAsync(source, new FlashcardSchedule(
                    card.Id, due, 20d, 5d, 4, 0, FlashcardFsrsState.Review, 0, due.AddDays(-20)));

                var export = await adapter.ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            var contents = await AnkiPackageInspector.ReadAsync(apkg);
            var packageCard = Assert.Single(contents.Cards);
            Assert.Equal(20L, packageCard.Due);

            await using var target = new FlashcardStoreHarness(now, zone);
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);
            var import = await NewAdapter(target, targetLibrary, targetCards)
                .ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
            var imported = Assert.Single((await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id))).Items);
            Assert.Equal(due, imported.Schedule.DueDate);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Export_WritesEachSchedulePhaseWithItsAnkiTypeAndDueShape()
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_phases_{Guid.NewGuid():N}.apkg");
        var now = DateTimeOffset.UtcNow;

        try
        {
            await using var source = new FlashcardStoreHarness(now);
            await source.Store.InitializeAsync();
            var library = NewLibrary(source);
            var cards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);
            var adapter = NewAdapter(source, library, cards);
            var deck = await library.CreateDeckAsync("Phases");
            var created = await cards.CreateCardsAsync(deck.Id,
            [
                Draft(deck.Id, "New"),
                Draft(deck.Id, "Learning"),
                Draft(deck.Id, "Review"),
                Draft(deck.Id, "Relearning"),
            ]);
            var byFront = created.ToDictionary(card => card.Front, StringComparer.Ordinal);

            await SetScheduleAsync(source, new FlashcardSchedule(
                byFront["Learning"].Id, now.AddMinutes(10), 2d, 5d, 1, 0,
                FlashcardFsrsState.Learning, 1, now));
            await SetScheduleAsync(source, new FlashcardSchedule(
                byFront["Review"].Id, now.AddDays(20), 20d, 5d, 4, 0,
                FlashcardFsrsState.Review, 0, now, BuriedUntil: now.AddDays(1)));
            await SetScheduleAsync(source, new FlashcardSchedule(
                byFront["Relearning"].Id, now.AddMinutes(15), 3d, 6d, 5, 2,
                FlashcardFsrsState.Relearning, 0, now));

            var export = await adapter.ExportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(export.Success, export.ErrorMessage);

            var contents = await AnkiPackageInspector.ReadAsync(apkg);
            var notesById = contents.Notes.ToDictionary(note => note.Id);
            var rows = contents.Cards.ToDictionary(row => notesById[row.NoteId].Fields[0], StringComparer.Ordinal);

            Assert.Equal((0, 0, 0L), (rows["New"].Type, rows["New"].Queue, rows["New"].Due));
            Assert.Equal((0, 0, 0, ""), (rows["New"].Interval, rows["New"].Reps, rows["New"].Lapses, rows["New"].Data));

            Assert.Equal((1, 1), (rows["Learning"].Type, rows["Learning"].Queue));
            Assert.Equal(now.AddMinutes(10).ToUnixTimeSeconds(), rows["Learning"].Due);
            Assert.Equal((1, 1, 0), (rows["Learning"].Interval, rows["Learning"].Reps, rows["Learning"].Lapses));
            Assert.Equal("{\"s\":2.0000,\"d\":5.000}", rows["Learning"].Data);

            // Burial is a same-day pause, so the buried review card ships in the review queue rather
            // than in one of Anki's buried queues; it is due again the day the package is opened.
            Assert.Equal((2, 2), (rows["Review"].Type, rows["Review"].Queue));
            Assert.True(rows["Review"].Due < 1_000_000_000L);
            Assert.Equal((20, 4, 0), (rows["Review"].Interval, rows["Review"].Reps, rows["Review"].Lapses));
            Assert.Equal("{\"s\":20.0000,\"d\":5.000}", rows["Review"].Data);

            Assert.Equal((3, 1), (rows["Relearning"].Type, rows["Relearning"].Queue));
            Assert.Equal(now.AddMinutes(15).ToUnixTimeSeconds(), rows["Relearning"].Due);
            Assert.Equal((1, 5, 2), (rows["Relearning"].Interval, rows["Relearning"].Reps, rows["Relearning"].Lapses));
            Assert.Equal("{\"s\":3.0000,\"d\":6.000}", rows["Relearning"].Data);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task ExportThenImport_CarriesImagesOnBothSides()
    {
        var assets = NewAssetDirectory();
        var frontImage = Path.Combine(assets, "front.png");
        var backImage = Path.Combine(assets, "back.jpg");
        await File.WriteAllBytesAsync(frontImage, PngBytes());
        await File.WriteAllBytesAsync(backImage, JpegBytes());

        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_export_{Guid.NewGuid():N}.apkg");

        try
        {
            await using (var source = new FlashcardStoreHarness())
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);
                var adapter = NewAdapter(source, library, cards);

                var deck = await library.CreateDeckAsync("Histology");
                await cards.CreateCardsAsync(deck.Id, new[]
                {
                    new FlashcardCardDraft(
                        deck.Id, FlashcardType.Classic, "Identify", "Epithelium", Array.Empty<string>(),
                        new[]
                        {
                            Attachment(FlashcardAttachment.FrontSide, frontImage, "front.png"),
                            Attachment(FlashcardAttachment.BackSide, backImage, "back.jpg"),
                        }),
                });

                var export = await adapter.ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);
            var targetAdapter = NewAdapter(target, targetLibrary, targetCards);

            var import = await targetAdapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
            var page = await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id));
            var card = Assert.Single(page.Items).Card;

            Assert.Equal(2, card.Attachments.Count);
            var front = Assert.Single(card.Attachments, a => a.Side == FlashcardAttachment.FrontSide);
            var back = Assert.Single(card.Attachments, a => a.Side == FlashcardAttachment.BackSide);
            Assert.Equal(PngBytes(), await File.ReadAllBytesAsync(front.FilePath));
            Assert.Equal(JpegBytes(), await File.ReadAllBytesAsync(back.FilePath));

            DeleteAll(card.Attachments);
        }
        finally
        {
            File.Delete(apkg);
            try { Directory.Delete(assets, recursive: true); } catch (IOException) { }
        }
    }

    [Fact]
    public async Task ExportThenImport_TwoImagesWithTheSameName_StayDistinct()
    {
        var assets = NewAssetDirectory();
        var firstDirectory = Path.Combine(assets, "one");
        var secondDirectory = Path.Combine(assets, "two");
        Directory.CreateDirectory(firstDirectory);
        Directory.CreateDirectory(secondDirectory);

        // Same filename, different pictures, which is what happens as soon as two cards get their
        // images from two different places.
        var first = Path.Combine(firstDirectory, "diagram.png");
        var second = Path.Combine(secondDirectory, "diagram.png");
        await File.WriteAllBytesAsync(first, PngBytes());
        await File.WriteAllBytesAsync(second, JpegBytes());

        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_export_{Guid.NewGuid():N}.apkg");

        try
        {
            await using (var source = new FlashcardStoreHarness())
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);
                var adapter = NewAdapter(source, library, cards);

                var deck = await library.CreateDeckAsync("Collisions");
                await cards.CreateCardsAsync(deck.Id, new[]
                {
                    new FlashcardCardDraft(
                        deck.Id, FlashcardType.Classic, "first", "a", Array.Empty<string>(),
                        new[] { Attachment(FlashcardAttachment.FrontSide, first, "diagram.png") }),
                    new FlashcardCardDraft(
                        deck.Id, FlashcardType.Classic, "second", "b", Array.Empty<string>(),
                        new[] { Attachment(FlashcardAttachment.FrontSide, second, "diagram.png") }),
                });

                var export = await adapter.ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);
            var targetAdapter = NewAdapter(target, targetLibrary, targetCards);

            var import = await targetAdapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
            var page = await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id));
            var byFront = page.Items.ToDictionary(v => v.Card.Front, v => v.Card, StringComparer.Ordinal);

            var firstAttachment = Assert.Single(byFront["first"].Attachments);
            var secondAttachment = Assert.Single(byFront["second"].Attachments);

            // Keyed by filename alone the second card resolves to the first card's picture, and the
            // deck ships showing the wrong image with nothing to hint at it.
            Assert.Equal(PngBytes(), await File.ReadAllBytesAsync(firstAttachment.FilePath));
            Assert.Equal(JpegBytes(), await File.ReadAllBytesAsync(secondAttachment.FilePath));

            DeleteAll(byFront["first"].Attachments);
            DeleteAll(byFront["second"].Attachments);
        }
        finally
        {
            File.Delete(apkg);
            try { Directory.Delete(assets, recursive: true); } catch (IOException) { }
        }
    }

    private static FlashcardAttachment Attachment(string side, string path, string displayName) =>
        new(Guid.NewGuid().ToString("N"), side, path, displayName, new FileInfo(path).Length, null);

    private static FlashcardCardDraft Draft(string deckId, string front) =>
        new(
            deckId,
            FlashcardType.Classic,
            front,
            "Back",
            Array.Empty<string>(),
            Array.Empty<FlashcardAttachment>());

    private static Task SetScheduleAsync(FlashcardStoreHarness harness, FlashcardSchedule schedule) =>
        harness.Store.WriteAsync((connection, transaction, cancellationToken) =>
            harness.Schedules.UpsertAsync(connection, transaction, schedule, cancellationToken));

    private static string NewAssetDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"mnemo_anki_assets_{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        return directory;
    }

    private static void DeleteAll(IReadOnlyList<FlashcardAttachment> attachments)
    {
        foreach (var attachment in attachments)
        {
            try { File.Delete(attachment.FilePath); } catch (IOException) { }
        }
    }

    private static FlashcardsAnkiFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        FlashcardCardService cardSvc) =>
        new(library, cardSvc, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            h.Clock, new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    private static byte[] PngBytes() => Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    private static byte[] JpegBytes() => Convert.FromBase64String(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==");
}
