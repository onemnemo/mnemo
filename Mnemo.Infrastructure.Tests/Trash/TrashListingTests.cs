using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Infrastructure.Tests.Trash;

public sealed class TrashListingTests
{
    private static readonly DateTimeOffset Origin = new(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task The_most_recently_deleted_comes_first()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "First").AddLive("n2", "Second").AddLive("n3", "Third");
        await DeleteInOrderAsync(harness, "n1", "n2", "n3");

        var titles = (await harness.HeldAsync()).Select(e => e.Title).ToList();

        Assert.Equal(["Third", "Second", "First"], titles);
    }

    [Fact]
    public async Task Paging_reaches_every_entry_exactly_once()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "First").AddLive("n2", "Second").AddLive("n3", "Third")
            .AddLive("n4", "Fourth").AddLive("n5", "Fifth");
        await DeleteInOrderAsync(harness, "n1", "n2", "n3", "n4", "n5");

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await harness.Service.ListAsync(new TrashListQuery(cursor, 2));
            seen.AddRange(page.Entries.Select(e => e.Entry.Title));
            cursor = page.NextCursor;
        }
        while (cursor is not null);

        Assert.Equal(["Fifth", "Fourth", "Third", "Second", "First"], seen);
    }

    [Fact]
    public async Task An_entry_leaving_an_earlier_page_does_not_hide_a_later_one()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "First").AddLive("n2", "Second").AddLive("n3", "Third")
            .AddLive("n4", "Fourth").AddLive("n5", "Fifth");
        await DeleteInOrderAsync(harness, "n1", "n2", "n3", "n4", "n5");

        var first = await harness.Service.ListAsync(new TrashListQuery(Limit: 2));
        Assert.Equal(["Fifth", "Fourth"], first.Entries.Select(e => e.Entry.Title));

        // Someone recovers an entry from the page already read, which is what a shrinking list does
        // to a position counted from the start.
        await harness.Service.RestoreAsync([first.Entries[0].Entry.Id]);

        var seen = new List<string>();
        var cursor = first.NextCursor;
        while (cursor is not null)
        {
            var page = await harness.Service.ListAsync(new TrashListQuery(cursor, 2));
            seen.AddRange(page.Entries.Select(e => e.Entry.Title));
            cursor = page.NextCursor;
        }

        Assert.Equal(["Third", "Second", "First"], seen);
    }

    [Fact]
    public async Task A_page_that_ends_the_list_offers_nowhere_further()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "First").AddLive("n2", "Second");
        await DeleteInOrderAsync(harness, "n1", "n2");

        var page = await harness.Service.ListAsync(new TrashListQuery(Limit: 2));

        Assert.Equal(2, page.Entries.Count);
        Assert.Null(page.NextCursor);
    }

    [Fact]
    public async Task A_cursor_that_means_nothing_starts_the_list_over()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "First");
        await DeleteInOrderAsync(harness, "n1");

        var page = await harness.Service.ListAsync(new TrashListQuery("not-a-cursor"));

        Assert.Single(page.Entries);
    }

    [Fact]
    public async Task Search_ignores_case_outside_the_english_alphabet()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "Ølnotater").AddLive("n2", "Kanji");
        await DeleteInOrderAsync(harness, "n1", "n2");

        var upper = await harness.Service.ListAsync(new TrashListQuery(Query: "ØLNOTATER"));
        var lower = await harness.Service.ListAsync(new TrashListQuery(Query: "ølnotater"));

        Assert.Equal("Ølnotater", Assert.Single(upper.Entries).Entry.Title);
        Assert.Equal("Ølnotater", Assert.Single(lower.Entries).Entry.Title);
    }

    [Fact]
    public async Task Search_matches_part_of_a_title()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "Weekly review").AddLive("n2", "Kanji");
        await DeleteInOrderAsync(harness, "n1", "n2");

        var page = await harness.Service.ListAsync(new TrashListQuery(Query: "eekly"));

        Assert.Equal("Weekly review", Assert.Single(page.Entries).Entry.Title);
    }

    [Fact]
    public async Task Filtering_by_kind_leaves_the_other_modules_out()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "Kanji");
        harness.Decks.AddLive("d1", "JLPT N5");
        await harness.Service.DeleteAsync(
        [
            new TrashDeleteRequest(TrashTestHarness.NoteKind, "n1"),
            new TrashDeleteRequest(TrashTestHarness.DeckKind, "d1"),
        ]);

        var page = await harness.Service.ListAsync(new TrashListQuery(Kind: TrashTestHarness.DeckKind));

        Assert.Equal("JLPT N5", Assert.Single(page.Entries).Entry.Title);
    }

    [Fact]
    public async Task Entries_that_are_not_recoverable_yet_are_neither_listed_nor_counted()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "Kanji");
        await harness.DeleteNoteAsync("n1");
        await harness.Store.InsertAsync(Row("n2", TrashEntryState.Prepared, "prepared"));
        await harness.Store.InsertAsync(Row("n3", TrashEntryState.Purging, "purging"));

        var page = await harness.Service.ListAsync(new TrashListQuery());

        Assert.Equal("Kanji", Assert.Single(page.Entries).Entry.Title);
        Assert.Equal(1, await harness.Service.CountAsync());
    }

    [Fact]
    public async Task An_entry_a_registered_module_owns_is_marked_available()
    {
        await using var harness = new TrashTestHarness(Origin);
        harness.Notes.AddLive("n1", "Kanji");
        await harness.DeleteNoteAsync("n1");

        var page = await harness.Service.ListAsync(new TrashListQuery());

        Assert.True(Assert.Single(page.Entries).SourceAvailable);
    }

    /// <summary>Deletes each item an hour apart so the listing order is not a tie.</summary>
    private static async Task DeleteInOrderAsync(TrashTestHarness harness, params string[] itemIds)
    {
        foreach (var itemId in itemIds)
        {
            await harness.DeleteNoteAsync(itemId);
            harness.Time.Advance(TimeSpan.FromHours(1));
        }
    }

    private static TrashEntry Row(string itemId, TrashEntryState state, string entryId) => new()
    {
        Id = entryId,
        Kind = TrashTestHarness.NoteKind,
        ItemId = itemId,
        Title = itemId,
        BatchId = "batch",
        State = state,
        DeletedAt = Origin,
        ExpiresAt = TrashRetention.ExpiresAt(Origin),
    };
}
