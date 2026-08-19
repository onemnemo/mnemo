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
/// Covers what an import keeps of a card's history. Landing a studied collection as new cards puts
/// every one of them due at once, which is the state a user imports a schedule to avoid.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiSchedulingImportTests
{
    /// <summary>Days from the fixture collection's creation to a date comfortably in the future.</summary>
    private static int DaysToFuture(int extraDays) =>
        (int)Math.Ceiling((DateTimeOffset.UtcNow - AnkiPackageFixture.CollectionCreatedAt).TotalDays) + extraDays;

    [Fact]
    public async Task Import_ReviewCard_KeepsItsDueDateInsteadOfMakingItDueNow()
    {
        var dueInDays = DaysToFuture(30);
        var cards = new[]
        {
            new AnkiFixtureCard("Physiology", "Front", "Back", Scheduling: new AnkiFixtureScheduling(
                Type: 2, Queue: 2, Due: dueInDays, Interval: 45, Reps: 12, Lapses: 3)),
        };

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, cards, new Dictionary<string, byte[]>());
        try
        {
            var (card, schedule) = await ImportSingleAsync(apkg);

            Assert.Equal(FlashcardFsrsState.Review, schedule.FsrsState);
            Assert.Equal(12, schedule.Reps);
            Assert.Equal(3, schedule.Lapses);
            Assert.Equal(FlashcardCardState.Active, card.State);

            var expected = AnkiPackageFixture.CollectionCreatedAt.AddDays(dueInDays);
            Assert.Equal(expected, schedule.DueDate);
            Assert.True(schedule.DueDate > DateTimeOffset.UtcNow.AddDays(20), "the card should still be a month out");

            // The card reached that date by waiting out its interval, so that is when it was answered.
            Assert.Equal(expected.AddDays(-45), schedule.LastReviewedAt);

            // No published mapping turns another algorithm's ease into FSRS memory state, so the
            // first real review is left to cold start rather than being handed invented numbers.
            Assert.Null(schedule.Stability);
            Assert.Null(schedule.Difficulty);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_NewCard_StaysNewAndDueNow()
    {
        // A new card's due column is its place in the queue, not a date. Read as days it would put
        // the card somewhere near the collection's creation, years in the past.
        var cards = new[]
        {
            new AnkiFixtureCard("Physiology", "Front", "Back", Scheduling: new AnkiFixtureScheduling(
                Type: 0, Queue: 0, Due: 137)),
        };

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, cards, new Dictionary<string, byte[]>());
        try
        {
            var (_, schedule) = await ImportSingleAsync(apkg);

            Assert.Equal(FlashcardFsrsState.New, schedule.FsrsState);
            Assert.Null(schedule.LastReviewedAt);
            Assert.True(schedule.DueDate <= DateTimeOffset.UtcNow.AddMinutes(1), "a new card is due now");
            Assert.True(schedule.DueDate > DateTimeOffset.UtcNow.AddMinutes(-5), "a new card is not due in the past");
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_SuspendedCard_ArrivesSuspended()
    {
        var cards = new[]
        {
            new AnkiFixtureCard("Physiology", "Front", "Back", Scheduling: new AnkiFixtureScheduling(
                Type: 2, Queue: -1, Due: DaysToFuture(10), Interval: 20, Reps: 5)),
        };

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, cards, new Dictionary<string, byte[]>());
        try
        {
            var (card, _) = await ImportSingleAsync(apkg);

            // Silently un-suspending puts cards the user deliberately set aside back in the queue.
            Assert.Equal(FlashcardCardState.Suspended, card.State);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_LearningCardDueAtASecond_ReadsTheValueAsATimeNotADayCount()
    {
        // Mid-session cards carry an absolute second where a review card carries whole days. Read as
        // days that number lands tens of thousands of years out.
        var dueAt = DateTimeOffset.UtcNow.AddMinutes(-10).ToUnixTimeSeconds();
        var cards = new[]
        {
            new AnkiFixtureCard("Physiology", "Front", "Back", Scheduling: new AnkiFixtureScheduling(
                Type: 1, Queue: 1, Due: dueAt, Interval: 0, Reps: 2)),
        };

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, cards, new Dictionary<string, byte[]>());
        try
        {
            var (_, schedule) = await ImportSingleAsync(apkg);

            Assert.Equal(FlashcardFsrsState.Learning, schedule.FsrsState);
            // Its step is not carried, so a card already past its minute comes back at the next
            // opportunity rather than at a time that no longer means anything.
            Assert.True(schedule.DueDate <= DateTimeOffset.UtcNow.AddMinutes(1));
            Assert.True(schedule.DueDate > DateTimeOffset.UtcNow.AddMinutes(-5));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_CardParkedInAFilteredDeck_GoesHomeWithItsRealDueDate()
    {
        var realDue = DaysToFuture(60);
        var cards = new[]
        {
            new AnkiFixtureCard("Home", "Home card", "Back"),
            new AnkiFixtureCard("Cram", "Borrowed card", "Back", Scheduling: new AnkiFixtureScheduling(
                Type: 2, Queue: 2, Due: 1, Interval: 30, Reps: 8, OriginalDue: realDue)),
        };

        var homeDeckId = AnkiPackageFixture.DeckIdFor(cards, "Home");
        cards[1] = cards[1] with { Scheduling = cards[1].Scheduling! with { OriginalDeckId = homeDeckId } };

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, cards, new Dictionary<string, byte[]>());
        try
        {
            await using var h = new FlashcardStoreHarness();
            await h.Store.InitializeAsync();
            var library = NewLibrary(h);
            var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

            var result = await NewAdapter(h, library, cardService).ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(result.Success, result.ErrorMessage);

            // The filtered deck is a temporary holding pen. Importing it as a deck of its own splits
            // a collection across decks the user never made.
            var deck = Assert.Single(await library.ListDecksAsync());
            Assert.Equal("Home", deck.Name);

            var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            Assert.Equal(2, page.Items.Count);

            var borrowed = Assert.Single(page.Items, v => v.Card.Front == "Borrowed card");
            var schedule = await ScheduleForAsync(h, borrowed.Card.Id);
            Assert.Equal(AnkiPackageFixture.CollectionCreatedAt.AddDays(realDue), schedule.DueDate);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_DueDateBeyondAnyPlausibleSchedule_FallsBackToNow()
    {
        // A corrupt row dated centuries out would otherwise hide the card for good.
        var cards = new[]
        {
            new AnkiFixtureCard("Physiology", "Front", "Back", Scheduling: new AnkiFixtureScheduling(
                Type: 2, Queue: 2, Due: DaysToFuture(365 * 500), Interval: 10, Reps: 1)),
        };

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, cards, new Dictionary<string, byte[]>());
        try
        {
            var (_, schedule) = await ImportSingleAsync(apkg);
            Assert.True(schedule.DueDate <= DateTimeOffset.UtcNow.AddMinutes(1));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_OverdueReviewCard_StaysOverdue()
    {
        // Pushing a late card to today hides how long it has been waiting, which is the one thing
        // the scheduler needs to know about it.
        var dueDays = DaysToFuture(-40);
        var cards = new[]
        {
            new AnkiFixtureCard("Physiology", "Front", "Back", Scheduling: new AnkiFixtureScheduling(
                Type: 2, Queue: 2, Due: dueDays, Interval: 15, Reps: 9)),
        };

        var apkg = await AnkiPackageFixture.WriteAsync(AnkiFixtureLayout.Legacy, cards, new Dictionary<string, byte[]>());
        try
        {
            var (_, schedule) = await ImportSingleAsync(apkg);
            Assert.Equal(AnkiPackageFixture.CollectionCreatedAt.AddDays(dueDays), schedule.DueDate);
            Assert.True(schedule.DueDate < DateTimeOffset.UtcNow.AddDays(-30));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    private static async Task<(Flashcard Card, FlashcardSchedule Schedule)> ImportSingleAsync(string apkg)
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var result = await NewAdapter(h, library, cardService).ImportAsync(new ImportExportRequest { FilePath = apkg });
        Assert.True(result.Success, result.ErrorMessage);

        var deck = Assert.Single(await library.ListDecksAsync());
        var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));
        var card = Assert.Single(page.Items).Card;
        return (card, await ScheduleForAsync(h, card.Id));
    }

    private static async Task<FlashcardSchedule> ScheduleForAsync(FlashcardStoreHarness h, string cardId)
    {
        var schedule = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, cardId, ct));
        Assert.NotNull(schedule);
        return schedule;
    }

    private static FlashcardsAnkiFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        FlashcardCardService cardSvc) =>
        new(library, cardSvc, new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock), new ImageAssetService());

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
}
