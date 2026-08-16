using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Notes;

public class NoteCommitStoreTests
{
    private static Note Snapshot(Note stored, string text) => new()
    {
        NoteId = stored.NoteId,
        Title = stored.Title,
        Blocks = [new Block { Type = BlockType.Text, Sid = "aaaaa", Spans = [InlineSpan.Plain(text)] }],
    };

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

        var result = await h.Store.CommitAsync(Snapshot(note, "written"), note.Ver, "req-1");

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

        await h.Store.CommitAsync(Snapshot(note, "first"), note.Ver, "req-1");
        var result = await h.Store.CommitAsync(Snapshot(note, "second"), note.Ver, "req-2");

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

        var first = await h.Store.CommitAsync(Snapshot(note, "once"), note.Ver, "req-1");
        // The same request arriving again, carrying the same now-stale base version, as it would
        // after a dropped acknowledgement.
        var replay = await h.Store.CommitAsync(Snapshot(note, "once"), note.Ver, "req-1");

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

        var first = await h.Store.CommitAsync(Snapshot(note, "first"), note.Ver, "req-1");
        await h.Store.CommitAsync(Snapshot(note, "second"), first.Ver, "req-2");

        var lateReplay = await h.Store.CommitAsync(Snapshot(note, "first"), note.Ver, "req-1");

        Assert.Equal(NoteCommitOutcome.Stale, lateReplay.Outcome);
        Assert.Equal("second", (await h.Notes.GetNoteAsync(note.NoteId))!.Blocks![0].Content);
    }

    [Fact]
    public async Task A_commit_cannot_change_the_identity_of_the_note_it_targets()
    {
        var (h, note) = await MigratedNoteAsync();
        await using var _ = h;

        var tampered = Snapshot(note, "x");
        tampered.Sid = "hijack";
        tampered.CreatedAt = new DateTime(1999, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        await h.Store.CommitAsync(tampered, note.Ver, "req-1");

        var stored = (await h.Notes.GetNoteAsync(note.NoteId))!;
        Assert.Equal(note.Sid, stored.Sid);
        Assert.Equal(note.CreatedAt, stored.CreatedAt);
    }

    [Fact]
    public async Task Committing_to_a_note_that_does_not_exist_reports_not_found()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.NewMigrator().MigrateAsync();

        var result = await h.Store.CommitAsync(new Note { Title = "ghost" }, 0, "req-1");

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
            var result = await h.Store.CommitAsync(Snapshot(note, $"edit {i}"), ver, $"req-{i}");
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
                h.Store.CommitAsync(Snapshot(note, $"racer {i}"), note.Ver, $"req-{i}")));

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

        var committed = await h.Store.CommitAsync(Snapshot(note, "edited"), note.Ver, "req-1");

        // A caller handing back a note object that still carries an older version — a restore, or a
        // client that held its copy across an edit. The stored version must still move forward.
        var restored = Snapshot(note, "restored");
        restored.Ver = 0;
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
        var restored = Snapshot(note, "restored to the original text");
        await h.Store.PutAsync(restored);

        // The client still holds baseVer and the content once again looks like what it edited.
        var result = await h.Store.CommitAsync(Snapshot(note, "late write"), baseVer, "req-late");

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

        await h.Store.CommitAsync(Snapshot(note, "before"), note.Ver, "req-1");
        await h.Store.DeleteAsync(note.NoteId);

        var recreated = new Note { NoteId = note.NoteId, Title = "again", Sid = "zzzzzz", Blocks = [NoteSidMigrationHarness.TextBlock("aaaaa")] };
        var put = await h.Store.PutAsync(recreated);

        // Replaying the old request id must write, not be swallowed as already-applied.
        var result = await h.Store.CommitAsync(Snapshot(recreated, "after"), put.Ver, "req-1");

        Assert.Equal(NoteCommitOutcome.Applied, result.Outcome);
        Assert.Equal("after", (await h.Notes.GetNoteAsync(note.NoteId))!.Blocks![0].Content);
    }
}
