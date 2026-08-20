using Mnemo.Core.Identity;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Notes.Persistence;

namespace Mnemo.Infrastructure.Tests.Notes;

public class NoteSidMigratorTests
{
    [Fact]
    public async Task Migration_gives_every_note_and_block_a_sid_and_a_starting_version()
    {
        await using var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(
            NoteSidMigrationHarness.TextBlock(),
            NoteSidMigrationHarness.TextBlock()));

        await h.NewMigrator().MigrateAsync();

        var note = (await h.Notes.GetNoteAsync(seeded.NoteId))!;
        Assert.True(Sid.IsWellFormedNoteSid(note.Sid));
        Assert.Equal(1, note.Ver);
        Assert.All(note.Blocks!, b => Assert.True(Sid.IsWellFormedBlockSid(b.Sid)));
        Assert.Equal(2, note.Blocks!.Select(b => b.Sid).Distinct().Count());
    }

    [Fact]
    public async Task Nested_child_blocks_are_migrated_too()
    {
        await using var h = new NoteSidMigrationHarness();
        var parent = NoteSidMigrationHarness.TextBlock();
        parent.Children = [NoteSidMigrationHarness.TextBlock(), NoteSidMigrationHarness.TextBlock()];
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(parent));

        await h.NewMigrator().MigrateAsync();

        var note = (await h.Notes.GetNoteAsync(seeded.NoteId))!;
        var children = note.Blocks![0].Children!;
        Assert.All(children, c => Assert.True(Sid.IsWellFormedBlockSid(c.Sid)));
        Assert.NotEqual(children[0].Sid, children[1].Sid);
    }

    [Fact]
    public async Task Running_twice_changes_nothing_the_second_time()
    {
        await using var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(
            NoteSidMigrationHarness.TextBlock(),
            NoteSidMigrationHarness.TextBlock()));

        await h.NewMigrator().MigrateAsync();
        var afterFirst = (await h.Notes.GetNoteAsync(seeded.NoteId))!;
        var sids = afterFirst.Blocks!.Select(b => b.Sid).ToList();

        // A fresh migrator, so completion is read from the persisted marker rather than memory.
        await h.NewMigrator().MigrateAsync();

        var afterSecond = (await h.Notes.GetNoteAsync(seeded.NoteId))!;
        Assert.Equal(afterFirst.Sid, afterSecond.Sid);
        Assert.Equal(afterFirst.Ver, afterSecond.Ver);
        Assert.Equal(sids, afterSecond.Blocks!.Select(b => b.Sid));
    }

    [Fact]
    public async Task Migration_does_not_count_as_modifying_the_note()
    {
        await using var h = new NoteSidMigrationHarness();
        var stamp = new DateTime(2020, 3, 4, 5, 6, 7, DateTimeKind.Utc);
        var seeded = await h.SeedAsync(new Note
        {
            Title = "Old",
            ModifiedAt = stamp,
            CreatedAt = stamp,
            Blocks = [NoteSidMigrationHarness.TextBlock()],
        });

        await h.NewMigrator().MigrateAsync();

        var note = (await h.Notes.GetNoteAsync(seeded.NoteId))!;
        Assert.Equal(stamp, note.ModifiedAt);
        Assert.Equal(stamp, note.CreatedAt);
    }

    [Fact]
    public async Task An_interrupted_run_is_finished_by_the_next_one()
    {
        await using var h = new NoteSidMigrationHarness();
        var first = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));
        var second = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));

        // Enough sids for one note, then the generator throws, standing in for a crash part way
        // through the corpus, after at least one note has been committed.
        var starved = new SidGeneratorOverride("aaaaaa", "bbbbb");
        await Assert.ThrowsAnyAsync<Exception>(() => h.NewMigrator(starved).MigrateAsync());

        var partial = (await h.Notes.GetAllNotesAsync()).ToList();
        Assert.Contains(partial, n => Sid.IsWellFormedNoteSid(n.Sid));
        Assert.Contains(partial, n => !Sid.IsWellFormedNoteSid(n.Sid));
        Assert.False((await h.Storage.LoadAsync<NoteSidMigrator.NoteSidMigrationMark>(NoteSidMigrator.MarkKey)).Value?.Status == NoteSidMigrator.CompleteStatus);

        await h.NewMigrator().MigrateAsync();

        var all = (await h.Notes.GetAllNotesAsync()).ToList();
        Assert.All(all, n => Assert.True(Sid.IsWellFormedNoteSid(n.Sid)));
        Assert.All(all, n => Assert.All(n.Blocks!, b => Assert.True(Sid.IsWellFormedBlockSid(b.Sid))));
        Assert.Equal(2, all.Select(n => n.Sid).Distinct().Count());
        _ = first;
        _ = second;
    }

    [Fact]
    public async Task The_note_migrated_before_an_interruption_keeps_its_sid_when_the_run_resumes()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));
        await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));

        await Assert.ThrowsAnyAsync<Exception>(() => h.NewMigrator(new SidGeneratorOverride("aaaaaa", "bbbbb")).MigrateAsync());
        var survivor = (await h.Notes.GetAllNotesAsync()).Single(n => Sid.IsWellFormedNoteSid(n.Sid));

        await h.NewMigrator().MigrateAsync();

        var after = (await h.Notes.GetNoteAsync(survivor.NoteId))!;
        Assert.Equal(survivor.Sid, after.Sid);
        Assert.Equal(survivor.Blocks![0].Sid, after.Blocks![0].Sid);
    }

    [Fact]
    public async Task A_backup_of_the_database_is_taken_before_anything_is_written()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));

        await h.NewMigrator().MigrateAsync();

        var backups = Directory.GetFiles(h.BackupDirectory, "mnemo-pre-sid-*.db");
        var backup = Assert.Single(backups);
        Assert.True(new FileInfo(backup).Length > 0);
    }

    [Fact]
    public async Task The_backup_holds_the_pre_migration_content_and_can_be_read_back()
    {
        await using var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));

        await h.NewMigrator().MigrateAsync();
        var backup = Directory.GetFiles(h.BackupDirectory, "mnemo-pre-sid-*.db").Single();

        // Reading the backup through the same storage code proves it is a usable database, not just
        // a file of the right size.
        await using var backupStore = new NoteCommitStore(h.Logger, backup);
        var restored = new Mnemo.Infrastructure.Services.NoteService(
            new Mnemo.Infrastructure.Services.SqliteStorageProvider(h.Logger, backup), backupStore, backupStore);
        var original = await restored.GetNoteAsync(seeded.NoteId);

        Assert.NotNull(original);
        Assert.Equal(string.Empty, original!.Sid);
        Assert.Equal(0, original.Ver);
        Assert.Equal(string.Empty, original.Blocks![0].Sid);
    }

    [Fact]
    public async Task A_resumed_run_keeps_the_original_backup_rather_than_snapshotting_half_migrated_data()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));
        await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));

        await Assert.ThrowsAnyAsync<Exception>(() => h.NewMigrator(new SidGeneratorOverride("aaaaaa", "bbbbb")).MigrateAsync());
        var firstBackup = Directory.GetFiles(h.BackupDirectory, "*.db").Single();

        await h.NewMigrator().MigrateAsync();

        Assert.Equal(firstBackup, Assert.Single(Directory.GetFiles(h.BackupDirectory, "*.db")));
    }

    [Fact]
    public async Task Duplicate_block_sids_are_repaired_and_the_first_block_keeps_its_own()
    {
        await using var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(
            NoteSidMigrationHarness.TextBlock("aaaaa"),
            NoteSidMigrationHarness.TextBlock("aaaaa")));

        await h.NewMigrator().MigrateAsync();

        var blocks = (await h.Notes.GetNoteAsync(seeded.NoteId))!.Blocks!;
        Assert.Equal("aaaaa", blocks[0].Sid);
        Assert.NotEqual("aaaaa", blocks[1].Sid);
        Assert.True(Sid.IsWellFormedBlockSid(blocks[1].Sid));
    }

    [Fact]
    public async Task Repairing_an_early_block_does_not_steal_a_sid_a_later_block_is_keeping()
    {
        await using var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(
            NoteSidMigrationHarness.TextBlock("bad!"),
            NoteSidMigrationHarness.TextBlock("zzzzz")));

        // The generator offers the sid the second block already holds before offering a free one.
        await h.NewMigrator(new SidGeneratorOverride("nnnnnn", "zzzzz", "qqqqq")).MigrateAsync();

        var blocks = (await h.Notes.GetNoteAsync(seeded.NoteId))!.Blocks!;
        Assert.Equal("qqqqq", blocks[0].Sid);
        Assert.Equal("zzzzz", blocks[1].Sid);
    }

    [Theory]
    [InlineData("")]
    [InlineData("abc")]      // too short
    [InlineData("abcd0")]    // outside the alphabet
    [InlineData("ABCDE")]    // wrong case
    public async Task An_unusable_block_sid_is_replaced(string stored)
    {
        await using var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock(stored)));

        await h.NewMigrator().MigrateAsync();

        var sid = (await h.Notes.GetNoteAsync(seeded.NoteId))!.Blocks![0].Sid;
        Assert.True(Sid.IsWellFormedBlockSid(sid));
        Assert.NotEqual(stored, sid);
    }

    [Fact]
    public async Task Duplicate_note_sids_are_repaired_across_the_corpus()
    {
        await using var h = new NoteSidMigrationHarness();
        var a = await h.SeedAsync(new Note { Title = "A", Sid = "shared", Blocks = [NoteSidMigrationHarness.TextBlock()] });
        var b = await h.SeedAsync(new Note { Title = "B", Sid = "shared", Blocks = [NoteSidMigrationHarness.TextBlock()] });

        await h.NewMigrator().MigrateAsync();

        var sidA = (await h.Notes.GetNoteAsync(a.NoteId))!.Sid;
        var sidB = (await h.Notes.GetNoteAsync(b.NoteId))!.Sid;
        Assert.NotEqual(sidA, sidB);
        Assert.True(Sid.IsWellFormedNoteSid(sidA));
        Assert.True(Sid.IsWellFormedNoteSid(sidB));
    }

    [Fact]
    public async Task A_note_with_no_blocks_still_gets_a_sid_and_a_version()
    {
        await using var h = new NoteSidMigrationHarness();
        var seeded = await h.SeedAsync(new Note { Title = "Legacy", Content = "plain text", Blocks = null });

        await h.NewMigrator().MigrateAsync();

        var note = (await h.Notes.GetNoteAsync(seeded.NoteId))!;
        Assert.True(Sid.IsWellFormedNoteSid(note.Sid));
        Assert.Equal(1, note.Ver);
        Assert.Null(note.Blocks);
    }

    [Fact]
    public async Task An_empty_corpus_completes_without_a_note_to_migrate()
    {
        await using var h = new NoteSidMigrationHarness();

        var migrator = h.NewMigrator();
        await migrator.MigrateAsync();

        Assert.True(migrator.IsComplete);
        Assert.Empty(h.Logger.Errors);
    }

    [Fact]
    public async Task Notes_stay_closed_when_validation_cannot_pass()
    {
        await using var h = new NoteSidMigrationHarness();
        await h.SeedAsync(NoteSidMigrationHarness.NoteWith(NoteSidMigrationHarness.TextBlock()));

        // A generator that only ever produces a sid too short to validate. The backfill "succeeds"
        // and the corpus check is the thing that has to catch it.
        var migrator = h.NewMigrator(new SidGeneratorOverride("aaaaaa", "bad", "bad", "bad"));
        await migrator.MigrateAsync();

        Assert.False(migrator.IsComplete);
        Assert.Contains(h.Logger.Errors, e => e.Contains("validation failed"));
        Assert.NotEqual(
            NoteSidMigrator.CompleteStatus,
            (await h.Storage.LoadAsync<NoteSidMigrator.NoteSidMigrationMark>(NoteSidMigrator.MarkKey)).Value?.Status);
    }
}
