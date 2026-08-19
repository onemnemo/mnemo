using System;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Trash;

public sealed class TrashPurgeTests
{
    [Fact]
    public async Task Destroying_an_entry_removes_it_and_asks_for_the_files_to_go()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);

        var result = await harness.Service.PurgeAsync(entry.Id);

        Assert.True(result.Purged);
        Assert.Equal("Kanji", result.Title);
        Assert.Equal(["n1"], harness.Notes.Purged);
        Assert.Null(await harness.RowAsync(entry.Id));
        Assert.Equal(1, harness.Maintenance.AssetCleanupRequests);
    }

    [Fact]
    public async Task Destroying_something_that_is_already_gone_reports_done()
    {
        await using var harness = new TrashTestHarness();

        var result = await harness.Service.PurgeAsync("nothing");

        Assert.True(result.Purged);
        Assert.Empty(result.BlockingEntryIds);
    }

    [Fact]
    public async Task An_entry_other_entries_depend_on_survives_and_names_them()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);
        harness.Notes.PurgeBlockers = ["child-entry"];

        var result = await harness.Service.PurgeAsync(entry.Id);

        Assert.False(result.Purged);
        Assert.Equal(["child-entry"], result.BlockingEntryIds);

        var row = await harness.RowAsync(entry.Id);
        Assert.NotNull(row);
        Assert.Equal(TrashEntryState.Held, row.State);
        Assert.Empty(harness.Notes.Purged);
        Assert.Equal(0, harness.Maintenance.AssetCleanupRequests);
    }

    [Fact]
    public async Task A_failure_after_the_module_commits_completes_the_destruction()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);
        harness.Notes.PurgeCommits = true;
        harness.Notes.PurgeFailure = new InvalidOperationException("connection dropped after commit");

        var result = await harness.Service.PurgeAsync(entry.Id);

        Assert.True(result.Purged);
        Assert.Null(await harness.RowAsync(entry.Id));
        Assert.Equal(["n1"], harness.Notes.Purged);
    }

    [Fact]
    public async Task A_failure_before_the_module_commits_leaves_the_item_recoverable()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);
        harness.Notes.PurgeFailure = new InvalidOperationException("write failed");

        await Assert.ThrowsAsync<InvalidOperationException>(() => harness.Service.PurgeAsync(entry.Id));

        var row = await harness.RowAsync(entry.Id);
        Assert.NotNull(row);
        Assert.Equal(TrashEntryState.Held, row.State);
        Assert.Equal(1, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task A_module_that_cannot_say_what_it_holds_leaves_the_row_mid_destruction()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);
        harness.Notes.PurgeFailure = new InvalidOperationException("write failed");
        harness.Notes.HoldsFailure = new InvalidOperationException("database is locked");

        await Assert.ThrowsAsync<TrashSourceUnavailableException>(() => harness.Service.PurgeAsync(entry.Id));

        var row = await harness.RowAsync(entry.Id);
        Assert.NotNull(row);
        Assert.Equal(TrashEntryState.Purging, row.State);

        // A row mid-destruction is never offered back to a person as recoverable.
        Assert.Equal(0, await harness.Service.CountAsync());
        Assert.Equal(1, harness.Maintenance.ReconciliationRequests);
    }

    [Fact]
    public async Task Emptying_destroys_the_oldest_first()
    {
        var now = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);
        await using var harness = new TrashTestHarness(now);
        harness.Notes.AddLive("n1", "First").AddLive("n2", "Second").AddLive("n3", "Third");

        await harness.DeleteNoteAsync("n1");
        harness.Time.Advance(TimeSpan.FromHours(1));
        await harness.DeleteNoteAsync("n2");
        harness.Time.Advance(TimeSpan.FromHours(1));
        await harness.DeleteNoteAsync("n3");

        var result = await harness.Service.EmptyAsync();

        Assert.Equal(3, result.PurgedCount);
        Assert.Empty(result.Blocked);
        Assert.Equal(["n1", "n2", "n3"], harness.Notes.Purged);
        Assert.Equal(0, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task Emptying_keeps_what_it_could_not_destroy()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        harness.Decks.AddLive("d1", "JLPT N5");
        await harness.DeleteNoteAsync("n1");
        await harness.Service.DeleteAsync([new TrashDeleteRequest(TrashTestHarness.DeckKind, "d1")]);
        harness.Decks.PurgeBlockers = ["some-card-entry"];

        var result = await harness.Service.EmptyAsync();

        Assert.Equal(1, result.PurgedCount);
        var blocked = Assert.Single(result.Blocked);
        Assert.Equal("JLPT N5", blocked.Title);
        Assert.Equal(["some-card-entry"], blocked.BlockingEntryIds);

        // The page does not get to look empty by dropping what it failed to destroy.
        Assert.Equal(1, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task Expiry_destroys_only_what_has_run_out_of_time()
    {
        var now = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);
        await using var harness = new TrashTestHarness(now);
        harness.Notes.AddLive("old", "Old").AddLive("recent", "Recent");

        await harness.DeleteNoteAsync("old");
        harness.Time.Advance(TimeSpan.FromDays(10));
        await harness.DeleteNoteAsync("recent");

        harness.Time.AdvanceTo(now.AddDays(31));
        var purged = await harness.Service.SweepExpiredAsync();

        Assert.Equal(1, purged);
        Assert.Equal(["old"], harness.Notes.Purged);
        Assert.Equal(1, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task Nothing_expires_before_its_time()
    {
        var now = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);
        await using var harness = new TrashTestHarness(now);
        harness.Notes.AddLive("n1", "Kanji");
        await harness.DeleteNoteAsync("n1");

        harness.Time.AdvanceTo(now.AddDays(29).AddHours(23));
        var purged = await harness.Service.SweepExpiredAsync();

        Assert.Equal(0, purged);
        Assert.Equal(1, await harness.Service.CountAsync());
        Assert.Equal(0, harness.Maintenance.AssetCleanupRequests);
    }
}
