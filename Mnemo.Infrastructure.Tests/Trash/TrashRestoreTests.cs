using System;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Trash;

public sealed class TrashRestoreTests
{
    [Fact]
    public async Task Restore_brings_the_item_back_and_empties_the_ledger()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);

        var results = await harness.Service.RestoreAsync([entry.Id]);

        var result = Assert.Single(results);
        Assert.Equal(TrashRestoreOutcome.Restored, result.Outcome);
        Assert.Equal("Kanji", result.Title);
        Assert.True(harness.Notes.IsLive("n1"));
        Assert.Null(await harness.RowAsync(entry.Id));
        Assert.Equal(0, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task Restoring_an_entry_that_never_existed_reports_missing()
    {
        await using var harness = new TrashTestHarness();

        var result = Assert.Single(await harness.Service.RestoreAsync(["nothing"]));

        Assert.Equal(TrashRestoreOutcome.Missing, result.Outcome);
    }

    [Fact]
    public async Task A_ledger_row_the_module_no_longer_holds_is_cleared_away()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);

        // The module let the item go without the coordinator knowing, which is what an interrupted
        // restore leaves behind.
        await harness.Notes.ReleaseAsync([entry.Id]);

        var result = Assert.Single(await harness.Service.RestoreAsync([entry.Id]));

        Assert.Equal(TrashRestoreOutcome.Missing, result.Outcome);
        Assert.Null(await harness.RowAsync(entry.Id));
    }

    [Fact]
    public async Task An_entry_needing_a_destination_stays_held_while_its_neighbour_returns()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        harness.Decks.AddLive("d1", "JLPT N5");
        var action = await harness.Service.DeleteAsync(
        [
            new TrashDeleteRequest(TrashTestHarness.NoteKind, "n1"),
            new TrashDeleteRequest(TrashTestHarness.DeckKind, "d1"),
        ]);
        harness.Notes.RestoreOutcome = TrashRestoreOutcome.DestinationRequired;

        var results = await harness.Service.RestoreAsync(action.Entries.Select(e => e.Id).ToList());

        var note = results.Single(r => r.Kind == TrashTestHarness.NoteKind);
        var deck = results.Single(r => r.Kind == TrashTestHarness.DeckKind);
        Assert.Equal(TrashRestoreOutcome.DestinationRequired, note.Outcome);
        Assert.Equal(TrashRestoreOutcome.Restored, deck.Outcome);

        // Partial completion: the note is still recoverable and still counted.
        Assert.Equal(1, await harness.Service.CountAsync());
        Assert.True(harness.Decks.IsLive("d1"));
        Assert.False(harness.Notes.IsLive("n1"));
    }

    [Fact]
    public async Task Retrying_with_a_destination_puts_the_item_there()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);
        harness.Notes.RestoreOutcome = TrashRestoreOutcome.DestinationRequired;

        var blocked = Assert.Single(await harness.Service.RestoreAsync([entry.Id]));
        Assert.Equal(TrashRestoreOutcome.DestinationRequired, blocked.Outcome);

        var retried = Assert.Single(
            await harness.Service.RestoreAsync([entry.Id], new TrashRestoreTarget("deck-live")));

        Assert.Equal(TrashRestoreOutcome.Restored, retried.Outcome);
        Assert.Equal("deck-live", retried.DestinationId);
        Assert.Null(await harness.RowAsync(entry.Id));
    }

    [Fact]
    public async Task An_entry_whose_container_is_itself_held_stays_recoverable()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);
        harness.Notes.RestoreOutcome = TrashRestoreOutcome.BlockedByContainer;

        var result = Assert.Single(await harness.Service.RestoreAsync([entry.Id]));

        Assert.Equal(TrashRestoreOutcome.BlockedByContainer, result.Outcome);
        Assert.NotNull(await harness.RowAsync(entry.Id));
        Assert.Equal(1, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task A_failure_after_the_module_commits_still_counts_as_restored()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);
        harness.Notes.RestoreCommits = true;
        harness.Notes.RestoreFailure = new InvalidOperationException("connection dropped after commit");

        var result = Assert.Single(await harness.Service.RestoreAsync([entry.Id]));

        Assert.Equal(TrashRestoreOutcome.Restored, result.Outcome);
        Assert.True(harness.Notes.IsLive("n1"));
        Assert.Null(await harness.RowAsync(entry.Id));
    }

    [Fact]
    public async Task A_failure_before_the_module_commits_keeps_the_item_recoverable()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);
        harness.Notes.RestoreFailure = new InvalidOperationException("write failed");

        await Assert.ThrowsAsync<InvalidOperationException>(() => harness.Service.RestoreAsync([entry.Id]));

        var row = await harness.RowAsync(entry.Id);
        Assert.NotNull(row);
        Assert.Equal(TrashEntryState.Held, row.State);
        Assert.False(harness.Notes.IsLive("n1"));
    }

    [Fact]
    public async Task A_module_that_cannot_say_what_it_holds_leaves_the_entry_alone()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        var entry = Assert.Single((await harness.DeleteNoteAsync("n1")).Entries);
        harness.Notes.RestoreFailure = new InvalidOperationException("write failed");
        harness.Notes.HoldsFailure = new InvalidOperationException("database is locked");

        await Assert.ThrowsAsync<TrashSourceUnavailableException>(
            () => harness.Service.RestoreAsync([entry.Id]));

        var row = await harness.RowAsync(entry.Id);
        Assert.NotNull(row);
        Assert.Equal(TrashEntryState.Held, row.State);
        Assert.Equal(1, harness.Maintenance.ReconciliationRequests);
    }

    [Fact]
    public async Task Undo_puts_back_everything_one_action_took()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji").AddLive("n2", "Hiragana");
        harness.Decks.AddLive("d1", "JLPT N5");
        var action = await harness.Service.DeleteAsync(
        [
            new TrashDeleteRequest(TrashTestHarness.NoteKind, "n1"),
            new TrashDeleteRequest(TrashTestHarness.NoteKind, "n2"),
            new TrashDeleteRequest(TrashTestHarness.DeckKind, "d1"),
        ]);

        var results = await harness.Service.RestoreBatchAsync(action.BatchId);

        Assert.Equal(3, results.Count);
        Assert.All(results, r => Assert.Equal(TrashRestoreOutcome.Restored, r.Outcome));
        Assert.Equal(0, await harness.Service.CountAsync());
        Assert.True(harness.Notes.IsLive("n1"));
        Assert.True(harness.Notes.IsLive("n2"));
        Assert.True(harness.Decks.IsLive("d1"));
    }

    [Fact]
    public async Task Undo_leaves_alone_what_a_later_action_took()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji").AddLive("n2", "Hiragana");
        var first = await harness.DeleteNoteAsync("n1");
        await harness.DeleteNoteAsync("n2");

        await harness.Service.RestoreBatchAsync(first.BatchId);

        Assert.True(harness.Notes.IsLive("n1"));
        Assert.False(harness.Notes.IsLive("n2"));
        Assert.Equal(1, await harness.Service.CountAsync());
    }
}
