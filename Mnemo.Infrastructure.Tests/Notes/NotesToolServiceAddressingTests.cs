using System.Text.Json;
using Mnemo.Core.Identity;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Models.Tools.Notes;
using Mnemo.Infrastructure.Services.Notes;

namespace Mnemo.Infrastructure.Tests.Notes;

/// <summary>
/// The agent tools hand the model sids, not the storage GUIDs, for both notes and blocks, while
/// still accepting a GUID on input. These tests pin that contract at the boundary the model
/// actually sees: outline, read, search, create, and edit results.
/// </summary>
public class NotesToolServiceAddressingTests
{
    private static async Task<(NoteSidMigrationHarness H, NotesToolService Tools, Note Note)> MigratedAsync(params Block[] blocks)
    {
        var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(blocks));
        await h.NewMigrator().MigrateAsync();
        return (h, Tools(h), (await h.Notes.GetNoteAsync(seeded.NoteId))!);
    }

    // Navigation and the dispatcher are reached only by open_note, which none of these exercise.
    private static NotesToolService Tools(NoteSidMigrationHarness h) =>
        new(h.Notes, h.Store, null!, null!);

    private static JsonElement Data(ToolInvocationResult result) =>
        JsonSerializer.SerializeToElement(result.Data);

    private static string Field(ToolInvocationResult result, string name) =>
        Data(result).GetProperty(name).ToString();

    private static JsonElement At(JsonElement array, int index) =>
        array.EnumerateArray().ElementAt(index);

    [Fact]
    public async Task Outline_and_read_report_each_blocks_sid_as_id_and_the_notes_sid_as_note_id()
    {
        var (h, tools, note) = await MigratedAsync(NoteSidMigrationHarness.TextBlock());
        await using var _ = h;

        var outline = await tools.OutlineNoteAsync(new OutlineNoteParameters { NoteId = note.NoteId });
        Assert.True(outline.Ok, outline.Message);
        Assert.Equal(note.Sid, Field(outline, "note_id"));
        Assert.Equal(note.Blocks![0].Sid, At(Data(outline).GetProperty("blocks"), 0).GetProperty("id").ToString());

        var read = await tools.ReadNoteAsync(new ReadNoteParameters { NoteId = note.NoteId });
        Assert.True(read.Ok, read.Message);
        Assert.Equal(note.Sid, Field(read, "note_id"));
        Assert.Equal(note.Blocks![0].Sid, At(Data(read).GetProperty("blocks"), 0).GetProperty("id").ToString());
    }

    [Fact]
    public async Task A_note_resolves_by_its_sid_and_still_by_its_guid()
    {
        var (h, tools, note) = await MigratedAsync(NoteSidMigrationHarness.TextBlock());
        await using var _ = h;

        var bySid = await tools.OutlineNoteAsync(new OutlineNoteParameters { NoteId = note.Sid });
        Assert.True(bySid.Ok, bySid.Message);
        Assert.Equal(note.Sid, Field(bySid, "note_id"));

        var byGuid = await tools.OutlineNoteAsync(new OutlineNoteParameters { NoteId = note.NoteId });
        Assert.True(byGuid.Ok, byGuid.Message);
        Assert.Equal(note.Sid, Field(byGuid, "note_id"));
    }

    [Fact]
    public async Task A_block_op_applies_addressed_by_sid_and_by_guid()
    {
        var (h, tools, note) = await MigratedAsync(NoteSidMigrationHarness.TextBlock());
        await using var _ = h;

        var bySid = await tools.EditNoteAsync(new EditNoteParameters
        {
            NoteId = note.NoteId,
            Ops = [new NoteEditOp { Op = "set_text", Id = note.Blocks![0].Sid, Markdown = "via sid" }],
        });
        Assert.True(bySid.Ok, bySid.Message);
        var afterSidEdit = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal("via sid", afterSidEdit.Blocks![0].Content);

        var byGuid = await tools.EditNoteAsync(new EditNoteParameters
        {
            NoteId = note.NoteId,
            Ops = [new NoteEditOp { Op = "set_text", Id = afterSidEdit.Blocks![0].Id, Markdown = "via guid" }],
        });
        Assert.True(byGuid.Ok, byGuid.Message);
        Assert.Equal("via guid", (await h.Notes.GetNoteAsync(note.NoteId))!.Blocks![0].Content);
    }

    [Fact]
    public async Task An_ambiguous_sid_prefix_lists_sids_as_candidates()
    {
        var (h, tools, note) = await MigratedAsync(
            NoteSidMigrationHarness.TextBlock("aaaaa"),
            NoteSidMigrationHarness.TextBlock("aaaab"));
        await using var _ = h;

        var result = await tools.EditNoteAsync(new EditNoteParameters
        {
            NoteId = note.NoteId,
            Ops = [new NoteEditOp { Op = "set_text", Id = "aaaa", Markdown = "x" }],
        });

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.ValidationError, result.Code);
        Assert.Contains("aaaaa", result.Message);
        Assert.Contains("aaaab", result.Message);
    }

    [Fact]
    public async Task Search_hits_carry_note_and_block_sids_and_list_mode_carries_the_note_sid()
    {
        var (h, tools, note) = await MigratedAsync(NoteSidMigrationHarness.TextBlock());
        await using var _ = h;

        await tools.EditNoteAsync(new EditNoteParameters
        {
            NoteId = note.NoteId,
            Ops = [new NoteEditOp { Op = "set_text", Id = note.Blocks![0].Sid, Markdown = "findable phrase" }],
        });
        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;

        var search = await tools.SearchNotesAsync(new SearchNotesParameters { Query = "findable" });
        Assert.True(search.Ok, search.Message);
        var hit = At(Data(search).GetProperty("hits"), 0);
        Assert.Equal(stored.Sid, hit.GetProperty("note_id").ToString());
        Assert.Equal(stored.Blocks![0].Sid, hit.GetProperty("block_id").ToString());

        var listed = await tools.SearchNotesAsync(new SearchNotesParameters());
        Assert.True(listed.Ok, listed.Message);
        var listedNote = At(Data(listed).GetProperty("notes"), 0);
        Assert.Equal(stored.Sid, listedNote.GetProperty("id").ToString());
    }

    [Fact]
    public async Task Reading_a_page_block_reports_the_referenced_notes_sid()
    {
        var (h, tools, target) = await MigratedAsync(NoteSidMigrationHarness.TextBlock());
        await using var _ = h;

        var created = await tools.CreateNoteAsync(new CreateNoteParameters
        {
            Title = "Has a page reference",
            Blocks = [new NoteBlockSpec { Type = "Page", Markdown = target.NoteId }],
        });
        Assert.True(created.Ok, created.Message);

        var read = await tools.ReadNoteAsync(new ReadNoteParameters { NoteId = Field(created, "note_id") });
        Assert.True(read.Ok, read.Message);
        var pageBlock = At(Data(read).GetProperty("blocks"), 0);
        Assert.Equal(target.Sid, pageBlock.GetProperty("page").GetProperty("reference_note_id").ToString());
    }

    [Fact]
    public async Task Reading_a_page_block_to_a_missing_note_reports_the_raw_stored_value()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();
        var tools = Tools(h);

        var ghostId = Guid.NewGuid().ToString();
        var created = await tools.CreateNoteAsync(new CreateNoteParameters
        {
            Title = "Dangling reference",
            Blocks = [new NoteBlockSpec { Type = "Page", Markdown = ghostId }],
        });
        Assert.True(created.Ok, created.Message);

        var read = await tools.ReadNoteAsync(new ReadNoteParameters { NoteId = Field(created, "note_id") });
        var pageBlock = At(Data(read).GetProperty("blocks"), 0);
        Assert.Equal(ghostId, pageBlock.GetProperty("page").GetProperty("reference_note_id").ToString());
    }

    [Fact]
    public async Task A_replace_op_keeps_the_blocks_sid()
    {
        var (h, tools, note) = await MigratedAsync(NoteSidMigrationHarness.TextBlock());
        await using var _ = h;

        var originalSid = note.Blocks![0].Sid;
        var result = await tools.EditNoteAsync(new EditNoteParameters
        {
            NoteId = note.NoteId,
            Ops = [new NoteEditOp { Op = "replace", Id = originalSid, Type = "Text", Markdown = "replaced" }],
        });

        Assert.True(result.Ok, result.Message);
        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal(originalSid, stored.Blocks![0].Sid);
        Assert.Equal("replaced", stored.Blocks[0].Content);
    }

    [Fact]
    public async Task Create_note_reports_the_new_notes_sid()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();
        var tools = Tools(h);

        var result = await tools.CreateNoteAsync(new CreateNoteParameters { Title = "New note" });

        Assert.True(result.Ok, result.Message);
        var stored = (await h.Notes.GetAllNotesAsync()).Single();
        Assert.True(Sid.IsWellFormedNoteSid(stored.Sid));
        Assert.Equal(stored.Sid, Field(result, "note_id"));
    }
}
