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
    private static readonly FlashcardPreset Preset = FlashcardPreset.CreateStandard(DateTimeOffset.UtcNow);
    private readonly FsrsScheduler _scheduler = new();

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
        Assert.True((next.DueDate - now).TotalDays >= 1);
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
        Assert.True((graduated.DueDate - now).TotalDays >= 1);
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
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks);
        var lib = new FlashcardLibraryService(h.Store, h.Folders, h.Decks, h.Cards, h.Schedules, h.Reviews, h.DailyStats, h.Presets);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules);
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

        var stat = await h.Store.ReadAsync((c, ct) => h.DailyStats.GetAsync(c, deck.Id, FlashcardLocalDay.Today(), ct));
        Assert.Equal(2, stat.NewIntroduced);
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

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, new FsrsScheduler());

    private static Task AddReviewCardAsync(FlashcardStoreHarness h, string deckId, string id)
    {
        var now = DateTimeOffset.UtcNow;
        var card = FlashcardStoreHarness.Card(id, deckId, $"Front {id}", $"Back {id}");
        var schedule = new FlashcardSchedule(id, now.AddDays(-1), 10, 5, 3, 0, FlashcardFsrsState.Review, 0, now.AddDays(-8));
        return h.AddCardAsync(card, schedule);
    }
}
