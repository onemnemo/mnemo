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
/// The review forecast: one column per local day, today drawn from the cap-aware queue and later
/// days from the raw schedule.
/// </summary>
public sealed class FlashcardForecastTests
{
    /// <summary>A fixed instant, so the columns do not depend on when the suite happens to run.</summary>
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    /// <summary>Late enough in UTC that a zone further east is already on the following date.</summary>
    private static readonly DateTimeOffset LateEvening = new(2026, 3, 5, 23, 30, 0, TimeSpan.Zero);

    private static readonly TimeZoneInfo NineEast =
        TimeZoneInfo.CreateCustomTimeZone("test-plus-9", TimeSpan.FromHours(9), "UTC+9", "UTC+9");

    [Fact]
    public async Task Forecast_ReturnsOneEntryPerDay_StartingToday()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync();
        var study = NewStudy(h);

        var forecast = await study.GetReviewForecastAsync(14);

        Assert.Equal(14, forecast.Count);
        Assert.Equal(DateOnly.FromDateTime(Now.UtcDateTime), forecast[0].Day);
        // Consecutive and gap-free, so a caller charts the window without filling holes itself.
        Assert.Equal(
            Enumerable.Range(0, 14).Select(offset => forecast[0].Day.AddDays(offset)),
            forecast.Select(day => day.Day));
    }

    [Fact]
    public async Task Forecast_BucketsScheduledCardsByTheirDueDay()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await h.SeedDeckAsync();
        var today = Now.UtcDateTime.Date;

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
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await h.SeedDeckAsync();

        // Three days late. Its own day is behind the window entirely, so a forecast that only read
        // the schedule would lose it rather than showing work that is already waiting.
        await AddScheduledAsync(h, deckId, "late", Now.UtcDateTime.AddDays(-3));

        var forecast = await NewStudy(h).GetReviewForecastAsync(7);

        Assert.Equal(1, forecast[0].Due);
        Assert.All(forecast.Skip(1), day => Assert.Equal(0, day.Due));
    }

    [Fact]
    public async Task Forecast_ExcludesNewAndSuspendedCardsFromFutureDays()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await h.SeedDeckAsync();
        var due = Now.UtcDateTime.Date.AddDays(3);

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
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await h.SeedDeckAsync();
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        await cards.CreateCardsAsync(deckId, Enumerable.Range(0, 4)
            .Select(i => new FlashcardCardDraft(deckId, FlashcardType.Classic, $"Q{i}", "A",
                Array.Empty<string>(), Array.Empty<FlashcardAttachment>()))
            .ToArray());
        await AddScheduledAsync(h, deckId, "due-now", Now.UtcDateTime.AddMinutes(-5));
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
        await using var h = new FlashcardStoreHarness(Now);
        await h.SeedDeckAsync();

        var forecast = await NewStudy(h).GetReviewForecastAsync(requested);

        Assert.Equal(expected, forecast.Count);
    }

    [Fact]
    public async Task Forecast_ColumnsFollowTheUsersZone_NotUtc()
    {
        // Half past eight on the morning of the 6th nine hours east, so the chart starts on the 6th
        // even though UTC is still on the 5th, and a card due that evening local time belongs to it.
        await using var h = new FlashcardStoreHarness(LateEvening, NineEast);
        var deckId = await h.SeedDeckAsync();

        // Both fall on the 7th in UTC, which is what the old bucketing would have keyed on, but
        // 16:00 UTC is already past midnight local so the two belong to different columns.
        await AddScheduledAsync(h, deckId, "local-seventh", new DateTime(2026, 3, 7, 12, 0, 0));
        await AddScheduledAsync(h, deckId, "local-eighth", new DateTime(2026, 3, 7, 16, 0, 0));

        var forecast = await NewStudy(h).GetReviewForecastAsync(7);

        Assert.Equal(new DateOnly(2026, 3, 6), forecast[0].Day);
        Assert.Equal(1, forecast[1].Due);
        Assert.Equal(1, forecast[2].Due);
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
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, h.Facts, new FsrsScheduler(h.Clock), h.Clock);
}
