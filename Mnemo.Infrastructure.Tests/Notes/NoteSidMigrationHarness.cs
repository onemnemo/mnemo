using System;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Notes.Persistence;

namespace Mnemo.Infrastructure.Tests.Notes;

/// <summary>
/// A real SQLite database in a scratch directory. These tests exercise transaction and crash
/// behaviour, so an in-memory fake would prove nothing about the thing under test.
/// </summary>
internal sealed class NoteSidMigrationHarness : IAsyncDisposable
{
    private readonly string _directory;

    public NoteSidMigrationHarness()
    {
        _directory = Path.Combine(Path.GetTempPath(), "mnemo-sid-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_directory);
        DatabasePath = Path.Combine(_directory, "mnemo.db");

        Logger = new RecordingLogger();
        Storage = new SqliteStorageProvider(Logger, DatabasePath);
        Store = new NoteCommitStore(Logger, DatabasePath);
        Notes = new NoteService(Storage, Store, Store);
        Folders = new NoteFolderService(Storage, Store, Store);
    }

    public string DatabasePath { get; }
    public RecordingLogger Logger { get; }
    public SqliteStorageProvider Storage { get; }
    public NoteService Notes { get; }
    public NoteCommitStore Store { get; }
    public NoteFolderService Folders { get; }

    public string BackupDirectory => Path.Combine(_directory, "backups");

    public NoteSidMigrator NewMigrator(SidGeneratorOverride? sids = null) =>
        new(Storage, Notes, Store, Logger, DatabasePath, sids?.Generator);

    /// <summary>Writes a note straight to storage, bypassing the commit store, as pre-migration data.</summary>
    public async Task<Note> SeedAsync(Note note)
    {
        await Storage.SaveAsync($"note_{note.NoteId}", note);
        var index = (await Storage.LoadAsync<List<string>>("notes_index")).Value ?? new List<string>();
        if (!index.Contains(note.NoteId))
        {
            index.Add(note.NoteId);
            await Storage.SaveAsync("notes_index", index);
        }

        return note;
    }

    public static Note NoteWith(params Block[] blocks) => new()
    {
        Title = "Seeded",
        Blocks = blocks.Length == 0 ? null : [.. blocks],
    };

    public static Block TextBlock(string sid = "") => new() { Type = BlockType.Text, Sid = sid };

    public async ValueTask DisposeAsync()
    {
        await Store.DisposeAsync();
        try
        {
            Directory.Delete(_directory, recursive: true);
        }
        catch (IOException)
        {
            // A scratch directory that outlives the test run is noise, not a failure.
        }
    }
}

internal sealed class SidGeneratorOverride
{
    public SidGeneratorOverride(params string[] values)
    {
        var queue = new Queue<string>(values);
        Generator = new Mnemo.Core.Identity.SidGenerator(_ => queue.Count > 0 ? queue.Dequeue() : throw new InvalidOperationException("SidGeneratorOverride ran out of values."));
    }

    public Mnemo.Core.Identity.SidGenerator Generator { get; }
}

internal sealed class RecordingLogger : ILoggerService
{
    public List<string> Errors { get; } = [];

    public void Log(LogLevel level, string category, string message, Exception? exception = null)
    {
        if (level is LogLevel.Error or LogLevel.Critical)
            Errors.Add(message);
    }
}
