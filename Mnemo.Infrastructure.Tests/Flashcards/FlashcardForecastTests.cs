using System;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// The review forecast: one column per UTC day, today drawn from the cap-aware queue and later
/// days from the raw schedule.
/// </summary>
public sealed class FlashcardForecastTests
{
    [Fact]
    public async Task Forecast_ReturnsOneEntryPerDay_StartingToday()
    {
        await using var h = new FlashcardStoreHarness();
        await h.SeedDeckAsync();
        var study = NewStudy(h);

        var forecast = await study.GetReviewForecastAsync(14);

        Assert.Equal(14, forecast.Count);
        Assert.Equal(DateOnly.FromDateTime(DateTime.UtcNow), forecast[0].Day);
        // Consecutive and gap-free, so a caller charts the window without filling holes itself.
        Assert.Equal(
            Enumerable.Range(0, 14).Select(offset => forecast[0].Day.AddDays(offset)),
            forecast.Select(day => day.Day));
    }

    [Fact]
    public async Task Forecast_BucketsScheduledCardsByTheirDueDay()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var today = DateTime.UtcNow.Date;

        await AddScheduledAsync(h, deckId, "c1", today.AddDays(2).AddHours(3));
        await AddScheduledAsync(h, deckId, "c2", today.AddDays(2).AddHours(21));
        await AddScheduledAsync(h, deckId, "c3", today.AddDays(5));

        var forecast = await NewStudy(h).GetReviewForecastAsync(7);

        Assert.Equal(2, forecast[2].Due);
        Assert.Equal(1, forecast[5].Due);
        Assert.Equal(0, forecast[3].Due);
    }

    [Fact]
    public async Task Forecast_CountsOverdueCardsInTodaysColumn()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();

        // Three days late. Its own day is behind the window entirely, so a forecast that only read
        // the schedule would lose it rather than showing work that is already waiting.
        await AddScheduledAsync(h, deckId, "late", DateTime.UtcNow.AddDays(-3));

        var forecast = await NewStudy(h).GetReviewForecastAsync(7);

        Assert.Equal(1, forecast[0].Due);
        Assert.All(forecast.Skip(1), day => Assert.Equal(0, day.Due));
    }

    [Fact]
    public async Task Forecast_ExcludesNewAndSuspendedCardsFromFutureDays()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var due = DateTime.UtcNow.Date.AddDays(3);

        // A new card's due date is an artefact of when its row was written, not a plan to show it.
        await AddScheduledAsync(h, deckId, "fresh", due, FlashcardFsrsState.New);
        await AddScheduledAsync(h, deckId, "hidden", due, state: FlashcardFsrsState.Review, cardState: FlashcardCardState.Suspended);
        await AddScheduledAsync(h, deckId, "real", due);

        var forecast = await NewStudy(h).GetReviewForecastAsync(7);

        Assert.Equal(1, forecast[3].Due);
    }

    [Fact]
    public async Task Forecast_TodayMatchesTheDueTodayBanner()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        await cards.CreateCardsAsync(deckId, Enumerable.Range(0, 4)
            .Select(i => new FlashcardCardDraft(deckId, FlashcardType.Classic, $"Q{i}", "A",
                Array.Empty<string>(), Array.Empty<FlashcardAttachment>()))
            .ToArray());
        await AddScheduledAsync(h, deckId, "due-now", DateTime.UtcNow.AddMinutes(-5));
        var study = NewStudy(h);

        var banner = await study.GetAggregateDueCountsAsync();
        var forecast = await study.GetReviewForecastAsync(7);

        Assert.Equal(banner.New, forecast[0].New);
        Assert.Equal(banner.Learning + banner.Due, forecast[0].Due);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(-4, 1)]
    [InlineData(500, 90)]
    public async Task Forecast_ClampsTheWindow(int requested, int expected)
    {
        await using var h = new FlashcardStoreHarness();
        await h.SeedDeckAsync();

        var forecast = await NewStudy(h).GetReviewForecastAsync(requested);

        Assert.Equal(expected, forecast.Count);
    }

    // --- helpers ---

    private static Task AddScheduledAsync(
        FlashcardStoreHarness h,
        string deckId,
        string cardId,
        DateTime dueUtc,
        FlashcardFsrsState state = FlashcardFsrsState.Review,
        FlashcardCardState cardState = FlashcardCardState.Active)
    {
        var due = new DateTimeOffset(DateTime.SpecifyKind(dueUtc, DateTimeKind.Utc));
        return h.AddCardAsync(
            FlashcardStoreHarness.Card(cardId, deckId, "Q", "A", cardState),
            new FlashcardSchedule(cardId, due, 6, 5, 1, 0, state, 0, null));
    }

    private static FlashcardStudyService NewStudy(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, new FsrsScheduler(), h.Clock);
}
