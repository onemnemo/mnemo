using System;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

public sealed class FlashcardEngineTests
{
    /// <summary>A fixed instant, so day snapping lands the same way on every machine and every run.</summary>
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    private static readonly FlashcardPreset Preset = FlashcardPreset.CreateStandard(Now);
    private static readonly FlashcardClock Clock = new(new TestTimeProvider(Now));
    private readonly FsrsScheduler _scheduler = new(Clock);

    /// <summary>How many study days out a graduated card landed, which is what its interval means.</summary>
    private static int DueInDays(FlashcardSchedule s, DateTimeOffset now) =>
        Clock.DaysBetween(now, s.DueDate, Preset.DayStartHour);

    // --- Scheduler ---

    [Fact]
    public void NewCard_Good_EntersLearning_AtFirstStep()
    {
        var now = DateTimeOffset.UtcNow;
        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Good, now, Preset);

        Assert.Equal(FlashcardFsrsState.Learning, next.FsrsState);
        Assert.Equal(0, next.LearningStepIndex);
        Assert.Equal(1, Math.Round((next.DueDate - now).TotalMinutes)); // first learning step = 1m
    }

    [Fact]
    public void NewCard_Easy_GraduatesToReview()
    {
        var now = DateTimeOffset.UtcNow;
        var next = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Easy, now, Preset);

        Assert.Equal(FlashcardFsrsState.Review, next.FsrsState);
        Assert.True(DueInDays(next, now) >= 1);
    }

    [Fact]
    public void Learning_Good_AdvancesStep_ThenGraduates()
    {
        var now = DateTimeOffset.UtcNow;
        var step0 = _scheduler.ApplyGrade(FlashcardSchedule.NewFor("c", now), FlashcardReviewGrade.Good, now, Preset);
        var step1 = _scheduler.ApplyGrade(step0, FlashcardReviewGrade.Good, now, Preset);
        Assert.Equal(FlashcardFsrsState.Learning, step1.FsrsState);
        Assert.Equal(1, step1.LearningStepIndex);
        Assert.Equal(10, Math.Round((step1.DueDate - now).TotalMinutes)); // second step = 10m

        var graduated = _scheduler.ApplyGrade(step1, FlashcardReviewGrade.Good, now, Preset);
        Assert.Equal(FlashcardFsrsState.Review, graduated.FsrsState);
        Assert.True(DueInDays(graduated, now) >= 1);
    }

    [Fact]
    public void ReviewCard_Again_LapsesAndRelearns()
    {
        var now = DateTimeOffset.UtcNow;
        var review = new FlashcardSchedule("c", now.AddDays(-1), 10, 5, 4, 0, FlashcardFsrsState.Review, 0, now.AddDays(-8));
        var next = _scheduler.ApplyGrade(review, FlashcardReviewGrade.Again, now, Preset);

        Assert.Equal(FlashcardFsrsState.Relearning, next.FsrsState);
        Assert.Equal(1, next.Lapses);
        Assert.Equal(10, Math.Round((next.DueDate - now).TotalMinutes)); // relearn step = 10m
    }

    [Fact]
    public void DescribeInterval_ProducesReadablePreviews()
    {
        var now = DateTimeOffset.UtcNow;
        var sched = FlashcardSchedule.NewFor("c", now);
        Assert.EndsWith("m", _scheduler.DescribeInterval(sched, FlashcardReviewGrade.Good, now, Preset));
        Assert.EndsWith("d", _scheduler.DescribeInterval(sched, FlashcardReviewGrade.Easy, now, Preset));
    }

    // --- Session ---

    [Fact]
    public async Task Review_Again_RequeuesSameCardInSession()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var study = Study(h);
        await AddReviewCardAsync(h, deckId, "a");

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        Assert.Equal("a", session.Current!.Card.Id);

        await session.GradeAsync(FlashcardReviewGrade.Again);
        Assert.False(session.IsFinished);                 // card came back, not gone
        Assert.Equal("a", session.Current!.Card.Id);

        await session.GradeAsync(FlashcardReviewGrade.Good); // relearn step completes → graduates
        Assert.True(session.IsFinished);
    }

    [Fact]
    public async Task Review_HonoursNewPerDayCap()
    {
        await using var h = new FlashcardStoreHarness();
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var lib = new FlashcardLibraryService(h.Store, h.Folders, h.Decks, h.Cards, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        var study = Study(h);

        var preset = await presetSvc.SavePresetAsync(FlashcardPreset.CreateStandard(DateTimeOffset.UtcNow)
            with { Id = "p2", Name = "Cap2", NewPerDay = 2 });
        var deck = await lib.CreateDeckAsync("Geo", null, preset.Id);
        await cardSvc.CreateCardsAsync(deck.Id, Enumerable.Range(0, 5)
            .Select(i => new FlashcardCardDraft(deck.Id, FlashcardType.Classic, $"Q{i}", "A", Array.Empty<string>(), Array.Empty<FlashcardAttachment>())).ToArray());

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deck.Id, FlashcardSessionMode.Review));
        Assert.Equal(2, session.Progress.Total);           // only 2 of 5 new cards introduced today

        // Graduate both with Easy so each new card is introduced exactly once.
        while (!session.IsFinished)
            await session.GradeAsync(FlashcardReviewGrade.Easy);

        var stat = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deck.Id, h.Clock.TodayKey(FlashcardPreset.DefaultNextDayStartsAtHour), ct));
        Assert.Equal(2, stat.NewIntroduced);
    }

    [Fact]
    public async Task Review_HonoursMaxReviewsPerDayCap()
    {
        await using var h = new FlashcardStoreHarness();
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        var lib = new FlashcardLibraryService(h.Store, h.Folders, h.Decks, h.Cards, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var study = Study(h);

        // NewPerDay 0 keeps new cards out, so only the review budget shapes the queue.
        var preset = await presetSvc.SavePresetAsync(FlashcardPreset.CreateStandard(DateTimeOffset.UtcNow)
            with { Id = "p3", Name = "Cap3", NewPerDay = 0, MaxReviewsPerDay = 3 });
        var deck = await lib.CreateDeckAsync("Caps", null, preset.Id);
        for (var i = 0; i < 6; i++)
            await AddReviewCardAsync(h, deck.Id, $"r{i}");

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deck.Id, FlashcardSessionMode.Review));

        Assert.Equal(3, session.Progress.Total); // 3 of 6 due cards, not all 6
    }

    [Fact]
    public async Task Review_QueueLeadsWithLearningCards()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var study = Study(h);
        var now = DateTimeOffset.UtcNow;

        await AddReviewCardAsync(h, deckId, "due");
        // A learning card due sooner than the review card; learning is drawn first regardless.
        await h.AddCardAsync(
            FlashcardStoreHarness.Card("learn", deckId, "Front learn", "Back learn"),
            new FlashcardSchedule("learn", now.AddMinutes(-1), 2d, 5d, 1, 0,
                FlashcardFsrsState.Learning, 0, now.AddMinutes(-11)));

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));

        Assert.Equal(2, session.Progress.Total);
        Assert.Equal("learn", session.Current!.Card.Id);
    }

    [Fact]
    public async Task Cram_PersistsNothing()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var study = Study(h);
        await AddReviewCardAsync(h, deckId, "a");
        var before = (await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, "a", ct)))!;

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Cram, FlashcardSessionScope.Due));
        Assert.False(session.WritesSchedule);
        await session.GradeAsync(FlashcardReviewGrade.Again);
        await session.GradeAsync(FlashcardReviewGrade.Good);

        var after = (await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, "a", ct)))!;
        var reviews = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, deckId, ct));
        Assert.Equal(before.DueDate, after.DueDate);  // schedule untouched
        Assert.Equal(before.Reps, after.Reps);
        Assert.Equal(0, reviews);                     // review log untouched
    }

    [Fact]
    public async Task Review_Undo_RestoresCardAndSchedule()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var study = Study(h);
        await AddReviewCardAsync(h, deckId, "a");

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Good); // graduates → finished
        Assert.True(session.IsFinished);

        var undone = await session.UndoAsync();
        Assert.True(undone);
        Assert.False(session.IsFinished);
        Assert.Equal("a", session.Current!.Card.Id);
        var reviews = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, deckId, ct));
        Assert.Equal(0, reviews); // review row removed
    }

    [Fact]
    public async Task Review_NewCard_LogsZeroElapsedDays_OnFirstReview()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var study = Study(h);
        // The card was created six days ago but never reviewed; its age is not a review gap.
        var createdAt = DateTimeOffset.UtcNow.AddDays(-6);
        await h.AddCardAsync(FlashcardStoreHarness.Card("a", deckId, "Front a", "Back a"), FlashcardSchedule.NewFor("a", createdAt));

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Good);

        Assert.Equal(0d, await ReadLatestElapsedDaysAsync(h, "a"));
    }

    [Fact]
    public async Task Review_PreviouslyReviewedCard_LogsActualElapsedDays()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var study = Study(h);
        await AddReviewCardAsync(h, deckId, "a"); // LastReviewedAt = 8 days ago

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Good);

        var elapsed = await ReadLatestElapsedDaysAsync(h, "a");
        Assert.True(elapsed is >= 7.9 and <= 8.1, $"expected roughly 8 elapsed days, got {elapsed}");
    }

    [Fact]
    public async Task StudyService_RejectsTestMode()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var study = Study(h);

        // Test drives its own typed-practice queue; the FSRS session must refuse it.
        await Assert.ThrowsAsync<ArgumentException>(() =>
            study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Test)));
    }

    [Fact]
    public async Task Test_RecordsExactlyOneAttempt_AndLeavesFsrsUnchanged()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        await AddReviewCardAsync(h, deckId, "a");

        var scheduleBefore = (await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, "a", ct)))!;
        var reviewsBefore = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, deckId, ct));

        var stats = new FlashcardStatsService(h.Store, h.Reviews, h.TestAttempts, h.Decks, h.Presets, h.Clock);
        var startedAt = DateTimeOffset.UtcNow.AddMinutes(-3);
        // (GotIt*1 + Close*0.5) / CardsTested * 100 = (2 + 0.5) / 4 * 100 = 62.5
        var attempt = new FlashcardTestAttempt(
            Guid.NewGuid().ToString("N"), deckId, startedAt, DateTimeOffset.UtcNow,
            CardsTested: 4, GotItCount: 2, CloseCount: 1, MissedCount: 1, ScorePct: 62.5);

        await stats.RecordTestAttemptAsync(attempt);

        // FSRS state is byte-for-byte untouched.
        var scheduleAfter = (await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, "a", ct)))!;
        var reviewsAfter = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, deckId, ct));
        Assert.Equal(scheduleBefore.DueDate, scheduleAfter.DueDate);
        Assert.Equal(scheduleBefore.Reps, scheduleAfter.Reps);
        Assert.Equal(scheduleBefore.Lapses, scheduleAfter.Lapses);
        Assert.Equal(scheduleBefore.FsrsState, scheduleAfter.FsrsState);
        Assert.Equal(reviewsBefore, reviewsAfter);

        // Exactly one test-attempt row, with the score preserved.
        var recorded = await h.Store.ReadAsync((c, ct) => h.TestAttempts.GetRecentAsync(c, deckId, 50, ct));
        Assert.Single(recorded);
        Assert.Equal(62.5, recorded[0].ScorePct, 3);

        // The summary reflects the single attempt (first attempt → no previous).
        var summary = await stats.GetTestSummaryAsync(deckId);
        Assert.True(summary.HasAttempts);
        Assert.Equal(1, summary.AttemptCount);
        Assert.Null(summary.DeltaVsPrevious);
        Assert.Equal(62.5, summary.BestScorePct, 3);
    }

    [Fact]
    public async Task Test_SecondAttempt_ExposesDeltaVsPrevious()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var stats = new FlashcardStatsService(h.Store, h.Reviews, h.TestAttempts, h.Decks, h.Presets, h.Clock);
        var now = DateTimeOffset.UtcNow;

        await stats.RecordTestAttemptAsync(new FlashcardTestAttempt(
            "t1", deckId, now.AddMinutes(-20), now.AddMinutes(-19), 4, 2, 0, 2, 50.0));
        await stats.RecordTestAttemptAsync(new FlashcardTestAttempt(
            "t2", deckId, now.AddMinutes(-2), now.AddMinutes(-1), 4, 3, 0, 1, 75.0));

        var summary = await stats.GetTestSummaryAsync(deckId);
        Assert.Equal(2, summary.AttemptCount);
        Assert.Equal(75.0, summary.LatestScorePct, 3);
        Assert.Equal(50.0, summary.PreviousScorePct);
        Assert.Equal(25.0, summary.DeltaVsPrevious!.Value, 3);
        Assert.Equal(75.0, summary.BestScorePct, 3);

        // Trend is chronological (oldest first) for the sparkline.
        var trend = await stats.GetTestTrendAsync(deckId, 10);
        Assert.Equal(new[] { 50.0, 75.0 }, trend.Select(a => a.ScorePct));
    }

    [Fact]
    public async Task Review_LearningStepsAndNewCards_DoNotSpendTheReviewCap()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var study = Study(h);
        await AddReviewCardAsync(h, deckId, "already-in-review");
        await h.AddCardAsync(
            FlashcardStoreHarness.Card("brand-new", deckId, "Front", "Back"),
            FlashcardSchedule.NewFor("brand-new", h.Clock.Now));

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        while (!session.IsFinished)
            await session.GradeAsync(FlashcardReviewGrade.Good);

        var logged = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, deckId, ct));
        var stat = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deckId, h.Clock.TodayKey(FlashcardPreset.DefaultNextDayStartsAtHour), ct));
        // The new card is answered three times on its way through the learning steps, so the
        // session logs four answers in all. Only the card that arrived in review spends the cap.
        Assert.Equal(4, logged);
        Assert.Equal(1, stat.ReviewsDone);
        Assert.Equal(1, stat.NewIntroduced);
    }

    [Fact]
    public async Task Review_LogsTheStateTheCardWasIn_BeforeTheGrade()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var study = Study(h);
        await h.AddCardAsync(
            FlashcardStoreHarness.Card("c1", deckId, "Front", "Back"),
            FlashcardSchedule.NewFor("c1", h.Clock.Now));

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Good); // new card enters the first learning step
        await session.GradeAsync(FlashcardReviewGrade.Good); // and advances to the second

        var pairs = await ReadStatePairsAsync(h, "c1");
        Assert.Equal(
            new (FlashcardFsrsState? Before, FlashcardFsrsState After)[]
            {
                (FlashcardFsrsState.New, FlashcardFsrsState.Learning),
                (FlashcardFsrsState.Learning, FlashcardFsrsState.Learning),
            },
            pairs);
    }

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, h.Facts, new FsrsScheduler(h.Clock), h.Clock);

    private static Task<(FlashcardFsrsState? Before, FlashcardFsrsState After)[]> ReadStatePairsAsync(
        FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT StateBefore, StateAfter FROM FlashcardReviews WHERE CardId = $card ORDER BY Id;";
            cmd.Parameters.AddWithValue("$card", cardId);
            var rows = new List<(FlashcardFsrsState?, FlashcardFsrsState)>();
            await using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                rows.Add((
                    reader.IsDBNull(0) ? null : (FlashcardFsrsState)reader.GetInt32(0),
                    (FlashcardFsrsState)reader.GetInt32(1)));
            }
            return rows.ToArray();
        });

    private static Task AddReviewCardAsync(FlashcardStoreHarness h, string deckId, string id)
    {
        var now = DateTimeOffset.UtcNow;
        var card = FlashcardStoreHarness.Card(id, deckId, $"Front {id}", $"Back {id}");
        var schedule = new FlashcardSchedule(id, now.AddDays(-1), 10, 5, 3, 0, FlashcardFsrsState.Review, 0, now.AddDays(-8));
        return h.AddCardAsync(card, schedule);
    }

    private static Task<double> ReadLatestElapsedDaysAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT ElapsedDays FROM FlashcardReviews WHERE CardId = $card ORDER BY Id DESC LIMIT 1;";
            cmd.Parameters.AddWithValue("$card", cardId);
            var value = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
            return Convert.ToDouble(value);
        });
}
