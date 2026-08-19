using System;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// What happens to a card that keeps being forgotten: when it is marked, what the mark does to the
/// queue, and what undo takes back.
/// </summary>
public sealed class FlashcardLeechTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    [Theory]
    // Nothing happens on the way up to the limit, then on the lapse that reaches it.
    [InlineData(3, 2, false)]
    [InlineData(3, 3, true)]
    // Half the limit again, so a card that is put back and forgotten twice more is raised a second
    // time rather than going quiet for good.
    [InlineData(4, 5, false)]
    [InlineData(4, 6, true)]
    // A limit of one has no half to divide by, so every lapse past it counts.
    [InlineData(1, 1, true)]
    [InlineData(1, 2, true)]
    public void ALapseIsRaised_AtTheLimitAndAtEveryHalfLimitAfterIt(int threshold, int lapses, bool raised)
    {
        var card = FlashcardStoreHarness.Card("c1", "deck-1", "Q", "A");
        var before = Scheduled(lapses - 1);
        var after = Scheduled(lapses);
        var preset = FlashcardPreset.CreateStandard(Now) with { LeechThreshold = threshold };

        Assert.Equal(raised, FlashcardLeech.Evaluate(card, before, after, preset, Now) is not null);
    }

    [Fact]
    public void AGradeThatCostNoLapse_RaisesNothing()
    {
        var card = FlashcardStoreHarness.Card("c1", "deck-1", "Q", "A");
        var preset = FlashcardPreset.CreateStandard(Now) with { LeechThreshold = 3 };

        // Already past the limit, but this answer did not add to the count, so re-raising it would
        // mark the card again on every single answer it ever gets.
        Assert.Null(FlashcardLeech.Evaluate(card, Scheduled(5), Scheduled(5), preset, Now));
    }

    [Fact]
    public async Task TheCardIsTagged_OnTheLapseThatReachesTheLimit()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, threshold: 3, FlashcardLeechAction.Tag);
        await AddLapsingCardAsync(h, deckId, lapses: 2);

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Again);

        var card = await GetCardAsync(h);
        Assert.Contains(FlashcardPreset.LeechTag, card.Tags);
        // Tagging is a label, not a punishment: the card is still studied.
        Assert.Equal(FlashcardCardState.Active, card.State);
    }

    [Fact]
    public async Task UnderTheLimit_TheCardIsLeftAlone()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, threshold: 3, FlashcardLeechAction.Tag);
        await AddLapsingCardAsync(h, deckId, lapses: 1);

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Again);

        Assert.Empty((await GetCardAsync(h)).Tags);
    }

    [Fact]
    public async Task NoAction_LeavesTheCardAloneHoweverOftenItLapses()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, threshold: 3, FlashcardLeechAction.None);
        await AddLapsingCardAsync(h, deckId, lapses: 9);

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Again);

        Assert.Empty((await GetCardAsync(h)).Tags);
    }

    [Fact]
    public async Task Suspending_TakesTheCardOutOfTheSessionRatherThanStepping()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, threshold: 3, FlashcardLeechAction.Suspend);
        await AddLapsingCardAsync(h, deckId, lapses: 2);

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Again);

        var card = await GetCardAsync(h);
        Assert.Equal(FlashcardCardState.Suspended, card.State);
        Assert.Contains(FlashcardPreset.LeechTag, card.Tags);
        // Again puts a review card on a relearning step, which would ordinarily bring it straight
        // back. A card just set aside for lapsing too often does not come back.
        Assert.True(session.IsFinished);
    }

    [Fact]
    public async Task Undo_TakesTheTagAndTheSuspensionBackWithTheLapse()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, threshold: 3, FlashcardLeechAction.Suspend);
        await AddLapsingCardAsync(h, deckId, lapses: 2);

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Again);
        Assert.True(await session.UndoAsync());

        var card = await GetCardAsync(h);
        Assert.Empty(card.Tags);
        Assert.Equal(FlashcardCardState.Active, card.State);
    }

    [Fact]
    public async Task Cram_MarksNothing()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, threshold: 3, FlashcardLeechAction.Suspend);
        await AddLapsingCardAsync(h, deckId, lapses: 2);

        var session = await Study(h).StartSessionAsync(
            new FlashcardSessionRequest(deckId, FlashcardSessionMode.Cram, FlashcardSessionScope.All));
        await session.GradeAsync(FlashcardReviewGrade.Again);

        // Cram persists no schedule, so the lapse it shows is not one the card actually took.
        var card = await GetCardAsync(h);
        Assert.Empty(card.Tags);
        Assert.Equal(FlashcardCardState.Active, card.State);
    }

    [Fact]
    public async Task ThePresetsLimitAndActionSurviveARoundTrip()
    {
        await using var h = new FlashcardStoreHarness(Now);
        await SeedAsync(h, threshold: 12, FlashcardLeechAction.Suspend);

        var stored = await h.Store.ReadAsync((conn, ct) => h.Presets.GetAsync(conn, FlashcardPreset.StandardPresetId, ct));

        Assert.Equal(12, stored!.LeechThreshold);
        Assert.Equal(FlashcardLeechAction.Suspend, stored.LeechAction);
    }

    // --- helpers ---

    private static FlashcardSchedule Scheduled(int lapses) =>
        new("c1", Now, 6d, 5d, lapses + 1, lapses, FlashcardFsrsState.Review, 0, Now.AddDays(-1));

    private static async Task<string> SeedAsync(FlashcardStoreHarness h, int threshold, FlashcardLeechAction action)
    {
        var deckId = await h.SeedDeckAsync();
        await h.Store.WriteAsync((conn, tx, ct) => h.Presets.UpsertAsync(
            conn, tx,
            FlashcardPreset.CreateStandard(Now) with { LeechThreshold = threshold, LeechAction = action },
            ct));
        return deckId;
    }

    /// <summary>A review card already at <paramref name="lapses"/>, due now, so one Again adds one.</summary>
    private static Task AddLapsingCardAsync(FlashcardStoreHarness h, string deckId, int lapses) =>
        h.AddCardAsync(
            FlashcardStoreHarness.Card("c1", deckId, "Q", "A"),
            new FlashcardSchedule("c1", Now.AddMinutes(-1), 6d, 5d, lapses + 1, lapses, FlashcardFsrsState.Review, 0, Now.AddDays(-3)));

    private static async Task<Flashcard> GetCardAsync(FlashcardStoreHarness h) =>
        (await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, "c1", ct)))!;

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, h.Facts, new FsrsScheduler(h.Clock), h.Clock);
}
