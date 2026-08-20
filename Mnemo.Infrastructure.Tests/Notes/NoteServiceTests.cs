using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Tests.Notes;

/// <summary>
/// What the note library read path answers: the order it hands notes back in, what a held note is
/// missing from, and the filing fields a new note's placement is computed against.
/// <para>
/// These are the observable facts the notes list endpoint and the note create endpoint are built on,
/// so they are pinned here rather than left to be rediscovered from the implementation. Nothing here
/// names a persistence strategy: every assertion is about what a caller sees.
/// </para>
/// </summary>
public sealed class NoteServiceTests
{
    [Fact]
    public async Task The_library_comes_back_newest_modified_first()
    {
        await using var h = new NoteSidMigrationHarness();
        var oldest = await SeedAsync(h, "Oldest", modifiedAt: At(2024, 1, 1));
        var newest = await SeedAsync(h, "Newest", modifiedAt: At(2026, 6, 1));
        var middle = await SeedAsync(h, "Middle", modifiedAt: At(2025, 3, 9));

        var listed = (await h.Notes.GetAllNotesAsync()).Select(n => n.NoteId).ToList();

        Assert.Equal([newest.NoteId, middle.NoteId, oldest.NoteId], listed);
    }

    /// <summary>
    /// Two notes stamped at the same instant come back in the order the index holds them, because the
    /// sort is stable over the index walk. Anything that reproduces the ordering has to reproduce this
    /// too, or a corpus with a shared timestamp lists in a different order than it used to.
    /// </summary>
    [Fact]
    public async Task Notes_modified_at_the_same_instant_keep_the_order_the_index_holds()
    {
        await using var h = new NoteSidMigrationHarness();
        var shared = At(2025, 5, 5);
        var first = await SeedAsync(h, "First", modifiedAt: shared);
        var second = await SeedAsync(h, "Second", modifiedAt: shared);
        var third = await SeedAsync(h, "Third", modifiedAt: shared);

        Assert.Equal([first.NoteId, second.NoteId, third.NoteId], await IndexAsync(h));

        var listed = (await h.Notes.GetAllNotesAsync()).Select(n => n.NoteId).ToList();

        Assert.Equal([first.NoteId, second.NoteId, third.NoteId], listed);
    }

    /// <summary>
    /// The library is assembled from the index and the trash map together: the held note keeps its
    /// index entry, because the asset sweep reads that index to decide which images are still spoken
    /// for, and is dropped by the map lookup instead.
    /// </summary>
    [Fact]
    public async Task A_note_the_trash_holds_is_missing_from_the_library_but_not_from_the_index()
    {
        await using var h = new NoteSidMigrationHarness();
        var kept = await SeedAsync(h, "Kept", modifiedAt: At(2025, 1, 1));
        var held = await SeedAsync(h, "Held", modifiedAt: At(2026, 1, 1));

        await h.Store.CaptureNoteAsync(held.NoteId, "e1");

        var listed = (await h.Notes.GetAllNotesAsync()).Select(n => n.NoteId).ToList();

        Assert.Equal([kept.NoteId], listed);
        Assert.Contains(held.NoteId, await IndexAsync(h));
        Assert.NotNull((await h.Storage.LoadAsync<Note>($"note_{held.NoteId}")).Value);
    }

    [Fact]
    public async Task An_index_entry_with_no_stored_note_is_passed_over()
    {
        await using var h = new NoteSidMigrationHarness();
        var real = await SeedAsync(h, "Real", modifiedAt: At(2025, 1, 1));

        var index = await IndexAsync(h);
        index.Insert(0, "missing-note");
        await h.Storage.SaveAsync("notes_index", index);

        var listed = (await h.Notes.GetAllNotesAsync()).Select(n => n.NoteId).ToList();

        Assert.Equal([real.NoteId], listed);
    }

    /// <summary>
    /// Creating a note appends it after the last note filed in the same folder, and works that out
    /// from this list. What it needs from every entry is the folder it is filed in and the position it
    /// holds there, and it must not see a held note, or a deleted note would keep pushing new ones
    /// down the folder.
    /// </summary>
    [Fact]
    public async Task The_library_carries_the_filing_a_new_notes_placement_is_computed_from()
    {
        await using var h = new NoteSidMigrationHarness();
        await SeedAsync(h, "Root note", modifiedAt: At(2025, 1, 1), order: 4);
        await SeedAsync(h, "Filed first", modifiedAt: At(2025, 1, 2), folderId: "f1", order: 0);
        await SeedAsync(h, "Filed second", modifiedAt: At(2025, 1, 3), folderId: "f1", order: 1);
        var deleted = await SeedAsync(h, "Filed and deleted", modifiedAt: At(2025, 1, 4), folderId: "f1", order: 9);

        await h.Store.CaptureNoteAsync(deleted.NoteId, "e1");

        var placement = (await h.Notes.GetAllNotesAsync())
            .Select(n => (n.FolderId, n.Order))
            .ToList();

        Assert.Equal(
            [((string?)"f1", 1), ((string?)"f1", 0), ((string?)null, 4)],
            placement);
    }

    private static async Task<Note> SeedAsync(
        NoteSidMigrationHarness h,
        string title,
        DateTime modifiedAt,
        string? folderId = null,
        int order = 0)
    {
        // Seeded straight into storage rather than through the writer, because every write path stamps
        // ModifiedAt with the current instant and these tests are about a corpus with a history.
        return await h.SeedAsync(new Note
        {
            Title = title,
            FolderId = folderId,
            Order = order,
            CreatedAt = modifiedAt,
            ModifiedAt = modifiedAt,
        });
    }

    private static DateTime At(int year, int month, int day) => new(year, month, day, 12, 0, 0, DateTimeKind.Utc);

    private static async Task<List<string>> IndexAsync(NoteSidMigrationHarness h) =>
        (await h.Storage.LoadAsync<List<string>>("notes_index")).Value ?? [];
}
