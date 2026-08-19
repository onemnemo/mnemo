using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

public sealed class FlashcardServiceTests
{
    // --- Preset service ---

    [Fact]
    public async Task GetOrCreateStandard_IsIdempotent()
    {
        await using var h = new FlashcardStoreHarness();
        var svc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);

        var a = await svc.GetOrCreateStandardAsync();
        var b = await svc.GetOrCreateStandardAsync();

        Assert.Equal(FlashcardPreset.StandardPresetId, a.Id);
        Assert.Equal(a.Id, b.Id);
        var all = await svc.ListPresetsAsync();
        Assert.Single(all);
    }

    [Fact]
    public async Task DeletePreset_Blocked_WhileDeckReferencesIt()
    {
        await using var h = new FlashcardStoreHarness();
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var lib = NewLibrary(h);
        await presetSvc.GetOrCreateStandardAsync();
        await lib.CreateDeckAsync("Geology");

        var deleted = await presetSvc.DeletePresetAsync(FlashcardPreset.StandardPresetId);

        Assert.False(deleted);
        Assert.Single(await presetSvc.ListPresetsAsync());
    }

    // --- Card service ---

    [Fact]
    public async Task CreateCard_InsertsContentAndInitialSchedule()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var svc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);

        var card = await svc.CreateCardAsync(Draft(deckId, "Q", "A"));

        var schedule = await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, card.Id, ct));
        Assert.NotNull(schedule);
        Assert.Equal(FlashcardFsrsState.New, schedule!.FsrsState);
        Assert.Equal(FlashcardCardState.Active, card.State);
    }

    [Fact]
    public async Task CreateCard_Throws_WhenSideExceedsThreeAttachments()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var svc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);

        var attachments = Enumerable.Range(0, 4)
            .Select(i => new FlashcardAttachment($"a{i}", FlashcardAttachment.FrontSide, $"/img/{i}.png", $"{i}.png", 10))
            .ToArray();
        var draft = Draft(deckId, "Q", "A") with { Attachments = attachments };

        await Assert.ThrowsAsync<ArgumentException>(() => svc.CreateCardAsync(draft));
    }

    [Fact]
    public async Task CreateCards_Bulk_IsOneTransaction()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var svc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);

        var drafts = Enumerable.Range(0, 10).Select(i => Draft(deckId, $"Q{i}", $"A{i}")).ToArray();
        var created = await svc.CreateCardsAsync(deckId, drafts);

        Assert.Equal(10, created.Count);
        var counts = await h.Store.ReadAsync((c, ct) => h.Cards.GetCountsAsync(c, deckId, ct));
        Assert.Equal(10, counts.Total);
    }

    [Fact]
    public async Task AddTag_IsIdempotent_AndCaseInsensitive()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var svc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        var card = await svc.CreateCardAsync(Draft(deckId, "Q", "A"));

        await svc.AddTagAsync(new[] { card.Id }, "plates");
        await svc.AddTagAsync(new[] { card.Id }, "PLATES");

        var reloaded = await svc.GetCardAsync(card.Id);
        Assert.Single(reloaded!.Tags);
    }

    // --- Study service ---

    [Fact]
    public async Task GetDueCounts_CapsNewCardsByPresetLimit()
    {
        await using var h = new FlashcardStoreHarness();
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var lib = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        var study = NewStudy(h);

        var preset = await presetSvc.SavePresetAsync(FlashcardPreset.CreateStandard(DateTimeOffset.UtcNow)
            with { Id = "p-small", Name = "Small", NewPerDay = 2 });
        var deck = await lib.CreateDeckAsync("Geo", null, preset.Id);
        await cardSvc.CreateCardsAsync(deck.Id, Enumerable.Range(0, 5).Select(i => Draft(deck.Id, $"Q{i}", "A")).ToArray());

        var counts = await study.GetDueCountsAsync(deck.Id);

        Assert.Equal(2, counts.New); // 5 new cards, capped to NewPerDay = 2
    }

    [Fact]
    public async Task RecordReview_WritesScheduleReviewAndDailyStat_AndReturnsId()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        var study = NewStudy(h);
        var card = await cardSvc.CreateCardAsync(Draft(deckId, "Q", "A"));
        var now = DateTimeOffset.UtcNow;

        var entry = new FlashcardReviewEntry(
            UpdatedSchedule: new FlashcardSchedule(card.Id, now.AddDays(3), 6, 5, 1, 0, FlashcardFsrsState.Review, 0, now),
            Review: new FlashcardReviewLog(FlashcardReviewLog.Unassigned, card.Id, deckId, "s1",
                FlashcardReviewGrade.Good, now, 0, 3, 6, 5, FlashcardFsrsState.Review, FlashcardFsrsState.Review),
            IntroducedNewCard: true,
            LocalDay: "2026-07-06");
        var id = await study.RecordReviewAsync(entry);

        Assert.True(id > 0);
        var sched = await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, card.Id, ct));
        var reviews = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, deckId, ct));
        var stat = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, "2026-07-06", ct));
        Assert.Equal(FlashcardFsrsState.Review, sched!.FsrsState);
        Assert.Equal(1, reviews);
        Assert.Equal(1, stat.NewIntroduced);
        Assert.Equal(1, stat.ReviewsDone);
    }

    [Fact]
    public async Task RecordReview_IsAtomic_RollsBackWhenDailyStatFails()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        var card = await cardSvc.CreateCardAsync(Draft(deckId, "Q", "A"));
        var now = DateTimeOffset.UtcNow;

        // Study service whose daily-stats write throws after the schedule + review writes.
        var study = new FlashcardStudyService(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, new ThrowingDailyStats(), h.Cards, h.Facts, new FsrsScheduler(h.Clock), h.Clock);
        var entry = new FlashcardReviewEntry(
            new FlashcardSchedule(card.Id, now.AddDays(3), 6, 5, 1, 0, FlashcardFsrsState.Review, 0, now),
            new FlashcardReviewLog(FlashcardReviewLog.Unassigned, card.Id, deckId, "s1", FlashcardReviewGrade.Good, now, 0, 3, 6, 5, FlashcardFsrsState.Review, FlashcardFsrsState.Review),
            false, "2026-07-06");

        await Assert.ThrowsAsync<InvalidOperationException>(() => study.RecordReviewAsync(entry));

        var sched = await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, card.Id, ct));
        var reviews = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, deckId, ct));
        Assert.Equal(FlashcardFsrsState.New, sched!.FsrsState); // schedule write rolled back
        Assert.Equal(0, reviews);                               // review append rolled back
    }

    [Fact]
    public async Task UndoReview_ReversesScheduleReviewAndDailyStat()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        var study = NewStudy(h);
        var card = await cardSvc.CreateCardAsync(Draft(deckId, "Q", "A"));
        var now = DateTimeOffset.UtcNow;
        // The card is already in review, so undoing gives the day's review cap its slot back.
        var priorSchedule = new FlashcardSchedule(card.Id, now, 4, 5, 2, 0, FlashcardFsrsState.Review, 0, now.AddDays(-4));
        await h.Store.WriteAsync((c, tx, ct) => h.Schedules.UpsertAsync(c, tx, priorSchedule, ct));

        var entry = new FlashcardReviewEntry(
            new FlashcardSchedule(card.Id, now.AddDays(3), 6, 5, 3, 0, FlashcardFsrsState.Review, 0, now),
            new FlashcardReviewLog(FlashcardReviewLog.Unassigned, card.Id, deckId, "s1", FlashcardReviewGrade.Good, now, 0, 3, 6, 5, FlashcardFsrsState.Review, FlashcardFsrsState.Review),
            true, "2026-07-06");
        var id = await study.RecordReviewAsync(entry);
        var afterGrade = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, "2026-07-06", ct));
        Assert.Equal(1, afterGrade.ReviewsDone);

        await study.UndoReviewAsync(deckId, priorSchedule, id, "2026-07-06", wasNewIntroduction: true);

        var sched = await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, card.Id, ct));
        var reviews = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, deckId, ct));
        var stat = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, "2026-07-06", ct));
        Assert.Equal(priorSchedule.DueDate, sched!.DueDate);
        Assert.Equal(0, reviews);
        Assert.Equal(0, stat.NewIntroduced);
        Assert.Equal(0, stat.ReviewsDone);
    }

    // --- Stats service ---

    [Fact]
    public async Task TrueRetention_CountsNonAgainOverScheduledReviews()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var stats = new FlashcardStatsService(h.Store, h.Reviews, h.TestAttempts, h.Decks, h.Presets, h.Clock);
        var now = DateTimeOffset.UtcNow;

        // 3 passed (Good/Hard/Easy) + 1 failed (Again), all in Review state.
        foreach (var (grade, i) in new[]
                 {
                     (FlashcardReviewGrade.Good, 0), (FlashcardReviewGrade.Hard, 1),
                     (FlashcardReviewGrade.Easy, 2), (FlashcardReviewGrade.Again, 3)
                 })
        {
            await h.Store.WriteAsync((c, tx, ct) => h.Reviews.AppendAsync(c, tx, new FlashcardReviewLog(
                FlashcardReviewLog.Unassigned, $"c{i}", deckId, "s1", grade, now.AddMinutes(-i), 0, 1, null, null,
                FlashcardFsrsState.Review, FlashcardFsrsState.Review), ct));
        }

        var retention = await stats.GetTrueRetentionAsync(deckId);
        Assert.Equal(75, retention); // 3 of 4
    }

    [Fact]
    public async Task TestSummary_ReportsLatestPreviousAndBest()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var stats = new FlashcardStatsService(h.Store, h.Reviews, h.TestAttempts, h.Decks, h.Presets, h.Clock);
        var now = DateTimeOffset.UtcNow;

        await stats.RecordTestAttemptAsync(new FlashcardTestAttempt("t1", deckId, now.AddHours(-2), now.AddHours(-2), 10, 6, 2, 2, 70));
        await stats.RecordTestAttemptAsync(new FlashcardTestAttempt("t2", deckId, now.AddHours(-1), now.AddHours(-1), 10, 9, 1, 0, 95));

        var summary = await stats.GetTestSummaryAsync(deckId);

        Assert.True(summary.HasAttempts);
        Assert.Equal(95, summary.LatestScorePct);
        Assert.Equal(70, summary.PreviousScorePct);
        Assert.Equal(95, summary.BestScorePct);
        Assert.Equal(25, summary.DeltaVsPrevious);
    }

    // --- Library service ---

    [Fact]
    public async Task CreateDeck_SeedsStandardPreset_AndListsSummaryWithCounts()
    {
        await using var h = new FlashcardStoreHarness();
        var lib = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);

        var deck = await lib.CreateDeckAsync("Geology");
        await cardSvc.CreateCardsAsync(deck.Id, new[] { Draft(deck.Id, "Q1", "A"), Draft(deck.Id, "Q2", "A") });

        var decks = await lib.ListDecksAsync();
        var summary = Assert.Single(decks);
        Assert.Equal("Geology", summary.Name);
        Assert.Equal(2, summary.TotalCards);
        Assert.Equal(FlashcardPreset.StandardPresetId, summary.Header.PresetId);
    }

    // --- helpers ---

    private static FlashcardCardDraft Draft(string deckId, string front, string back) =>
        new(deckId, FlashcardType.Classic, front, back, Array.Empty<string>(), Array.Empty<FlashcardAttachment>());

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    private static FlashcardStudyService NewStudy(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, h.Facts, new FsrsScheduler(h.Clock), h.Clock);

    private sealed class ThrowingDailyStats : IDailyStatsRepository
    {
        public Task<FlashcardDailyStat> GetAsync(SqliteConnection conn, string deckId, string localDay, CancellationToken cancellationToken) =>
            Task.FromResult(new FlashcardDailyStat(deckId, localDay, 0, 0));

        public Task IncrementAsync(SqliteConnection conn, SqliteTransaction tx, string deckId, string localDay, int newDelta, int reviewsDelta, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("simulated daily-stats failure");
    }
}
