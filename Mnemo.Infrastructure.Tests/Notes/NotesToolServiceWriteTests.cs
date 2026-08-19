using System.Text.Json;
using Mnemo.Core.Identity;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Models.Tools.Notes;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes;

namespace Mnemo.Infrastructure.Tests.Notes;

/// <summary>
/// The agent tools write to the same notes the editor does, so they answer to the same contract:
/// one version, one sid space, and a conflict rather than a silent overwrite.
/// </summary>
public class NotesToolServiceWriteTests
{
    private static async Task<(NoteSidMigrationHarness H, NotesToolService Tools, Note Note)> MigratedAsync()
    {
        var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));
        await h.NewMigrator().MigrateAsync();
        return (h, Tools(h), (await h.Notes.GetNoteAsync(seeded.NoteId))!);
    }

    // Navigation and the dispatcher are reached only by open_note, which none of these exercise.
    private static NotesToolService Tools(NoteSidMigrationHarness h) =>
        new(h.Notes, h.Store, null!, null!);

    private static EditNoteParameters SetText(Note note, string text, string? expectedVersion = null) => new()
    {
        NoteId = note.NoteId,
        ExpectedVersion = expectedVersion,
        Ops = [new NoteEditOp { Op = "set_text", Id = note.Blocks![0].Id, Markdown = text }],
    };

    private static string Field(ToolInvocationResult result, string name) =>
        JsonSerializer.SerializeToElement(result.Data).GetProperty(name).ToString();

    private static List<string> AllBlockSids(IReadOnlyList<Block> blocks)
    {
        var sids = new List<string>();
        foreach (var block in blocks)
        {
            sids.Add(block.Sid);
            if (block.Children is { Count: > 0 })
                sids.AddRange(AllBlockSids(block.Children));
        }

        return sids;
    }

    [Fact]
    public async Task An_edit_advances_the_stored_version_and_reports_the_new_one()
    {
        var (h, tools, note) = await MigratedAsync();
        await using var _ = h;

        var result = await tools.EditNoteAsync(SetText(note, "written by the agent"));

        Assert.True(result.Ok, result.Message);
        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal(note.Ver + 1, stored.Ver);
        Assert.Equal(stored.Ver.ToString(), Field(result, "version"));
        Assert.Equal("written by the agent", stored.Blocks![0].Content);
    }

    [Fact]
    public async Task An_edit_carrying_the_version_it_read_applies()
    {
        var (h, tools, note) = await MigratedAsync();
        await using var _ = h;

        var read = await tools.OutlineNoteAsync(new OutlineNoteParameters { NoteId = note.NoteId });
        var result = await tools.EditNoteAsync(SetText(note, "edited", Field(read, "version")));

        Assert.True(result.Ok, result.Message);
    }

    [Fact]
    public async Task An_edit_carrying_a_version_from_before_someone_saved_is_refused()
    {
        var (h, tools, note) = await MigratedAsync();
        await using var _ = h;

        var read = await tools.OutlineNoteAsync(new OutlineNoteParameters { NoteId = note.NoteId });

        // The person in the editor saves while the agent is thinking.
        await h.Store.CommitAsync(
            note.NoteId,
            [new Block { Type = BlockType.Text, Sid = note.Blocks![0].Sid, Spans = [InlineSpan.Plain("typed by hand")] }],
            note.Ver,
            "req-1");

        var result = await tools.EditNoteAsync(SetText(note, "written by the agent", Field(read, "version")));

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.Conflict, result.Code);
        Assert.Equal("typed by hand", (await h.Notes.GetNoteAsync(note.NoteId))!.Blocks![0].Content);
    }

    [Fact]
    public async Task An_editor_holding_the_version_from_before_an_agent_edit_gets_a_conflict()
    {
        var (h, tools, note) = await MigratedAsync();
        await using var _ = h;

        var editing = note.Ver;
        await tools.EditNoteAsync(SetText(note, "written by the agent"));

        var save = await h.Store.CommitAsync(note.NoteId, [new Block { Type = BlockType.Text, Sid = "aaaaa" }], editing, "req-1");

        Assert.Equal(NoteCommitOutcome.Stale, save.Outcome);
        Assert.Equal("written by the agent", (await h.Notes.GetNoteAsync(note.NoteId))!.Blocks![0].Content);
    }

    [Fact]
    public async Task The_version_a_read_reports_does_not_move_when_the_note_is_renamed()
    {
        var (h, tools, note) = await MigratedAsync();
        await using var _ = h;

        var before = Field(await tools.OutlineNoteAsync(new OutlineNoteParameters { NoteId = note.NoteId }), "version");
        await tools.ManageNoteAsync(new ManageNoteParameters { NoteId = note.NoteId, Rename = "Renamed by the agent" });
        var after = Field(await tools.OutlineNoteAsync(new OutlineNoteParameters { NoteId = note.NoteId }), "version");

        Assert.Equal(before, after);
    }

    [Fact]
    public async Task Renaming_through_the_agent_leaves_an_open_editor_able_to_save()
    {
        var (h, tools, note) = await MigratedAsync();
        await using var _ = h;

        var editing = note.Ver;
        var renamed = await tools.ManageNoteAsync(new ManageNoteParameters { NoteId = note.NoteId, Rename = "Renamed", Favorite = true });
        Assert.True(renamed.Ok, renamed.Message);

        var save = await h.Store.CommitAsync(note.NoteId, [new Block { Type = BlockType.Text, Sid = "aaaaa", Spans = [InlineSpan.Plain("typed")] }], editing, "req-1");

        Assert.Equal(NoteCommitOutcome.Applied, save.Outcome);
        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal("Renamed", stored.Title);
        Assert.True(stored.IsFavorite);
        Assert.Equal("typed", stored.Blocks![0].Content);
    }

    [Fact]
    public async Task A_rename_through_the_agent_leaves_the_body_alone()
    {
        var (h, tools, note) = await MigratedAsync();
        await using var _ = h;

        await h.Store.CommitAsync(
            note.NoteId,
            [new Block { Type = BlockType.Text, Sid = "aaaaa", Spans = [InlineSpan.Plain("committed")] }],
            note.Ver,
            "req-1");

        await tools.ManageNoteAsync(new ManageNoteParameters { NoteId = note.NoteId, Rename = "Renamed" });

        Assert.Equal("committed", (await h.Notes.GetNoteAsync(note.NoteId))!.Blocks![0].Content);
    }

    [Fact]
    public async Task A_note_the_agent_creates_gets_a_sid_and_so_does_every_block_in_it()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();
        var tools = Tools(h);

        var result = await tools.CreateNoteAsync(new CreateNoteParameters
        {
            Title = "Agent note",
            Blocks =
            [
                new NoteBlockSpec { Type = "Heading1", Markdown = "Title" },
                new NoteBlockSpec { Type = "Text", Markdown = "Body" },
            ],
        });

        Assert.True(result.Ok, result.Message);
        var stored = (await h.Notes.GetNoteAsync(Field(result, "note_id")))!;
        Assert.True(Sid.IsWellFormedNoteSid(stored.Sid));

        var sids = AllBlockSids(stored.Blocks!);
        Assert.Equal(2, sids.Count);
        Assert.All(sids, s => Assert.True(Sid.IsWellFormedBlockSid(s)));
        Assert.Equal(2, sids.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public async Task Blocks_the_agent_inserts_never_land_under_a_sid_another_block_already_holds()
    {
        var (h, tools, note) = await MigratedAsync();
        await using var _ = h;

        var result = await tools.EditNoteAsync(new EditNoteParameters
        {
            NoteId = note.NoteId,
            Ops =
            [
                new NoteEditOp
                {
                    Op = "insert",
                    Anchor = note.Blocks![0].Id,
                    Position = "after",
                    Blocks =
                    [
                        new NoteBlockSpec { Type = "Text", Markdown = "one" },
                        new NoteBlockSpec { Type = "Text", Markdown = "two" },
                        new NoteBlockSpec { Type = "Text", Markdown = "three" },
                    ],
                },
            ],
        });

        Assert.True(result.Ok, result.Message);
        var sids = AllBlockSids((await h.Notes.GetNoteAsync(note.NoteId))!.Blocks!);
        Assert.Equal(4, sids.Count);
        Assert.All(sids, s => Assert.True(Sid.IsWellFormedBlockSid(s)));
        Assert.Equal(4, sids.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public async Task An_edit_to_a_note_that_does_not_exist_reports_not_found()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();

        var result = await Tools(h).EditNoteAsync(new EditNoteParameters
        {
            NoteId = "ghost",
            Ops = [new NoteEditOp { Op = "set_text", Id = "aaaaa", Markdown = "x" }],
        });

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.NotFound, result.Code);
    }
}
