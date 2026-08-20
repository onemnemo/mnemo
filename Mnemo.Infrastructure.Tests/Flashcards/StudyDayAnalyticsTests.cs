using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Statistics;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Statistics;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// One definition of the study day across the product: the day a review is scheduled and capped
/// against is the day it is reported under. A fixed offset zone is used rather than a named one so
/// the expectations do not depend on the time zone database of the build machine.
/// </summary>
public sealed class StudyDayAnalyticsTests
{
    /// <summary>Far enough behind UTC that a local evening has already crossed UTC midnight.</summary>
    private static readonly TimeZoneInfo FiveWest =
        TimeZoneInfo.CreateCustomTimeZone("test-minus-5", TimeSpan.FromHours(-5), "UTC-5", "UTC-5");

    /// <summary>
    /// Nine in the evening on the tenth, five hours behind UTC. Well past the rollover hour, so the
    /// study day is the tenth, and already the eleventh in UTC.
    /// </summary>
    private static readonly DateTimeOffset EveningOfTheTenth = new(2026, 3, 11, 2, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task AReviewPastTheRolloverHour_IsCountedOnTheSameDayByStudyAndByAnalytics()
    {
        await using var h = new FlashcardStoreHarness(EveningOfTheTenth, FiveWest);
        var deckId = await h.SeedDeckAsync();
        await SeedCardAsync(h, deckId);

        // The study surface: grading writes the deck's daily tally under the study day it belongs to.
        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Easy);

        // Analytics: the same session reported into the day-keyed summary the overview reads.
        var stats = StatisticsManager.CreateInMemory(new TestLogger());
        await StatisticsRecorder.RecordFlashcardActivityAsync(
            stats, new TestLogger(), StudyDay(h), deckId, "Deck", "review", 1, 5, EveningOfTheTenth);

        var studyDayKey = h.Clock.TodayKey(FlashcardPreset.DefaultNextDayStartsAtHour);
        Assert.Equal("2026-03-10", studyDayKey);

        var tally = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, studyDayKey, ct));
        Assert.Equal(1, tally.NewIntroduced);

        var reported = await ReadDailyAsync(stats, studyDayKey);
        Assert.Equal(1, reported);

        // The UTC date the instant falls on has no row of its own. Without this the analytics row
        // lands on the eleventh while the study screen is still counting the tenth.
        Assert.Equal(0, await ReadDailyAsync(stats, "2026-03-11"));
    }

    [Fact]
    public async Task TheReportedDay_FollowsThePresetsRolloverHour()
    {
        // Half past one in the morning, in a zone where that is also the UTC time.
        var afterMidnight = new DateTimeOffset(2026, 3, 11, 1, 30, 0, TimeSpan.Zero);
        await using var h = new FlashcardStoreHarness(afterMidnight);
        await h.SeedDeckAsync();

        var stats = StatisticsManager.CreateInMemory(new TestLogger());
        await StatisticsRecorder.RecordFlashcardActivityAsync(
            stats, new TestLogger(), StudyDay(h), "deck-1", "Deck", "review", 1, 5, afterMidnight);

        // Rolling over at four, the small hours still belong to the evening before.
        Assert.Equal(1, await ReadDailyAsync(stats, "2026-03-10"));
        Assert.Equal(0, await ReadDailyAsync(stats, "2026-03-11"));

        // Turned down to midnight, the same instant is reported on the calendar date instead. The
        // boundary is the collection's setting, not a constant baked into the recorder.
        await SetDayStartHourAsync(h, 0);
        var later = StatisticsManager.CreateInMemory(new TestLogger());
        await StatisticsRecorder.RecordFlashcardActivityAsync(
            later, new TestLogger(), StudyDay(h), "deck-1", "Deck", "review", 1, 5, afterMidnight);

        Assert.Equal(0, await ReadDailyAsync(later, "2026-03-10"));
        Assert.Equal(1, await ReadDailyAsync(later, "2026-03-11"));
    }

    [Fact]
    public async Task TwoSessionsInOneEvening_DoNotAdvanceTheStreakTwice()
    {
        await using var h = new FlashcardStoreHarness(EveningOfTheTenth, FiveWest);
        await h.SeedDeckAsync();
        var stats = StatisticsManager.CreateInMemory(new TestLogger());
        var studyDay = StudyDay(h);

        // Six in the evening on the tenth, which is still the tenth in UTC.
        var early = new DateTimeOffset(2026, 3, 10, 23, 0, 0, TimeSpan.Zero);
        // Eight in the evening on the tenth, by which point UTC has rolled over to the eleventh.
        var late = EveningOfTheTenth;

        await StatisticsRecorder.RecordFlashcardActivityAsync(
            stats, new TestLogger(), studyDay, "deck-1", "Deck", "review", 1, 5, early);
        await StatisticsRecorder.RecordFlashcardActivityAsync(
            stats, new TestLogger(), studyDay, "deck-1", "Deck", "review", 1, 5, late);

        // One evening of study is one day on the streak. Counting the second session as a new day
        // is what a UTC boundary does to anyone studying in the Americas.
        Assert.Equal(1, await ReadStreakAsync(stats));

        // The next evening does advance it.
        await StatisticsRecorder.RecordFlashcardActivityAsync(
            stats, new TestLogger(), studyDay, "deck-1", "Deck", "review", 1, 5, late.AddDays(1));
        Assert.Equal(2, await ReadStreakAsync(stats));
    }

    [Fact]
    public async Task AStreakRecordedUnderTheOldBoundary_CarriesOnRatherThanRestarting()
    {
        await using var h = new FlashcardStoreHarness(EveningOfTheTenth, FiveWest);
        await h.SeedDeckAsync();
        var stats = StatisticsManager.CreateInMemory(new TestLogger());

        // A profile written before the boundary moved: the day is under the name it had then.
        await stats.UpsertAsync(new StatisticsRecordWrite
        {
            Namespace = StatisticsNamespaces.Flashcards,
            Kind = FlashcardStatKinds.LifetimeTotals,
            Key = "all",
            SourceModule = StatisticsNamespaces.Flashcards,
            Fields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
            {
                ["current_streak_days"] = StatValue.FromInt(7),
                ["last_practiced_utc_day"] = StatValue.FromDateTime(new DateTimeOffset(2026, 3, 9, 0, 0, 0, TimeSpan.Zero))
            }
        });

        await StatisticsRecorder.RecordFlashcardActivityAsync(
            stats, new TestLogger(), StudyDay(h), "deck-1", "Deck", "review", 1, 5, EveningOfTheTenth);

        Assert.Equal(8, await ReadStreakAsync(stats));
    }

    private static IStudyDayService StudyDay(FlashcardStoreHarness h) =>
        new StudyDayService(new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock), h.Clock);

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, h.Facts, new FsrsScheduler(h.Clock), h.Clock);

    private static Task SeedCardAsync(FlashcardStoreHarness h, string deckId) =>
        new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock).CreateCardAsync(new FlashcardCardDraft(
            deckId, FlashcardType.Classic, "Q", "A", Array.Empty<string>(), Array.Empty<FlashcardAttachment>()));

    private static async Task SetDayStartHourAsync(FlashcardStoreHarness h, int hour)
    {
        var presets = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var standard = await presets.GetOrCreateStandardAsync();
        await presets.SavePresetAsync(standard with { NextDayStartsAtHour = hour });
    }

    private static async Task<long> ReadDailyAsync(IStatisticsManager stats, string dayKey)
    {
        var record = (await stats.GetAsync(
            StatisticsNamespaces.Flashcards, FlashcardStatKinds.DailySummary, dayKey)).Value;
        return record != null && record.Fields.TryGetValue("cards_reviewed", out var value) ? value.AsInt() : 0L;
    }

    private static async Task<long> ReadStreakAsync(IStatisticsManager stats)
    {
        var record = (await stats.GetAsync(
            StatisticsNamespaces.Flashcards, FlashcardStatKinds.LifetimeTotals, "all")).Value;
        return record != null && record.Fields.TryGetValue("current_streak_days", out var value) ? value.AsInt() : 0L;
    }
}
