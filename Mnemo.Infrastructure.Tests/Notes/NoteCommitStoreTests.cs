using Mnemo.Core.Identity;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Notes;

public class NoteCommitStoreTests
{
    private static List<Block> Body(string text, string sid = "aaaaa") =>
        [new Block { Type = BlockType.Text, Sid = sid, Spans = [InlineSpan.Plain(text)] }];

    private static async Task<(NoteSidMigrationHarness H, Note Note)> MigratedNoteAsync()
    {
        var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));
        await h.NewMigrator().MigrateAsync();
        return (h, (await h.Notes.GetNoteAsync(seeded.NoteId))!);
    }

    [Fact]
    public async Task A_commit_on_the_current_version_applies_and_advances_it_by_one()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var result = await h.Store.CommitAsync(note.NoteId, Body("written"), note.Ver, "req-1");

        Assert.Equal(NoteCommitOutcome.Applied, result.Outcome);
        Assert.Equal(note.Ver + 1, result.Ver);

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal(note.Ver + 1, stored.Ver);
        Assert.Equal("written", stored.Blocks![0].Content);
    }

    [Fact]
    public async Task A_commit_on_a_stale_version_is_refused_and_writes_nothing()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        await h.Store.CommitAsync(note.NoteId, Body("first"), note.Ver, "req-1");
        var result = await h.Store.CommitAsync(note.NoteId, Body("second"), note.Ver, "req-2");

        Assert.Equal(NoteCommitOutcome.Stale, result.Outcome);
        Assert.Equal(note.Ver + 1, result.Ver);

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal("first", stored.Blocks![0].Content);
        Assert.Equal(note.Ver + 1, stored.Ver);
    }

    [Fact]
    public async Task Replaying_a_request_is_recognised_rather_than_treated_as_a_conflict()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var first = await h.Store.CommitAsync(note.NoteId, Body("once"), note.Ver, "req-1");
        // The same request arriving again, carrying the same now-stale base version, as it would
        // after a dropped acknowledgement.
        var replay = await h.Store.CommitAsync(note.NoteId, Body("once"), note.Ver, "req-1");

        Assert.Equal(NoteCommitOutcome.Applied, first.Outcome);
        Assert.Equal(NoteCommitOutcome.AlreadyApplied, replay.Outcome);
        Assert.True(replay.IsSuccess);
        Assert.Equal(first.Ver, replay.Ver);

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal(first.Ver, stored.Ver);
        Assert.Equal("once", stored.Blocks![0].Content);
    }

    [Fact]
    public async Task A_replay_does_not_resurrect_content_written_after_it()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var first = await h.Store.CommitAsync(note.NoteId, Body("first"), note.Ver, "req-1");
        await h.Store.CommitAsync(note.NoteId, Body("second"), first.Ver, "req-2");

        var lateReplay = await h.Store.CommitAsync(note.NoteId, Body("first"), note.Ver, "req-1");

        Assert.Equal(NoteCommitOutcome.Stale, lateReplay.Outcome);
        Assert.Equal("second", (await h.Notes.GetNoteAsync(note.NoteId))!.Blocks![0].Content);
    }

    [Fact]
    public async Task A_commit_writes_the_body_and_leaves_every_other_field_as_stored()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        await h.Store.UpdateMetadataAsync(note.NoteId, NoteMetadata.FromNote(note) with
        {
            Title = "Kept",
            Tags = ["physics"],
            IsFavorite = true,
        });

        await h.Store.CommitAsync(note.NoteId, Body("x"), note.Ver, "req-1");

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal("Kept", stored.Title);
        Assert.Equal(["physics"], stored.Tags);
        Assert.True(stored.IsFavorite);
        Assert.Equal(note.Sid, stored.Sid);
        Assert.Equal(note.CreatedAt, stored.CreatedAt);
    }

    [Fact]
    public async Task Committing_to_a_note_that_does_not_exist_reports_not_found()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();

        var result = await h.Store.CommitAsync("ghost", Body("x"), 0, "req-1");

        Assert.Equal(NoteCommitOutcome.NotFound, result.Outcome);
    }

    [Fact]
    public async Task Sequential_commits_each_advance_the_version_once()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var ver = note.Ver;
        for (var i = 0; i < 5; i++)
        {
            var result = await h.Store.CommitAsync(note.NoteId, Body($"edit {i}"), ver, $"req-{i}");
            Assert.Equal(NoteCommitOutcome.Applied, result.Outcome);
            Assert.Equal(ver + 1, result.Ver);
            ver = result.Ver;
        }

        Assert.Equal(note.Ver + 5, (await h.Notes.GetNoteAsync(note.NoteId))!.Ver);
    }

    [Fact]
    public async Task Only_one_of_two_racing_commits_on_the_same_base_version_wins()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var results = await Task.WhenAll(
            Enumerable.Range(0, 8).Select(i =>
                h.Store.CommitAsync(note.NoteId, Body($"racer {i}"), note.Ver, $"req-{i}")));

        Assert.Equal(1, results.Count(r => r.Outcome == NoteCommitOutcome.Applied));
        Assert.Equal(7, results.Count(r => r.Outcome == NoteCommitOutcome.Stale));
        Assert.Equal(note.Ver + 1, (await h.Notes.GetNoteAsync(note.NoteId))!.Ver);
    }

    [Fact]
    public async Task Put_writes_the_note_and_its_index_entry_together()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();
        var note = new Note { Title = "Created", Sid = "abcdef", Blocks = [NoteSidMigrationHarness.TextBlock("aaaaa")] };

        var result = await h.Store.PutAsync(note);

        Assert.Equal(1, result.Ver);
        Assert.NotNull(await h.Notes.GetNoteAsync(note.NoteId));
        Assert.Contains(note.NoteId, (await h.Storage.LoadAsync<List<string>>("notes_index")).Value!);
        Assert.Single(await h.Notes.GetAllNotesAsync());
    }

    [Fact]
    public async Task Put_never_lets_the_version_go_backwards()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var committed = await h.Store.CommitAsync(note.NoteId, Body("edited"), note.Ver, "req-1");

        // A caller handing back a note object that still carries an older version, a restore, or a
        // client that held its copy across an edit. The stored version must still move forward.
        var restored = new Note { NoteId = note.NoteId, Title = note.Title, Ver = 0, Blocks = Body("restored") };
        var result = await h.Store.PutAsync(restored);

        Assert.Equal(committed.Ver + 1, result.Ver);
        Assert.Equal(committed.Ver + 1, (await h.Notes.GetNoteAsync(note.NoteId))!.Ver);
    }

    [Fact]
    public async Task An_edit_token_from_before_a_restore_is_not_valid_after_it()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var baseVer = note.Ver;
        await h.Store.PutAsync(new Note { NoteId = note.NoteId, Title = note.Title, Blocks = Body("restored to the original text") });

        // The client still holds baseVer and the content once again looks like what it edited.
        var result = await h.Store.CommitAsync(note.NoteId, Body("late write"), baseVer, "req-late");

        Assert.Equal(NoteCommitOutcome.Stale, result.Outcome);
    }

    [Fact]
    public async Task Delete_removes_the_note_and_its_index_entry_together()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        Assert.True(await h.Store.DeleteAsync(note.NoteId));

        Assert.Null(await h.Notes.GetNoteAsync(note.NoteId));
        Assert.DoesNotContain(note.NoteId, (await h.Storage.LoadAsync<List<string>>("notes_index")).Value!);
        Assert.Empty(await h.Notes.GetAllNotesAsync());
    }

    [Fact]
    public async Task A_recreated_note_id_does_not_inherit_the_old_request_id()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        await h.Store.CommitAsync(note.NoteId, Body("before"), note.Ver, "req-1");
        await h.Store.DeleteAsync(note.NoteId);

        var recreated = new Note { NoteId = note.NoteId, Title = "again", Sid = "zzzzzz", Blocks = [NoteSidMigrationHarness.TextBlock("aaaaa")] };
        var put = await h.Store.PutAsync(recreated);

        // Replaying the old request id must write, not be swallowed as already-applied.
        var result = await h.Store.CommitAsync(note.NoteId, Body("after"), put.Ver, "req-1");

        Assert.Equal(NoteCommitOutcome.Applied, result.Outcome);
        Assert.Equal("after", (await h.Notes.GetNoteAsync(note.NoteId))!.Blocks![0].Content);
    }

    // ------------------------------------------------------------- metadata and body compose

    [Fact]
    public async Task Renaming_an_open_note_leaves_the_version_the_editor_is_holding_valid()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        // The version an editor mounted at, before anyone renamed anything.
        var editing = note.Ver;

        var renamed = await h.Store.UpdateMetadataAsync(note.NoteId, NoteMetadata.FromNote(note) with { Title = "Renamed" });
        var saved = await h.Store.CommitAsync(note.NoteId, Body("typed after the rename"), editing, "req-1");

        Assert.Equal(NoteCommitOutcome.Applied, renamed.Outcome);
        Assert.Equal(editing, renamed.Ver);
        Assert.Equal(NoteCommitOutcome.Applied, saved.Outcome);

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal("Renamed", stored.Title);
        Assert.Equal("typed after the rename", stored.Blocks![0].Content);
    }

    [Fact]
    public async Task Tagging_and_reordering_an_open_note_also_leave_its_version_alone()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        await h.Store.UpdateMetadataAsync(note.NoteId, NoteMetadata.FromNote(note) with { Tags = ["chemistry"] });
        await h.Store.UpdateMetadataAsync(note.NoteId, NoteMetadata.FromNote(note) with { Order = 7 });
        await h.Store.UpdateMetadataAsync(note.NoteId, NoteMetadata.FromNote(note) with { IsFavorite = true, Emoji = "\U0001F9EA" });

        Assert.Equal(note.Ver, (await h.Notes.GetNoteAsync(note.NoteId))!.Ver);
        Assert.Equal(NoteCommitOutcome.Applied, (await h.Store.CommitAsync(note.NoteId, Body("still saves"), note.Ver, "req-1")).Outcome);
    }

    [Fact]
    public async Task A_metadata_write_built_before_a_commit_does_not_undo_that_commit()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        // What a rename request holds after validating: a copy read before the commit landed.
        var readBeforeTheCommit = NoteMetadata.FromNote(note);

        await h.Store.CommitAsync(note.NoteId, Body("committed while the rename was being validated"), note.Ver, "req-1");
        await h.Store.UpdateMetadataAsync(note.NoteId, readBeforeTheCommit with { Title = "Renamed" });

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal("committed while the rename was being validated", stored.Blocks![0].Content);
        Assert.Equal("Renamed", stored.Title);
    }

    [Fact]
    public async Task A_commit_and_a_metadata_write_racing_each_keep_their_own_half()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var results = await Task.WhenAll(
            h.Store.CommitAsync(note.NoteId, Body("typed"), note.Ver, "req-1"),
            h.Store.UpdateMetadataAsync(note.NoteId, NoteMetadata.FromNote(note) with { Title = "Renamed" }));

        Assert.All(results, r => Assert.Equal(NoteCommitOutcome.Applied, r.Outcome));

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal("typed", stored.Blocks![0].Content);
        Assert.Equal("Renamed", stored.Title);
    }

    [Fact]
    public async Task A_metadata_write_to_a_note_that_does_not_exist_reports_not_found()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();

        var result = await h.Store.UpdateMetadataAsync("ghost", NoteMetadata.FromNote(new Note { Title = "x" }));

        Assert.Equal(NoteCommitOutcome.NotFound, result.Outcome);
    }

    // ------------------------------------------------------------- identity

    [Fact]
    public async Task A_note_created_after_the_migration_is_still_given_a_sid()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();

        var note = new Note { Title = "Created after the migration" };
        await h.Store.PutAsync(note);

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.True(Sid.IsWellFormedNoteSid(stored.Sid));
    }

    [Fact]
    public async Task Notes_created_one_after_another_do_not_share_a_sid()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();

        var sids = new List<string>();
        for (var i = 0; i < 12; i++)
        {
            var note = new Note { Title = $"n{i}" };
            await h.Store.PutAsync(note);
            sids.Add((await h.Notes.GetNoteAsync(note.NoteId))!.Sid);
        }

        Assert.All(sids, s => Assert.True(Sid.IsWellFormedNoteSid(s)));
        Assert.Equal(sids.Count, sids.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public async Task A_new_note_carrying_a_sid_another_note_already_holds_is_given_a_different_one()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var collider = new Note { Title = "Imported", Sid = note.Sid };
        await h.Store.PutAsync(collider);

        var stored = (await h.Notes.GetNoteAsync(collider.NoteId))!;
        Assert.True(Sid.IsWellFormedNoteSid(stored.Sid));
        Assert.NotEqual(note.Sid, stored.Sid);
        Assert.Equal(note.Sid, (await h.Notes.GetNoteAsync(note.NoteId))!.Sid);
    }

    [Fact]
    public async Task A_stored_note_keeps_its_sid_when_a_caller_writes_a_different_one()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        await h.Store.PutAsync(new Note { NoteId = note.NoteId, Title = note.Title, Sid = "zzzzzz" });

        Assert.Equal(note.Sid, (await h.Notes.GetNoteAsync(note.NoteId))!.Sid);
    }

    [Fact]
    public async Task A_whole_note_write_gives_blocks_that_arrive_without_a_sid_one()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();

        var note = new Note
        {
            Title = "Written by a tool",
            Blocks =
            [
                new Block { Type = BlockType.Text, Children = [new Block { Type = BlockType.Text }] },
                new Block { Type = BlockType.Text },
            ],
        };

        await h.Store.PutAsync(note);

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        var sids = AllBlockSids(stored.Blocks!);
        Assert.Equal(3, sids.Count);
        Assert.All(sids, s => Assert.True(Sid.IsWellFormedBlockSid(s)));
        Assert.Equal(3, sids.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public async Task A_whole_note_write_cannot_store_two_blocks_under_the_same_sid()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();

        var note = new Note
        {
            Title = "Written by a tool",
            Blocks =
            [
                new Block { Type = BlockType.Text, Sid = "bbbbb" },
                new Block { Type = BlockType.Text, Sid = "bbbbb" },
            ],
        };

        await h.Store.PutAsync(note);

        var sids = AllBlockSids((await h.Notes.GetNoteAsync(note.NoteId))!.Blocks!);
        Assert.Equal(2, sids.Distinct(StringComparer.Ordinal).Count());
        Assert.Contains("bbbbb", sids);
    }

    [Fact]
    public async Task A_commit_cannot_store_two_blocks_under_the_same_sid()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        await h.Store.CommitAsync(
            note.NoteId,
            [new Block { Type = BlockType.Text, Sid = "ccccc" }, new Block { Type = BlockType.Text, Sid = "ccccc" }],
            note.Ver,
            "req-1");

        var sids = AllBlockSids((await h.Notes.GetNoteAsync(note.NoteId))!.Blocks!);
        Assert.Equal(2, sids.Distinct(StringComparer.Ordinal).Count());
    }

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
}
