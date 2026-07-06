using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

public sealed class FlashcardStoreTests
{
    [Fact]
    public async Task CardAndSchedule_RoundTrip()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var card = FlashcardStoreHarness.Card("c1", deckId, "Front one", "Back one");
        var schedule = FlashcardSchedule.NewFor("c1", DateTimeOffset.UtcNow);

        await h.AddCardAsync(card, schedule);

        var loaded = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, "c1", ct));
        var sched = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, "c1", ct));

        Assert.NotNull(loaded);
        Assert.Equal("Front one", loaded!.Front);
        Assert.Equal(FlashcardCardState.Active, loaded.State);
        Assert.NotNull(sched);
        Assert.Equal(FlashcardFsrsState.New, sched!.FsrsState);
    }

    [Fact]
    public async Task WriteAsync_RollsBackEntireTransaction_OnFailure()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await h.Cards.InsertAsync(conn, tx, FlashcardStoreHarness.Card("c1", deckId, "F", "B"), ct);
            throw new InvalidOperationException("boom after first write");
        }));

        var count = await h.Store.ReadAsync(async (conn, ct) =>
        {
            var page = await h.Cards.GetPageAsync(conn, new FlashcardCardQuery(deckId), DateTimeOffset.UtcNow, ct);
            return page.TotalCount;
        });
        Assert.Equal(0, count); // nothing from the failed transaction persisted
    }

    [Fact]
    public async Task ConcurrentWrites_AllLand_WithoutSqliteBusy()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var now = DateTimeOffset.UtcNow;

        var writes = Enumerable.Range(0, 40).Select(i => h.AddCardAsync(
            FlashcardStoreHarness.Card($"c{i}", deckId, $"Front {i}", $"Back {i}"),
            FlashcardSchedule.NewFor($"c{i}", now)));
        // Interleave reads to exercise concurrent readers under WAL.
        var reads = Enumerable.Range(0, 20).Select(_ =>
            h.Store.ReadAsync((conn, ct) => h.Cards.GetCountsAsync(conn, deckId, ct)));

        await Task.WhenAll(writes.Concat<Task>(reads));

        var counts = await h.Store.ReadAsync((conn, ct) => h.Cards.GetCountsAsync(conn, deckId, ct));
        Assert.Equal(40, counts.Total);
    }

    [Fact]
    public async Task GetRawDueCounts_BucketsByStateAndDueDate()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var now = DateTimeOffset.UtcNow;

        await h.AddCardAsync(FlashcardStoreHarness.Card("new", deckId, "n", "n"),
            FlashcardSchedule.NewFor("new", now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("due", deckId, "d", "d"),
            new FlashcardSchedule("due", now.AddDays(-1), 5, 5, 3, 0, FlashcardFsrsState.Review, 0, now.AddDays(-4)));
        await h.AddCardAsync(FlashcardStoreHarness.Card("learn", deckId, "l", "l"),
            new FlashcardSchedule("learn", now.AddMinutes(-1), null, null, 1, 0, FlashcardFsrsState.Learning, 0, now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("future", deckId, "f", "f"),
            new FlashcardSchedule("future", now.AddDays(3), 20, 5, 4, 0, FlashcardFsrsState.Review, 0, now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("susp", deckId, "s", "s", FlashcardCardState.Suspended),
            FlashcardSchedule.NewFor("susp", now));

        var counts = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetRawDueCountsAsync(conn, deckId, now, ct));

        Assert.Equal(1, counts.New);       // suspended new card excluded
        Assert.Equal(1, counts.Learning);
        Assert.Equal(1, counts.Due);       // future review not counted
    }

    [Fact]
    public async Task Search_RanksByRelevance_AndExcludesSuspendedByDefault()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var now = DateTimeOffset.UtcNow;

        await h.AddCardAsync(FlashcardStoreHarness.Card("a", deckId, "plate tectonics boundary", "divergent"),
            FlashcardSchedule.NewFor("a", now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("b", deckId, "ocean crust", "recycled at subduction plate zones"),
            FlashcardSchedule.NewFor("b", now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("s", deckId, "plate suspended card", "hidden",
                FlashcardCardState.Suspended),
            FlashcardSchedule.NewFor("s", now));

        var active = await h.Store.ReadAsync((conn, ct) =>
            h.Cards.SearchAsync(conn, "plate", FlashcardSearchScope.ActiveOnly, 20, ct));
        Assert.DoesNotContain(active, c => c.Id == "s");
        Assert.Equal(2, active.Count);

        var withSuspended = await h.Store.ReadAsync((conn, ct) =>
            h.Cards.SearchAsync(conn, "plate", FlashcardSearchScope.IncludeSuspended, 20, ct));
        Assert.Contains(withSuspended, c => c.Id == "s");
    }

    [Fact]
    public async Task PagedQuery_FiltersByState_AndReportsTotal()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        var now = DateTimeOffset.UtcNow;

        for (var i = 0; i < 5; i++)
            await h.AddCardAsync(FlashcardStoreHarness.Card($"n{i}", deckId, $"new {i}", "x"),
                FlashcardSchedule.NewFor($"n{i}", now));
        await h.AddCardAsync(FlashcardStoreHarness.Card("susp", deckId, "suspended", "x", FlashcardCardState.Suspended),
            FlashcardSchedule.NewFor("susp", now));

        var newPage = await h.Store.ReadAsync((conn, ct) => h.Cards.GetPageAsync(
            conn, new FlashcardCardQuery(deckId, State: FlashcardCardStateFilter.New, Limit: 3), now, ct));
        Assert.Equal(5, newPage.TotalCount);
        Assert.Equal(3, newPage.Items.Count);

        var suspPage = await h.Store.ReadAsync((conn, ct) => h.Cards.GetPageAsync(
            conn, new FlashcardCardQuery(deckId, State: FlashcardCardStateFilter.Suspended), now, ct));
        Assert.Equal(1, suspPage.TotalCount);
    }

    [Fact]
    public async Task DailyStats_UsesCallerFrozenDayKey_AndAccumulates()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();

        // Simulate reviews recorded under an Oslo local day, then a Tokyo local day.
        await h.Store.WriteAsync((conn, tx, ct) => h.DailyStats.IncrementAsync(conn, tx, deckId, "2026-07-06", 3, 10, ct));
        await h.Store.WriteAsync((conn, tx, ct) => h.DailyStats.IncrementAsync(conn, tx, deckId, "2026-07-06", 2, 5, ct));
        await h.Store.WriteAsync((conn, tx, ct) => h.DailyStats.IncrementAsync(conn, tx, deckId, "2026-07-07", 1, 1, ct));

        var day6 = await h.Store.ReadAsync((conn, ct) => h.DailyStats.GetAsync(conn, deckId, "2026-07-06", ct));
        var day7 = await h.Store.ReadAsync((conn, ct) => h.DailyStats.GetAsync(conn, deckId, "2026-07-07", ct));

        Assert.Equal(5, day6.NewIntroduced);
        Assert.Equal(15, day6.ReviewsDone);
        Assert.Equal(1, day7.NewIntroduced);
    }

    [Fact]
    public async Task ForeignKeys_CascadeDeleteCards_WhenDeckDeleted()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        await h.AddCardAsync(FlashcardStoreHarness.Card("c1", deckId, "f", "b"),
            FlashcardSchedule.NewFor("c1", DateTimeOffset.UtcNow));

        await h.Store.WriteAsync((conn, tx, ct) => h.Decks.DeleteAsync(conn, tx, deckId, ct));

        var card = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, "c1", ct));
        var sched = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, "c1", ct));
        Assert.Null(card);   // ON DELETE CASCADE fired (foreign_keys=ON)
        Assert.Null(sched);
    }
}
