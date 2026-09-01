using System;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Tests.ImportExport;

/// <summary>
/// Checks title matching and recovery of content replaced by Markdown imports.
/// </summary>
public sealed class NotesMarkdownFormatAdapterTests
{
    [Fact]
    public async Task Replace_keeps_the_note_and_leaves_its_old_content_in_the_trash()
    {
        await using var h = new NotesMarkdownImportHarness();
        var seeded = await h.SeedAsync(new Note
        {
            Title = "Biology",
            Blocks = [NotesMarkdownImportHarness.TextBlock("the original body")],
            Cover = "asset:cover-1",
            CoverCrop = "{\"x\":0.1,\"y\":0.1,\"w\":0.5,\"h\":0.5,\"aspect\":1.5}",
            Tags = ["science"],
            IsFavorite = true,
        });
        var file = await h.FileAsync("Biology.md", "the imported body");

        var result = await h.ImportAsync(h.Adapter(), file, ImportConflictPolicy.Replace);

        Assert.True(result.Success);

        var live = await h.Notes.GetNoteAsync(seeded.NoteId);
        Assert.NotNull(live);
        Assert.Equal("Biology", live!.Title);
        Assert.Equal("the imported body", live.Blocks!.Single().Content);

        Assert.Equal(seeded.Sid, live.Sid);
        Assert.Equal(seeded.CreatedAt, live.CreatedAt);
        Assert.Equal("asset:cover-1", live.Cover);
        Assert.Equal(new[] { "science" }, live.Tags);
        Assert.True(live.IsFavorite);
        Assert.Equal(seeded.Ver + 1, live.Ver);

        Assert.Single(await h.Notes.GetAllNotesAsync());

        var entry = Assert.Single(await h.HeldAsync());
        Assert.Equal("note", entry.Kind);
        Assert.Equal("Biology", entry.Title);
        Assert.NotEqual(seeded.NoteId, entry.ItemId);

        // The raw index must retain the trashed copy so its images remain referenced.
        Assert.Contains(entry.ItemId, await h.IndexAsync());

        await h.Trash.RestoreAsync([entry.Id]);
        var restored = await h.Notes.GetNoteAsync(entry.ItemId);
        Assert.Equal("the original body", restored!.Blocks!.Single().Content);
        Assert.Equal("Biology", restored.Title);
        // The trashed backup copy must carry the cover along with its crop, not just the cover token.
        Assert.Equal(seeded.Cover, restored.Cover);
        Assert.Equal(seeded.CoverCrop, restored.CoverCrop);
    }

    [Fact]
    public async Task Replace_leaves_a_note_with_the_same_title_in_another_folder_alone()
    {
        await using var h = new NotesMarkdownImportHarness();
        var a = await h.SeedFolderAsync("Folder A");
        var b = await h.SeedFolderAsync("Folder B");
        var elsewhere = await h.SeedNoteAsync("Biology", a.FolderId, "the original body");
        var file = await h.FileAsync("Biology.md", "the imported body");

        var result = await h.ImportAsync(h.Adapter(), file, ImportConflictPolicy.Replace, b.FolderId);

        Assert.True(result.Success);
        Assert.Empty(await h.HeldAsync());

        var untouched = await h.Notes.GetNoteAsync(elsewhere.NoteId);
        Assert.Equal("the original body", untouched!.Blocks!.Single().Content);

        var landed = (await h.Notes.GetAllNotesAsync()).Single(n => n.NoteId != elsewhere.NoteId);
        Assert.Equal("Biology", landed.Title);
        Assert.Equal(b.FolderId, landed.FolderId);
        Assert.Equal("the imported body", landed.Blocks!.Single().Content);
    }

    [Fact]
    public async Task Replace_that_cannot_reach_the_trash_leaves_the_note_as_it_is()
    {
        await using var h = new NotesMarkdownImportHarness();
        var seeded = await h.SeedNoteAsync("Biology", body: "the original body");
        var file = await h.FileAsync("Biology.md", "the imported body");
        var adapter = h.Adapter(trash: new UnreachableTrashService(h.Trash));

        var result = await h.ImportAsync(adapter, file, ImportConflictPolicy.Replace);

        Assert.False(result.Success);
        Assert.NotNull(result.ErrorMessage);

        var live = await h.Notes.GetNoteAsync(seeded.NoteId);
        Assert.Equal("the original body", live!.Blocks!.Single().Content);

        // A failed capture must not leave the temporary copy in the live library.
        Assert.Single(await h.Notes.GetAllNotesAsync());
    }

    [Fact]
    public async Task Replace_whose_capture_throws_leaves_no_copy_behind()
    {
        await using var h = new NotesMarkdownImportHarness();
        var seeded = await h.SeedNoteAsync("Biology", body: "the original body");
        var file = await h.FileAsync("Biology.md", "the imported body");
        var adapter = h.Adapter(trash: new UnreachableTrashService(h.Trash, new InvalidOperationException("the ledger is unreachable")));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => h.ImportAsync(adapter, file, ImportConflictPolicy.Replace));

        var live = await h.Notes.GetNoteAsync(seeded.NoteId);
        Assert.Equal("the original body", live!.Blocks!.Single().Content);
        Assert.Single(await h.Notes.GetAllNotesAsync());
        Assert.Empty(await h.HeldAsync());
    }

    [Fact]
    public async Task A_write_that_fails_after_the_capture_leaves_the_note_as_it_was()
    {
        await using var h = new NotesMarkdownImportHarness();
        var seeded = await h.SeedNoteAsync("Biology", body: "the original body");
        var file = await h.FileAsync("Biology.md", "the imported body");
        // Fail the replacement write after the backup copy has been captured.
        var adapter = h.Adapter(notes: new FailingSaveNoteService(h.Notes, failingSave: 2));

        var result = await h.ImportAsync(adapter, file, ImportConflictPolicy.Replace);

        Assert.False(result.Success);

        var live = await h.Notes.GetNoteAsync(seeded.NoteId);
        Assert.NotNull(live);
        Assert.Equal("the original body", live!.Blocks!.Single().Content);

        var entry = Assert.Single(await h.HeldAsync());
        await h.Trash.RestoreAsync([entry.Id]);
        var restored = await h.Notes.GetNoteAsync(entry.ItemId);
        Assert.Equal("the original body", restored!.Blocks!.Single().Content);
    }

    [Fact]
    public async Task Keep_both_no_longer_renames_around_a_note_in_another_folder()
    {
        await using var h = new NotesMarkdownImportHarness();
        var a = await h.SeedFolderAsync("Folder A");
        var elsewhere = await h.SeedNoteAsync("Biology", a.FolderId);
        var file = await h.FileAsync("Biology.md", "the imported body");

        var result = await h.ImportAsync(h.Adapter(), file, ImportConflictPolicy.KeepBoth);

        Assert.True(result.Success);
        var landed = (await h.Notes.GetAllNotesAsync()).Single(n => n.NoteId != elsewhere.NoteId);
        Assert.Equal("Biology", landed.Title);
        Assert.Null(landed.FolderId);
    }

    [Fact]
    public async Task Skip_no_longer_skips_a_file_over_a_note_in_another_folder()
    {
        await using var h = new NotesMarkdownImportHarness();
        var a = await h.SeedFolderAsync("Folder A");
        var elsewhere = await h.SeedNoteAsync("Biology", a.FolderId, "the original body");
        var file = await h.FileAsync("Biology.md", "the imported body");

        var result = await h.ImportAsync(h.Adapter(), file, ImportConflictPolicy.Skip);

        Assert.True(result.Success);
        Assert.Equal(1, result.ProcessedCounts["notes"]);

        var landed = (await h.Notes.GetAllNotesAsync()).Single(n => n.NoteId != elsewhere.NoteId);
        Assert.Equal("Biology", landed.Title);
        Assert.Null(landed.FolderId);
        Assert.Equal("the original body", (await h.Notes.GetNoteAsync(elsewhere.NoteId))!.Blocks!.Single().Content);
    }

    [Fact]
    public async Task Replace_leaves_a_child_page_with_the_same_title_alone()
    {
        await using var h = new NotesMarkdownImportHarness();
        var parent = await h.SeedNoteAsync("Cells");
        // Child pages inherit the parent folder but must not be replacement candidates.
        var child = await h.SeedAsync(new Note
        {
            Title = "Biology",
            ParentNoteId = parent.NoteId,
            Blocks = [NotesMarkdownImportHarness.TextBlock("the original body")],
        });
        var file = await h.FileAsync("Biology.md", "the imported body");

        var result = await h.ImportAsync(h.Adapter(), file, ImportConflictPolicy.Replace);

        Assert.True(result.Success);
        Assert.Empty(await h.HeldAsync());

        var untouched = await h.Notes.GetNoteAsync(child.NoteId);
        Assert.Equal("the original body", untouched!.Blocks!.Single().Content);
        Assert.Equal(parent.NoteId, untouched.ParentNoteId);

        var landed = (await h.Notes.GetAllNotesAsync())
            .Single(n => n.NoteId != child.NoteId && n.NoteId != parent.NoteId);
        Assert.Equal("Biology", landed.Title);
        Assert.Null(landed.ParentNoteId);
        Assert.Equal("the imported body", landed.Blocks!.Single().Content);
    }
}
