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
        Assert.Equal("2026-03-06", new FlashcardClock(new TestTimeProvider(LateEvening, NineEast)).TodayKey());
        Assert.Equal("2026-03-05", new FlashcardClock(new TestTimeProvider(LateEvening, TimeZoneInfo.Utc)).TodayKey());
        Assert.Equal("2026-03-05", new FlashcardClock(new TestTimeProvider(LateEvening, TenWest)).TodayKey());

        // An hour later the zone nine hours east is unchanged but UTC has rolled over too.
        var afterMidnight = LateEvening.AddHours(1);
        Assert.Equal("2026-03-06", new FlashcardClock(new TestTimeProvider(afterMidnight, NineEast)).TodayKey());
        Assert.Equal("2026-03-06", new FlashcardClock(new TestTimeProvider(afterMidnight, TimeZoneInfo.Utc)).TodayKey());
        Assert.Equal("2026-03-05", new FlashcardClock(new TestTimeProvider(afterMidnight, TenWest)).TodayKey());
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
    public async Task MovingTheClockForward_MovesTheDayTheCapIsChargedTo()
    {
        await using var h = new FlashcardStoreHarness(LateEvening);
        var deckId = await h.SeedDeckAsync();
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        await cards.CreateCardsAsync(deckId, new[]
        {
            new FlashcardCardDraft(deckId, FlashcardType.Classic, "Q1", "A", Array.Empty<string>(), Array.Empty<FlashcardAttachment>()),
            new FlashcardCardDraft(deckId, FlashcardType.Classic, "Q2", "A", Array.Empty<string>(), Array.Empty<FlashcardAttachment>()),
        });
        var study = Study(h);

        var first = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await first.GradeAsync(FlashcardReviewGrade.Easy);

        h.Time.Advance(TimeSpan.FromHours(1)); // crosses UTC midnight into the 6th
        var second = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await second.GradeAsync(FlashcardReviewGrade.Easy);

        var fifth = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, "2026-03-05", ct));
        var sixth = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, "2026-03-06", ct));
        Assert.Equal(1, fifth.NewIntroduced);
        Assert.Equal(1, sixth.NewIntroduced);
    }

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, new FsrsScheduler(), h.Clock);

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
