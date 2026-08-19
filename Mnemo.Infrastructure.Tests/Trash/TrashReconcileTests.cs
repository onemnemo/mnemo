using System;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Infrastructure.Tests.Trash;

/// <summary>
/// What the application does about the states an interrupted operation leaves in the database.
/// Every test here plants such a state directly and then starts the trash over it.
/// </summary>
public sealed class TrashReconcileTests
{
    [Fact]
    public async Task A_hidden_item_whose_entry_never_finished_becomes_recoverable()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        harness.Notes.MarkHeld("n1", "e1");
        await harness.Store.InsertAsync(Row(TrashTestHarness.NoteKind, "n1", TrashEntryState.Prepared, "e1"));

        await harness.Service.ReconcileAsync();

        var row = await harness.RowAsync("e1");
        Assert.NotNull(row);
        Assert.Equal(TrashEntryState.Held, row.State);
        Assert.Equal(1, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task An_entry_that_never_reached_its_module_is_forgotten()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        await harness.Store.InsertAsync(Row(TrashTestHarness.NoteKind, "n1", TrashEntryState.Prepared, "e1"));

        await harness.Service.ReconcileAsync();

        Assert.Null(await harness.RowAsync("e1"));
        Assert.True(harness.Notes.IsLive("n1"));
    }

    [Fact]
    public async Task An_entry_for_content_that_is_already_back_is_forgotten()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        await harness.Store.InsertAsync(Row(TrashTestHarness.NoteKind, "n1", TrashEntryState.Held, "e1"));

        await harness.Service.ReconcileAsync();

        Assert.Null(await harness.RowAsync("e1"));
        Assert.Equal(0, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task A_destruction_that_was_interrupted_is_finished()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        harness.Notes.MarkHeld("n1", "e1");
        await harness.Store.InsertAsync(Row(TrashTestHarness.NoteKind, "n1", TrashEntryState.Purging, "e1"));

        await harness.Service.ReconcileAsync();

        Assert.Equal(["n1"], harness.Notes.Purged);
        Assert.Null(await harness.RowAsync("e1"));
        Assert.Equal(1, harness.Maintenance.AssetCleanupRequests);
    }

    [Fact]
    public async Task Hidden_content_that_nothing_explains_comes_back()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.AddLive("n1", "Kanji");
        harness.Notes.MarkHeld("n1", "orphan");

        await harness.Service.ReconcileAsync();

        Assert.Equal(["orphan"], harness.Notes.Released);
        Assert.True(harness.Notes.IsLive("n1"));
    }

    [Fact]
    public async Task An_entry_from_a_module_this_build_does_not_ship_is_preserved()
    {
        await using var harness = new TrashTestHarness();
        await harness.Store.InsertAsync(Row("mindmap", "m1", TrashEntryState.Held, "e1"));

        await harness.Service.ReconcileAsync();

        Assert.NotNull(await harness.RowAsync("e1"));

        var page = await harness.Service.ListAsync(new TrashListQuery());
        var listing = Assert.Single(page.Entries);
        Assert.Equal("mindmap", listing.Entry.Kind);
        Assert.False(listing.SourceAvailable);
    }

    [Fact]
    public async Task One_module_that_cannot_answer_does_not_stop_the_others()
    {
        await using var harness = new TrashTestHarness();
        harness.Notes.HeldEntryIdsFailure = new InvalidOperationException("database is locked");
        harness.Decks.AddLive("d1", "JLPT N5");
        harness.Decks.MarkHeld("d1", "orphan");

        await harness.Service.ReconcileAsync();

        Assert.Equal(["orphan"], harness.Decks.Released);
        Assert.True(harness.Decks.IsLive("d1"));
    }

    private static TrashEntry Row(string kind, string itemId, TrashEntryState state, string entryId)
    {
        var deletedAt = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);
        return new TrashEntry
        {
            Id = entryId,
            Kind = kind,
            ItemId = itemId,
            Title = itemId,
            BatchId = "batch",
            State = state,
            DeletedAt = deletedAt,
            ExpiresAt = TrashRetention.ExpiresAt(deletedAt),
        };
    }
}
