using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Answering one card off a piece of material holds the rest of it back until the next day, so a
/// reversed pair or a run of deletions is not answered from the memory of the card just seen.
/// </summary>
public sealed class FlashcardBuryTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 5, 9, 30, 0, TimeSpan.Zero);

    [Fact]
    public async Task Answering_one_card_holds_the_rest_of_its_material_back()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h);
        await AddPairAsync(h, deckId, "fact-1", "a1", "a2");
        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));

        Assert.Equal(2, session.Progress.Total);
        await session.GradeAsync(FlashcardReviewGrade.Easy);

        Assert.True(session.IsFinished);
        Assert.Equal(1, session.Progress.Total);
        Assert.Equal(1, session.Progress.Completed);
    }

    [Fact]
    public async Task A_card_off_other_material_is_left_alone()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h);
        await AddPairAsync(h, deckId, "fact-1", "a1", "a2");
        await AddPairAsync(h, deckId, "fact-2", "b1", "b2");

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        var seen = new List<string>();
        while (!session.IsFinished)
        {
            seen.Add(session.Current!.Card.Id);
            await session.GradeAsync(FlashcardReviewGrade.Easy);
        }

        Assert.Equal(new[] { "a1", "b1" }, seen);
    }

    [Fact]
    public async Task The_hold_lasts_until_the_day_turns_over()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h);
        await AddPairAsync(h, deckId, "fact-1", "a1", "a2");

        var study = Study(h);
        var first = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await first.GradeAsync(FlashcardReviewGrade.Easy);

        // Later the same evening the second card is still waiting its turn.
        h.Time.Advance(TimeSpan.FromHours(8));
        var sameDay = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        Assert.True(sameDay.IsFinished);

        // Past four in the morning it is a new day and the card is back.
        h.Time.Advance(TimeSpan.FromHours(12));
        var nextDay = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        Assert.Equal("a2", nextDay.Current!.Card.Id);
    }

    [Fact]
    public async Task The_due_counts_leave_out_what_is_being_held_back()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h);
        await AddPairAsync(h, deckId, "fact-1", "a1", "a2");

        var study = Study(h);
        Assert.Equal(2, (await study.GetDueCountsAsync(deckId)).New);

        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Easy);

        // The banner promises what a session would actually show, so the held card is not counted.
        var after = await study.GetDueCountsAsync(deckId);
        Assert.Equal(0, after.New);
        Assert.Equal(0, after.Total);
    }

    [Fact]
    public async Task Turning_the_setting_off_shows_both_cards()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h, bury: false);
        await AddPairAsync(h, deckId, "fact-1", "a1", "a2");

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Easy);

        Assert.Equal("a2", session.Current!.Card.Id);
        Assert.Equal(2, session.Progress.Total);
    }

    [Fact]
    public async Task Cram_neither_buries_nor_is_held_back()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h);
        await AddPairAsync(h, deckId, "fact-1", "a1", "a2");

        var study = Study(h);
        var review = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await review.GradeAsync(FlashcardReviewGrade.Easy);

        // Someone who asks to go through the deck gets the deck, held cards included, and grading
        // one there writes nothing, so it cannot hold anything back either.
        var cram = await study.StartSessionAsync(
            new FlashcardSessionRequest(deckId, FlashcardSessionMode.Cram, FlashcardSessionScope.All));
        Assert.Equal(2, cram.Progress.Total);
        await cram.GradeAsync(FlashcardReviewGrade.Easy);
        Assert.Equal(2, cram.Progress.Total);
        Assert.NotNull(cram.Current);
    }

    [Fact]
    public async Task Undo_puts_the_held_card_back_in_the_queue_and_in_the_counts()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h);
        await AddPairAsync(h, deckId, "fact-1", "a1", "a2");

        var study = Study(h);
        var session = await study.StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Easy);
        Assert.True(session.IsFinished);

        Assert.True(await session.UndoAsync());

        Assert.Equal("a1", session.Current!.Card.Id);
        Assert.Equal(2, session.Progress.Total);
        Assert.Equal(2, (await study.GetDueCountsAsync(deckId)).New);
    }

    [Fact]
    public async Task Undo_puts_a_held_card_back_where_it_was_going_to_come_up()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h);
        await AddPairAsync(h, deckId, "fact-1", "a1", "a3");
        await AddPairAsync(h, deckId, "fact-2", "a2", "a4");

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Easy); // answers a1, holds a3 back
        await session.UndoAsync();

        var seen = new List<string>();
        while (!session.IsFinished)
        {
            seen.Add(session.Current!.Card.Id);
            await session.GradeAsync(FlashcardReviewGrade.Easy);
        }

        // a1 comes back to the front and a3 to the place it had, so the run picks up unchanged
        // until a1 is answered again.
        Assert.Equal(new[] { "a1", "a2" }, seen);
    }

    [Fact]
    public async Task A_card_with_no_material_behind_it_holds_nothing_back()
    {
        await using var h = new FlashcardStoreHarness(Now);
        var deckId = await SeedAsync(h);
        for (var i = 1; i <= 2; i++)
            await h.AddCardAsync(
                FlashcardStoreHarness.Card($"loose{i}", deckId, $"Q{i}", "A"),
                FlashcardSchedule.NewFor($"loose{i}", Now));

        var session = await Study(h).StartSessionAsync(new FlashcardSessionRequest(deckId, FlashcardSessionMode.Review));
        await session.GradeAsync(FlashcardReviewGrade.Easy);

        Assert.Equal("loose2", session.Current!.Card.Id);
    }

    // --- helpers ---

    private static async Task<string> SeedAsync(FlashcardStoreHarness h, bool bury = true)
    {
        var deckId = await h.SeedDeckAsync();
        await h.Store.WriteAsync((conn, tx, ct) => h.Presets.UpsertAsync(
            conn, tx, FlashcardPreset.CreateStandard(Now) with { BuryRelated = bury }, ct));
        return deckId;
    }

    /// <summary>Two cards off one piece of material, the way a reversed card type makes them.</summary>
    private static async Task AddPairAsync(FlashcardStoreHarness h, string deckId, string factId, string firstId, string secondId)
    {
        await h.Store.WriteAsync((conn, tx, ct) => h.Facts.UpsertAsync(conn, tx, new FlashcardFact(
            Id: factId,
            DeckId: deckId,
            TypeId: FlashcardCardType.BasicId,
            Values: new Dictionary<string, string>
            {
                [FlashcardCardType.BasicFrontFieldId] = firstId,
                [FlashcardCardType.BasicBackFieldId] = secondId,
            },
            Media: new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(),
            Tags: Array.Empty<string>(),
            IsFlagged: false,
            SourceInfo: null,
            CreatedAt: Now,
            UpdatedAt: Now), ct));

        var order = 0;
        foreach (var cardId in new[] { firstId, secondId })
        {
            await h.AddCardAsync(
                FlashcardStoreHarness.Card(cardId, deckId, cardId, "A") with
                {
                    FactId = factId,
                    LayoutKey = order == 0 ? "forward" : "reverse",
                },
                FlashcardSchedule.NewFor(cardId, Now));
            order++;
        }
    }

    private static FlashcardStudyService Study(FlashcardStoreHarness h) =>
        new(h.Store, h.Decks, h.Schedules, h.Presets, h.Reviews, h.DailyStats, h.Cards, h.Facts, new FsrsScheduler(h.Clock), h.Clock);
}
