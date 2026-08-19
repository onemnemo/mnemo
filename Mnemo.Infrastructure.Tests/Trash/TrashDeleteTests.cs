using System;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Trash;

public sealed class TrashDeleteTests
{
    [Fact]
    public async Task Delete_hides_the_item_and_holds_an_entry()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji", origin: "Japanese", containedCount: 3);

        var action = await harness.DeleteNoteAsync("n1");

        var entry = Assert.Single(action.Entries);
        Assert.Equal(TrashEntryState.Held, entry.State);
        Assert.Equal("Kanji", entry.Title);
        Assert.Equal("Japanese", entry.Origin);
        Assert.Equal(3, entry.ContainedCount);
        Assert.Equal(0, action.SkippedCount);
        Assert.False(harness.Notes.IsLive("n1"));
        Assert.Equal(1, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task Deleted_item_expires_thirty_days_later()
    {
        var now = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);
        await using var harness = new TrashTestHarness(now);
        harness.Notes.AddLive("n1", "Kanji");

        var action = await harness.DeleteNoteAsync("n1");

        var entry = Assert.Single(action.Entries);
        Assert.Equal(now, entry.DeletedAt);
        Assert.Equal(now.AddDays(30), entry.ExpiresAt);
    }

    [Fact]
    public async Task Deleting_something_already_held_never_extends_its_retention()
    {
        var now = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);
        await using var harness = new TrashTestHarness(now);
        harness.Notes.AddLive("n1", "Kanji");

        var first = await harness.DeleteNoteAsync("n1");
        harness.Time.Advance(TimeSpan.FromDays(10));
        var second = await harness.DeleteNoteAsync("n1");

        var original = Assert.Single(first.Entries);
        var repeated = Assert.Single(second.Entries);
        Assert.Equal(original.Id, repeated.Id);
        Assert.Equal(original.BatchId, repeated.BatchId);
        Assert.Equal(original.ExpiresAt, repeated.ExpiresAt);
        Assert.Equal(1, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task Selecting_the_same_item_twice_produces_one_entry()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");

        var action = await harness.Service.DeleteAsync(
        [
            new TrashDeleteRequest(TrashTestHarness.NoteKind, "n1"),
            new TrashDeleteRequest(TrashTestHarness.NoteKind, "n1"),
        ]);

        Assert.Single(action.Entries);
        Assert.Equal(1, action.SkippedCount);
    }

    [Fact]
    public async Task An_item_that_is_not_live_is_skipped()
    {
        await using var harness = new TrashTestHarness();

        var action = await harness.DeleteNoteAsync("gone");

        Assert.Empty(action.Entries);
        Assert.Equal(1, action.SkippedCount);
        Assert.Equal(0, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task An_item_that_stops_being_live_during_capture_leaves_no_ledger_row()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        harness.Notes.VanishBeforeCapture.Add("n1");

        var action = await harness.DeleteNoteAsync("n1");

        Assert.Empty(action.Entries);
        Assert.Equal(1, action.SkippedCount);
        Assert.Null(await harness.Store.FindByItemAsync(TrashTestHarness.NoteKind, "n1"));
    }

    [Fact]
    public async Task A_failure_after_the_module_commits_still_produces_a_held_entry()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji", origin: "Japanese", containedCount: 2);
        harness.Notes.CaptureCommits = true;
        harness.Notes.CaptureFailure = new InvalidOperationException("connection dropped after commit");

        var action = await harness.DeleteNoteAsync("n1");

        var entry = Assert.Single(action.Entries);
        Assert.Equal(TrashEntryState.Held, entry.State);

        // The preparation snapshot is what the module ended up holding.
        Assert.Equal("Kanji", entry.Title);
        Assert.Equal("Japanese", entry.Origin);
        Assert.Equal(2, entry.ContainedCount);
        Assert.Equal(1, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task A_failure_before_the_module_commits_leaves_nothing_behind()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        harness.Notes.CaptureFailure = new InvalidOperationException("write failed");

        await Assert.ThrowsAsync<InvalidOperationException>(() => harness.DeleteNoteAsync("n1"));

        Assert.Null(await harness.Store.FindByItemAsync(TrashTestHarness.NoteKind, "n1"));
        Assert.True(harness.Notes.IsLive("n1"));
    }

    [Fact]
    public async Task A_module_that_cannot_say_what_it_holds_leaves_the_row_for_reconciliation()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        harness.Notes.CaptureFailure = new InvalidOperationException("write failed");
        harness.Notes.HoldsFailure = new InvalidOperationException("database is locked");

        await Assert.ThrowsAsync<TrashSourceUnavailableException>(() => harness.DeleteNoteAsync("n1"));

        var row = await harness.Store.FindByItemAsync(TrashTestHarness.NoteKind, "n1");
        Assert.NotNull(row);
        Assert.Equal(TrashEntryState.Prepared, row.State);

        // A prepared row is invisible, so something has to come along and resolve it.
        Assert.Equal(0, await harness.Service.CountAsync());
        Assert.Equal(1, harness.Maintenance.ReconciliationRequests);
    }

    [Fact]
    public async Task A_kind_no_module_owns_changes_nothing_at_all()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");

        await Assert.ThrowsAsync<UnknownTrashKindException>(() => harness.Service.DeleteAsync(
        [
            new TrashDeleteRequest(TrashTestHarness.NoteKind, "n1"),
            new TrashDeleteRequest("mindmap", "m1"),
        ]));

        Assert.True(harness.Notes.IsLive("n1"));
        Assert.Equal(0, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task One_action_over_two_modules_shares_a_batch()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        harness.Decks.AddLive("d1", "JLPT N5");

        var action = await harness.Service.DeleteAsync(
        [
            new TrashDeleteRequest(TrashTestHarness.NoteKind, "n1"),
            new TrashDeleteRequest(TrashTestHarness.DeckKind, "d1"),
        ]);

        Assert.Equal(2, action.Entries.Count);
        Assert.All(action.Entries, e => Assert.Equal(action.BatchId, e.BatchId));
    }
}
