using System;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// What a study day means: which calendar day a review counts against, and that the answer comes
/// from the injected clock rather than from wherever and whenever the suite happens to run.
/// Fixed offsets are used instead of named zones so the expectations do not depend on the time
/// zone database of the build machine.
/// </summary>
public sealed class FlashcardDayBoundaryTests
{
    private static readonly TimeZoneInfo NineEast =
        TimeZoneInfo.CreateCustomTimeZone("test-plus-9", TimeSpan.FromHours(9), "UTC+9", "UTC+9");

    private static readonly TimeZoneInfo TenWest =
        TimeZoneInfo.CreateCustomTimeZone("test-minus-10", TimeSpan.FromHours(-10), "UTC-10", "UTC-10");

    /// <summary>An instant that falls on three different calendar dates depending on the zone.</summary>
    private static readonly DateTimeOffset LateEvening = new(2026, 3, 5, 23, 30, 0, TimeSpan.Zero);

    [Fact]
    public void StudyDay_FollowsTheUsersZone_NotUtc()
    {
        // Rolling over at midnight here, so the only thing under test is the zone.
        Assert.Equal("2026-03-06", Key(LateEvening, NineEast, 0));
        Assert.Equal("2026-03-05", Key(LateEvening, TimeZoneInfo.Utc, 0));
        Assert.Equal("2026-03-05", Key(LateEvening, TenWest, 0));

        // An hour later the zone nine hours east is unchanged but UTC has rolled over too.
        var afterMidnight = LateEvening.AddHours(1);
        Assert.Equal("2026-03-06", Key(afterMidnight, NineEast, 0));
        Assert.Equal("2026-03-06", Key(afterMidnight, TimeZoneInfo.Utc, 0));
        Assert.Equal("2026-03-05", Key(afterMidnight, TenWest, 0));
    }

    [Fact]
    public void StudyDay_EndsAtTheRolloverHour_NotAtMidnight()
    {
        // Half past midnight is still the evening before as far as the study day is concerned, and
        // stays that way until the rollover hour arrives.
        Assert.Equal("2026-03-05", Key(new DateTimeOffset(2026, 3, 6, 0, 30, 0, TimeSpan.Zero), TimeZoneInfo.Utc, 4));
        Assert.Equal("2026-03-05", Key(new DateTimeOffset(2026, 3, 6, 3, 59, 0, TimeSpan.Zero), TimeZoneInfo.Utc, 4));
        Assert.Equal("2026-03-06", Key(new DateTimeOffset(2026, 3, 6, 4, 0, 0, TimeSpan.Zero), TimeZoneInfo.Utc, 4));

        // Hour zero is plain midnight, which is what a user who turns the setting down asks for.
        Assert.Equal("2026-03-06", Key(new DateTimeOffset(2026, 3, 6, 0, 30, 0, TimeSpan.Zero), TimeZoneInfo.Utc, 0));
    }

    [Fact]
    public void DayScaleInterval_LandsAtTheStartOfTheTargetDay()
    {
        // Answered late in the evening, so an interval measured in elapsed hours would put the card
        // back before the day it belongs to had begun.
        var clock = new FlashcardClock(new TestTimeProvider(LateEvening));
        var due = clock.DueAfterDays(LateEvening, 3, 4);

        Assert.Equal(new DateTimeOffset(2026, 3, 8, 4, 0, 0, TimeSpan.Zero), due);
        Assert.Equal(3, clock.DaysBetween(LateEvening, due, 4));
    }

    [Fact]
    public void DayScaleInterval_SurvivesADaylightSavingShift()
    {
        // A zone that springs forward at two in the morning deletes the hour a day starting at two
        // would begin on. The day still has to start somewhere, and the count of days must hold.
        var spring = TimeZoneInfo.CreateCustomTimeZone(
            "test-dst", TimeSpan.FromHours(-5), "test", "test", "test",
            new[]
            {
                TimeZoneInfo.AdjustmentRule.CreateAdjustmentRule(
                    DateTime.MinValue.Date, DateTime.MaxValue.Date, TimeSpan.FromHours(1),
                    TimeZoneInfo.TransitionTime.CreateFloatingDateRule(new DateTime(1, 1, 1, 2, 0, 0), 3, 2, DayOfWeek.Sunday),
                    TimeZoneInfo.TransitionTime.CreateFloatingDateRule(new DateTime(1, 1, 1, 2, 0, 0), 11, 1, DayOfWeek.Sunday)),
            });

        var clock = new FlashcardClock(new TestTimeProvider(LateEvening, spring));
        // Local Saturday the 7th, the day before the shift.
        var saturdayEvening = new DateTimeOffset(2026, 3, 8, 1, 0, 0, TimeSpan.Zero);

        foreach (var hour in new[] { 0, 2, 4 })
        {
            var due = clock.DueAfterDays(saturdayEvening, 2, hour);
            Assert.Equal(2, clock.DaysBetween(saturdayEvening, due, hour));
            Assert.Equal(clock.DayOf(saturdayEvening, hour).AddDays(2), clock.DayOf(due, hour));
        }
    }

    [Fact]
    public async Task Review_CountsAgainstTheStudyDayInTheUsersZone()
    {
        // Late on the 5th in UTC is already the morning of the 6th nine hours east, so the day's
        // tally belongs to the 6th and the cap for the 5th must be untouched.
        await using var h = new FlashcardStoreHarness(LateEvening, NineEast);
        var deckId = await h.SeedDeckAsync();
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        await cards.CreateCardAsync(new FlashcardCardDraft(
            deckId, FlashcardType.Classic, "Q", "A", Array.Empty<string>(), Array.Empty<FlashcardAttachment>()));
        var study = Study(h);

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Easy);

        var local = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, "2026-03-06", ct));
        var utcDay = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, "2026-03-05", ct));
        Assert.Equal(1, local.NewIntroduced);
        Assert.Equal(0, utcDay.NewIntroduced);
    }

    [Fact]
    public async Task Review_IsStampedWithTheInjectedInstant()
    {
        await using var h = new FlashcardStoreHarness(LateEvening);
        var deckId = await h.SeedDeckAsync();
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        var card = await cards.CreateCardAsync(new FlashcardCardDraft(
            deckId, FlashcardType.Classic, "Q", "A", Array.Empty<string>(), Array.Empty<FlashcardAttachment>()));
        var study = Study(h);

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Good);

        Assert.Equal(LateEvening, await ReadReviewedAtAsync(h, card.Id));
    }

    [Fact]
    public async Task TheDayTheCapIsChargedTo_TurnsOverAtTheRolloverHour_NotAtMidnight()
    {
        await using var h = new FlashcardStoreHarness(LateEvening);
        var deckId = await h.SeedDeckAsync();
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        await cards.CreateCardsAsync(deckId, new[]
        {
            new FlashcardCardDraft(deckId, FlashcardType.Classic, "Q1", "A", Array.Empty<string>(), Array.Empty<FlashcardAttachment>()),
            new FlashcardCardDraft(deckId, FlashcardType.Classic, "Q2", "A", Array.Empty<string>(), Array.Empty<FlashcardAttachment>()),
            new FlashcardCardDraft(deckId, FlashcardType.Classic, "Q3", "A", Array.Empty<string>(), Array.Empty<FlashcardAttachment>()),
        });
        var study = Study(h);

        await GradeOneAsync(study, deckId); // 23:30 on the 5th

        h.Time.Advance(TimeSpan.FromHours(1)); // 00:30 on the 6th, past midnight but still the 5th
        await GradeOneAsync(study, deckId);

        h.Time.Advance(TimeSpan.FromHours(4)); // 04:30 on the 6th, past the rollover hour
        await GradeOneAsync(study, deckId);

        var fifth = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, "2026-03-05", ct));
        var sixth = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, "2026-03-06", ct));
        Assert.Equal(2, fifth.NewIntroduced);
        Assert.Equal(1, sixth.NewIntroduced);
    }

    private static string Key(DateTimeOffset instant, TimeZoneInfo zone, int startHour) =>
        new FlashcardClock(new TestTimeProvider(instant, zone)).TodayKey(startHour);

    private static async Task GradeOneAsync(FlashcardStudyService study, string deckId)
    {
        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Easy);
    }

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, new FsrsScheduler(h.Clock), h.Clock);

    private static Task<DateTimeOffset> ReadReviewedAtAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT ReviewedAt FROM FlashcardReviews WHERE CardId = $card ORDER BY Id DESC LIMIT 1;";
            cmd.Parameters.AddWithValue("$card", cardId);
            var value = (string)(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!;
            return DateTimeOffset.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
        });
}
