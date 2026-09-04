using Mnemo.Core.Models;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Persistence;

namespace Mnemo.Infrastructure.Tests.Notes;

/// <summary>
/// The note writer's side of the trash: what a held note is invisible to, what it survives, and what
/// a folder takes with it.
/// </summary>
public sealed class NoteTrashTests
{
    // ---- Notes -----------------------------------------------------------------------------------

    [Fact]
    public async Task A_held_note_leaves_the_library_without_leaving_the_index()
    {
        await using var h = new NoteSidMigrationHarness();
        var note = await NoteAsync(h, "Rock cycle");

        var snapshot = await h.Store.CaptureNoteAsync(note.NoteId, "e1");

        Assert.NotNull(snapshot);
        Assert.Equal("Rock cycle", snapshot!.Title);
        Assert.Null(await h.Notes.GetNoteAsync(note.NoteId));
        Assert.Empty(await h.Notes.GetAllNotesAsync());

        // The asset sweep decides which images are still spoken for by reading this index, so a held
        // note staying in it is what keeps its pictures alive until the entry is actually purged.
        Assert.Contains(note.NoteId, await IndexAsync(h));
        Assert.NotNull((await h.Storage.LoadAsync<Note>($"note_{note.NoteId}")).Value);
    }

    [Fact]
    public async Task A_held_note_cannot_be_written_over()
    {
        await using var h = new NoteSidMigrationHarness();
        var note = await NoteAsync(h, "Before", body: "first");
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");

        var commit = await h.Store.CommitAsync(note.NoteId, Body("second"), note.Ver, "req-1");
        var metadata = await h.Store.UpdateMetadataAsync(
            note.NoteId,
            NoteMetadata.FromNote(note) with { Title = "After" });
        var put = await h.Notes.SaveNoteAsync(new Note { NoteId = note.NoteId, Title = "After" });

        Assert.Equal(NoteCommitOutcome.NotFound, commit.Outcome);
        Assert.Equal(NoteCommitOutcome.NotFound, metadata.Outcome);
        Assert.False(put.IsSuccess);

        var stored = (await h.Storage.LoadAsync<Note>($"note_{note.NoteId}")).Value!;
        Assert.Equal("Before", stored.Title);
        Assert.Equal("first", stored.Blocks![0].Content);
    }

    [Fact]
    public async Task A_held_note_cannot_be_deleted()
    {
        await using var h = new NoteSidMigrationHarness();
        var note = await NoteAsync(h, "Rock cycle");
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");

        var deleted = await h.Notes.DeleteNoteAsync(note.NoteId);

        Assert.False(deleted.IsSuccess);
        Assert.NotNull((await h.Storage.LoadAsync<Note>($"note_{note.NoteId}")).Value);
    }

    [Fact]
    public async Task Deleting_a_held_note_outright_is_refused()
    {
        await using var h = new NoteSidMigrationHarness();
        var note = await NoteAsync(h, "Rock cycle");
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");

        Assert.False(await h.Store.DeleteAsync(note.NoteId));
        Assert.NotNull((await h.Storage.LoadAsync<Note>($"note_{note.NoteId}")).Value);
        Assert.Contains(note.NoteId, await IndexAsync(h));
    }

    [Fact]
    public async Task Preparing_a_note_reports_the_folder_it_would_come_back_to()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = await FolderAsync(h, "Geology");
        var note = await NoteAsync(h, "Rock cycle", folder.FolderId);

        var snapshot = await h.Store.PrepareNoteAsync(note.NoteId);

        Assert.Equal("Rock cycle", snapshot!.Title);
        Assert.Equal("Geology", snapshot.Origin);
        Assert.Equal(0, snapshot.ContainedCount);
        Assert.Null(await h.Store.PrepareNoteAsync("nope"));
    }

    [Fact]
    public async Task Preparing_a_note_the_trash_already_holds_reports_nothing()
    {
        await using var h = new NoteSidMigrationHarness();
        var note = await NoteAsync(h, "Rock cycle");
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");

        Assert.Null(await h.Store.PrepareNoteAsync(note.NoteId));
    }

    [Fact]
    public async Task Capturing_the_same_note_twice_under_one_entry_lands_once()
    {
        await using var h = new NoteSidMigrationHarness();
        var note = await NoteAsync(h, "Rock cycle");

        // A retried delete arrives as a second capture carrying the entry the first one wrote.
        Assert.NotNull(await h.Store.CaptureNoteAsync(note.NoteId, "e1"));
        Assert.NotNull(await h.Store.CaptureNoteAsync(note.NoteId, "e1"));
        Assert.Null(await h.Store.CaptureNoteAsync(note.NoteId, "e2"));

        Assert.Equal(new[] { "e1" }, await h.Store.HeldNoteEntryIdsAsync());
    }

    [Fact]
    public async Task Restoring_a_note_puts_it_back_in_the_folder_it_came_from()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = await FolderAsync(h, "Geology");
        var note = await NoteAsync(h, "Rock cycle", folder.FolderId);
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");

        var restore = await h.Store.RestoreNoteAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        Assert.Equal(folder.FolderId, restore.DestinationId);
        Assert.Equal("Geology", restore.DestinationName);

        var back = await h.Notes.GetNoteAsync(note.NoteId);
        Assert.Equal(folder.FolderId, back!.FolderId);
    }

    [Fact]
    public async Task A_restored_note_is_the_same_note_rather_than_a_copy()
    {
        await using var h = new NoteSidMigrationHarness();
        var note = await NoteAsync(h, "Rock cycle", body: "granite");
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");
        await h.Store.RestoreNoteAsync("e1");

        var back = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal(note.Sid, back.Sid);
        Assert.Equal(note.Ver, back.Ver);
        Assert.Equal("granite", back.Blocks![0].Content);
    }

    [Fact]
    public async Task A_note_whose_folder_went_away_comes_back_to_the_root()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = await FolderAsync(h, "Geology");
        var note = await NoteAsync(h, "Rock cycle", folder.FolderId);
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");
        await h.Folders.DeleteFolderAsync(folder.FolderId);

        var restore = await h.Store.RestoreNoteAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Rooted, restore.Outcome);
        var back = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Null(back.FolderId);
        Assert.Equal(string.Empty, back.FolderPath);
    }

    [Fact]
    public async Task A_note_whose_folder_is_in_the_trash_too_waits_for_it()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = await FolderAsync(h, "Geology");
        var note = await NoteAsync(h, "Rock cycle", folder.FolderId);

        // Deleted on its own first, so the folder capture below leaves this entry alone.
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");
        await h.Store.CaptureFolderAsync(folder.FolderId, "e2");

        // Rooting the note here would quietly undo an arrangement the user is about to recover.
        Assert.Equal(TrashRestoreOutcome.BlockedByContainer, (await h.Store.RestoreNoteAsync("e1")).Outcome);
        Assert.Null(await h.Notes.GetNoteAsync(note.NoteId));

        await h.Store.RestoreFolderAsync("e2");
        Assert.Equal(TrashRestoreOutcome.Restored, (await h.Store.RestoreNoteAsync("e1")).Outcome);
        Assert.Equal(folder.FolderId, (await h.Notes.GetNoteAsync(note.NoteId))!.FolderId);
    }

    [Fact]
    public async Task Restoring_an_entry_nothing_is_held_under_reports_it_missing()
    {
        await using var h = new NoteSidMigrationHarness();

        Assert.Equal(TrashRestoreOutcome.Missing, (await h.Store.RestoreNoteAsync("e1")).Outcome);
        Assert.Equal(TrashRestoreOutcome.Missing, (await h.Store.RestoreFolderAsync("e1")).Outcome);
    }

    [Fact]
    public async Task Purging_a_note_destroys_it_and_drops_it_from_the_index()
    {
        await using var h = new NoteSidMigrationHarness();
        var note = await NoteAsync(h, "Rock cycle");
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");

        await h.Store.PurgeNoteAsync("e1");

        Assert.Null((await h.Storage.LoadAsync<Note>($"note_{note.NoteId}")).Value);
        // Leaving the index is what makes the note's images unreferenced, which is the signal the
        // asset sweep collects them on.
        Assert.DoesNotContain(note.NoteId, await IndexAsync(h));
        Assert.False(await h.Store.NoteHoldsAsync("e1"));
    }

    [Fact]
    public async Task Purging_an_entry_twice_is_not_an_error()
    {
        await using var h = new NoteSidMigrationHarness();
        var note = await NoteAsync(h, "Rock cycle");
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");

        await h.Store.PurgeNoteAsync("e1");
        await h.Store.PurgeNoteAsync("e1");

        Assert.Empty(await IndexAsync(h));
    }

    [Fact]
    public async Task Releasing_an_entry_returns_its_rows_without_reading_as_a_restore()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = await FolderAsync(h, "Geology");
        var note = await NoteAsync(h, "Rock cycle", folder.FolderId);
        await h.Store.CaptureNoteAsync(note.NoteId, "e1");

        // Reconciliation undoes a capture that never became a ledger entry, so the note comes back
        // exactly where it was rather than through the placement rules a restore applies.
        await h.Store.ReleaseNotesAsync(["e1"]);

        Assert.Equal(folder.FolderId, (await h.Notes.GetNoteAsync(note.NoteId))!.FolderId);
        Assert.Empty(await h.Store.HeldNoteEntryIdsAsync());
    }

    // ---- Folders ---------------------------------------------------------------------------------

    [Fact]
    public async Task A_folder_takes_its_subtree_with_it()
    {
        await using var h = new NoteSidMigrationHarness();
        var top = await FolderAsync(h, "Geology");
        var inner = await FolderAsync(h, "Igneous", top.FolderId);
        var outside = await FolderAsync(h, "Chemistry");
        var a = await NoteAsync(h, "Rock cycle", top.FolderId);
        var b = await NoteAsync(h, "Granite", inner.FolderId);
        var elsewhere = await NoteAsync(h, "Alkali metals", outside.FolderId);
        var root = await NoteAsync(h, "Reading list");

        var snapshot = await h.Store.CaptureFolderAsync(top.FolderId, "e1");

        Assert.Equal("Geology", snapshot!.Title);
        Assert.Null(snapshot.Origin);
        Assert.Equal(2, snapshot.ContainedCount);

        var visible = (await h.Notes.GetAllNotesAsync()).Select(n => n.NoteId).ToList();
        Assert.Equal(2, visible.Count);
        Assert.Contains(elsewhere.NoteId, visible);
        Assert.Contains(root.NoteId, visible);
        Assert.DoesNotContain(a.NoteId, visible);
        Assert.DoesNotContain(b.NoteId, visible);

        var folders = (await h.Folders.GetAllFoldersAsync()).Select(f => f.FolderId).ToList();
        Assert.Equal(new[] { outside.FolderId }, folders);
    }

    [Fact]
    public async Task A_folder_reports_the_folder_it_would_come_back_to()
    {
        await using var h = new NoteSidMigrationHarness();
        var top = await FolderAsync(h, "Science");
        var inner = await FolderAsync(h, "Geology", top.FolderId);
        await NoteAsync(h, "Rock cycle", inner.FolderId);

        var snapshot = await h.Store.PrepareFolderAsync(inner.FolderId);

        Assert.Equal("Geology", snapshot!.Title);
        Assert.Equal("Science", snapshot.Origin);
        Assert.Equal(1, snapshot.ContainedCount);
        Assert.Null(await h.Store.PrepareFolderAsync("nope"));
    }

    [Fact]
    public async Task A_folder_leaves_alone_what_another_entry_already_holds()
    {
        await using var h = new NoteSidMigrationHarness();
        var top = await FolderAsync(h, "Geology");
        var inner = await FolderAsync(h, "Igneous", top.FolderId);
        var note = await NoteAsync(h, "Granite", inner.FolderId);

        await h.Store.CaptureNoteAsync(note.NoteId, "e1");
        var snapshot = await h.Store.CaptureFolderAsync(top.FolderId, "e2");

        // The note was already deleted in its own right, so the folder does not count it and does not
        // take it over. Restoring the folder must not bring back something separately deleted.
        Assert.Equal(0, snapshot!.ContainedCount);
        await h.Store.RestoreFolderAsync("e2");
        Assert.Null(await h.Notes.GetNoteAsync(note.NoteId));
        Assert.True(await h.Store.NoteHoldsAsync("e1"));
    }

    [Fact]
    public async Task A_folder_does_not_reach_into_a_subtree_another_entry_holds()
    {
        await using var h = new NoteSidMigrationHarness();
        var top = await FolderAsync(h, "Geology");
        var inner = await FolderAsync(h, "Igneous", top.FolderId);
        var deep = await FolderAsync(h, "Basalt", inner.FolderId);

        await h.Store.CaptureFolderAsync(inner.FolderId, "e1");
        await h.Store.CaptureFolderAsync(top.FolderId, "e2");

        await h.Store.RestoreFolderAsync("e2");

        // Only the folder that was deleted second comes back; the earlier entry keeps its own subtree.
        var live = (await h.Folders.GetAllFoldersAsync()).Select(f => f.FolderId).ToList();
        Assert.Equal(new[] { top.FolderId }, live);
        Assert.True(await h.Store.FolderHoldsAsync("e1"));
        Assert.Contains(deep.FolderId, (await h.Store.HeldFolderIdsAsync()).Keys);
    }

    [Fact]
    public async Task Restoring_a_folder_brings_the_whole_subtree_back()
    {
        await using var h = new NoteSidMigrationHarness();
        var science = await FolderAsync(h, "Science");
        var top = await FolderAsync(h, "Geology", science.FolderId);
        var inner = await FolderAsync(h, "Igneous", top.FolderId);
        var note = await NoteAsync(h, "Granite", inner.FolderId);
        await h.Store.CaptureFolderAsync(top.FolderId, "e1");

        var restore = await h.Store.RestoreFolderAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        Assert.Equal(science.FolderId, restore.DestinationId);
        Assert.Equal("Science", restore.DestinationName);

        var folders = (await h.Folders.GetAllFoldersAsync()).ToDictionary(f => f.FolderId, StringComparer.Ordinal);
        Assert.Equal(3, folders.Count);
        Assert.Equal(science.FolderId, folders[top.FolderId].ParentId);
        Assert.Equal(top.FolderId, folders[inner.FolderId].ParentId);
        Assert.Equal(inner.FolderId, (await h.Notes.GetNoteAsync(note.NoteId))!.FolderId);
    }

    [Fact]
    public async Task A_folder_whose_parent_went_away_comes_back_to_the_root()
    {
        await using var h = new NoteSidMigrationHarness();
        var science = await FolderAsync(h, "Science");
        var top = await FolderAsync(h, "Geology", science.FolderId);
        await h.Store.CaptureFolderAsync(top.FolderId, "e1");
        await h.Folders.DeleteFolderAsync(science.FolderId);

        var restore = await h.Store.RestoreFolderAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Rooted, restore.Outcome);
        var back = (await h.Folders.GetAllFoldersAsync()).Single();
        Assert.Equal(top.FolderId, back.FolderId);
        Assert.Null(back.ParentId);
    }

    [Fact]
    public async Task Purging_a_folder_destroys_the_subtree_and_the_notes_in_it()
    {
        await using var h = new NoteSidMigrationHarness();
        var top = await FolderAsync(h, "Geology");
        var inner = await FolderAsync(h, "Igneous", top.FolderId);
        var note = await NoteAsync(h, "Granite", inner.FolderId);
        var kept = await NoteAsync(h, "Reading list");
        await h.Store.CaptureFolderAsync(top.FolderId, "e1");

        var purge = await h.Store.PurgeFolderAsync("e1");

        Assert.True(purge.Completed);
        Assert.Empty(purge.BlockingEntryIds);
        Assert.Null((await h.Storage.LoadAsync<NoteFolder>($"note_folder_{top.FolderId}")).Value);
        Assert.Null((await h.Storage.LoadAsync<NoteFolder>($"note_folder_{inner.FolderId}")).Value);
        Assert.Null((await h.Storage.LoadAsync<Note>($"note_{note.NoteId}")).Value);
        Assert.Equal(new[] { kept.NoteId }, await IndexAsync(h));
        Assert.False(await h.Store.FolderHoldsAsync("e1"));
    }

    [Fact]
    public async Task A_held_folder_cannot_be_written_over_or_deleted()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = await FolderAsync(h, "Geology");
        await h.Store.CaptureFolderAsync(folder.FolderId, "e1");

        var saved = await h.Folders.SaveFolderAsync(new NoteFolder { FolderId = folder.FolderId, Name = "Renamed" });
        var deleted = await h.Folders.DeleteFolderAsync(folder.FolderId);

        Assert.False(saved.IsSuccess);
        Assert.False(deleted.IsSuccess);
        Assert.Equal("Geology", (await h.Storage.LoadAsync<NoteFolder>($"note_folder_{folder.FolderId}")).Value!.Name);
    }

    [Fact]
    public async Task A_folder_entry_is_never_mistaken_for_a_note_entry()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = await FolderAsync(h, "Geology");
        await NoteAsync(h, "Granite", folder.FolderId);
        var loose = await NoteAsync(h, "Reading list");

        await h.Store.CaptureFolderAsync(folder.FolderId, "e1");
        await h.Store.CaptureNoteAsync(loose.NoteId, "e2");

        // A folder capture marks the notes inside it under the folder's own entry, so the note source
        // has to disown any entry a folder row also carries or both sources would claim it.
        Assert.True(await h.Store.FolderHoldsAsync("e1"));
        Assert.False(await h.Store.NoteHoldsAsync("e1"));
        Assert.False(await h.Store.FolderHoldsAsync("e2"));
        Assert.True(await h.Store.NoteHoldsAsync("e2"));

        Assert.Equal(new[] { "e1" }, await h.Store.HeldFolderEntryIdsAsync());
        Assert.Equal(new[] { "e2" }, await h.Store.HeldNoteEntryIdsAsync());
    }

    [Fact]
    public async Task Releasing_a_folder_entry_lets_go_of_the_notes_it_marked()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = await FolderAsync(h, "Geology");
        var note = await NoteAsync(h, "Granite", folder.FolderId);
        await h.Store.CaptureFolderAsync(folder.FolderId, "e1");

        await h.Store.ReleaseFoldersAsync(["e1"]);

        Assert.Single(await h.Folders.GetAllFoldersAsync());
        Assert.Equal(folder.FolderId, (await h.Notes.GetNoteAsync(note.NoteId))!.FolderId);
        Assert.Empty(await h.Store.HeldFolderEntryIdsAsync());
        Assert.Empty(await h.Store.HeldNoteEntryIdsAsync());
    }

    // ---- Saved data written before the trash existed ----------------------------------------------

    [Fact]
    public async Task A_library_written_before_the_trash_existed_reads_as_holding_nothing()
    {
        await using var h = new NoteSidMigrationHarness();
        var folder = await FolderAsync(h, "Geology");
        var note = await NoteAsync(h, "Granite", folder.FolderId);

        // No trash map has ever been written to this database, which is what every existing install
        // looks like on the first launch after the upgrade.
        Assert.Null((await h.Storage.LoadAsync<Dictionary<string, string>>(NoteCommitStore.NoteTrashKey)).Value);
        Assert.Empty(await h.Store.HeldNoteIdsAsync());
        Assert.Empty(await h.Store.HeldFolderIdsAsync());
        Assert.Empty(await h.Store.HeldNoteEntryIdsAsync());
        Assert.Empty(await h.Store.HeldFolderEntryIdsAsync());
        Assert.NotNull(await h.Notes.GetNoteAsync(note.NoteId));
        Assert.Single(await h.Folders.GetAllFoldersAsync());
    }

    // ---- Helpers ---------------------------------------------------------------------------------

    private static List<Block> Body(string text, string sid = "aaaaa") =>
        [new Block { Type = BlockType.Text, Sid = sid, Spans = [InlineSpan.Plain(text)] }];

    private static async Task<Note> NoteAsync(
        NoteSidMigrationHarness h, string title, string? folderId = null, string? body = null)
    {
        var note = new Note
        {
            Title = title,
            FolderId = folderId,
            Blocks = body is null ? null : Body(body),
        };

        Assert.True((await h.Notes.SaveNoteAsync(note)).IsSuccess);
        return (await h.Notes.GetNoteAsync(note.NoteId))!;
    }

    private static async Task<NoteFolder> FolderAsync(
        NoteSidMigrationHarness h, string name, string? parentId = null)
    {
        var folder = new NoteFolder { Name = name, ParentId = parentId };
        Assert.True((await h.Folders.SaveFolderAsync(folder)).IsSuccess);
        return folder;
    }

    private static async Task<List<string>> IndexAsync(NoteSidMigrationHarness h) =>
        (await h.Storage.LoadAsync<List<string>>("notes_index")).Value ?? [];
}
