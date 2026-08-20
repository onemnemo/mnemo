using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Identity;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Notes.Persistence;

/// <summary>
/// Gives every stored note a corpus-unique sid and a starting version, and every block in it a
/// note-unique sid.
///
/// Restart-safety comes from the data rather than from a checklist: a note is written atomically and
/// only when it needs work, so an interrupted run leaves a mix of finished and untouched notes and
/// resuming is just another pass. The persisted marker records that a backup was taken and that
/// validation passed. It is not a cursor, and losing it costs a re-scan, not correctness.
/// </summary>
public sealed class NoteSidMigrator : INoteSidMigrator
{
    internal const string MarkKey = "notes_sid_migration";
    internal const string CompleteStatus = "complete";
    internal const string StartedStatus = "started";

    private readonly IStorageProvider _storage;
    private readonly INoteService _notes;
    private readonly NoteCommitStore _store;
    private readonly ILoggerService _logger;
    private readonly SidGenerator _sids;
    private readonly string _databasePath;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public NoteSidMigrator(
        IStorageProvider storage,
        INoteService notes,
        NoteCommitStore store,
        ILoggerService logger,
        string? databasePath = null,
        SidGenerator? sids = null)
    {
        _storage = storage;
        _notes = notes;
        _store = store;
        _logger = logger;
        _sids = sids ?? new SidGenerator();
        _databasePath = databasePath ?? MnemoAppPaths.GetLocalUserDataFile("mnemo.db");
    }

    public bool IsComplete { get; private set; }

    public async Task MigrateAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (IsComplete)
                return;

            var mark = (await _storage.LoadAsync<NoteSidMigrationMark>(MarkKey).ConfigureAwait(false)).Value;
            if (mark?.Status == CompleteStatus)
            {
                IsComplete = true;
                return;
            }

            await _store.InitializeAsync(cancellationToken).ConfigureAwait(false);

            // Reuse the backup a previous attempt took. Re-taking it would snapshot a partially
            // migrated database over the only copy of the original.
            var backupPath = mark?.BackupPath is { Length: > 0 } existing && File.Exists(existing)
                ? existing
                : await CreateBackupAsync(cancellationToken).ConfigureAwait(false);

            var startedAt = mark?.StartedAtUtc ?? DateTime.UtcNow;
            await _storage.SaveAsync(MarkKey, new NoteSidMigrationMark(1, StartedStatus, backupPath, startedAt, null)).ConfigureAwait(false);

            await BackfillAsync(cancellationToken).ConfigureAwait(false);

            var problems = await ValidateCorpusAsync(cancellationToken).ConfigureAwait(false);
            if (problems.Count > 0)
            {
                // Left incomplete on purpose. Notes stay closed, the backup stays put, and the next
                // start retries, which is the recoverable outcome. Exposing a corpus that failed its
                // own invariants would hand callers sids they cannot rely on.
                _logger.Error("Notes", $"Sid migration validation failed with {problems.Count} problem(s); notes stay closed. First: {problems[0]}");
                return;
            }

            await _storage.SaveAsync(MarkKey, new NoteSidMigrationMark(1, CompleteStatus, backupPath, startedAt, DateTime.UtcNow)).ConfigureAwait(false);
            IsComplete = true;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task BackfillAsync(CancellationToken cancellationToken)
    {
        var notes = new List<Note>(await _notes.GetAllNotesAsync().ConfigureAwait(false));

        // Seeded from what is already stored so a resumed run cannot hand out a note sid that an
        // earlier pass already committed.
        var noteSids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var note in notes)
        {
            if (Sid.IsWellFormedNoteSid(note.Sid) && !noteSids.Add(note.Sid))
                note.Sid = string.Empty; // duplicate: the first note to claim it keeps it
        }

        var migrated = 0;
        foreach (var note in notes)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var changed = false;

            if (!Sid.IsWellFormedNoteSid(note.Sid))
            {
                note.Sid = _sids.NextNoteSid(noteSids);
                noteSids.Add(note.Sid);
                changed = true;
            }

            if (BlockSids.Repair(note.Blocks, _sids))
                changed = true;

            if (note.Ver < 1)
            {
                note.Ver = 1;
                changed = true;
            }

            if (!changed)
                continue;

            await _store.WriteMigratedAsync(note, cancellationToken).ConfigureAwait(false);
            migrated++;
        }

        if (migrated > 0)
            _logger.Info("Notes", $"Sid migration wrote {migrated} of {notes.Count} note(s).");
    }

    /// <summary>Re-reads everything from storage and checks the invariants the rest of the app is allowed to assume.</summary>
    private async Task<List<string>> ValidateCorpusAsync(CancellationToken cancellationToken)
    {
        var problems = new List<string>();
        var noteSids = new HashSet<string>(StringComparer.Ordinal);

        foreach (var note in await _notes.GetAllNotesAsync().ConfigureAwait(false))
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!Sid.IsWellFormedNoteSid(note.Sid))
                problems.Add($"note {note.NoteId} has sid '{note.Sid}'");
            else if (!noteSids.Add(note.Sid))
                problems.Add($"note sid '{note.Sid}' is used by more than one note");

            if (note.Ver < 1)
                problems.Add($"note {note.NoteId} has version {note.Ver}");

            var blockSids = new HashSet<string>(StringComparer.Ordinal);
            ValidateBlocks(note, note.Blocks, blockSids, problems);
        }

        return problems;
    }

    private static void ValidateBlocks(Note note, IReadOnlyList<Block>? blocks, HashSet<string> seen, List<string> problems)
    {
        if (blocks is null)
            return;

        foreach (var block in blocks)
        {
            if (!Sid.IsWellFormedBlockSid(block.Sid))
                problems.Add($"block {block.Id} in note {note.NoteId} has sid '{block.Sid}'");
            else if (!seen.Add(block.Sid))
                problems.Add($"block sid '{block.Sid}' appears twice in note {note.NoteId}");

            ValidateBlocks(note, block.Children, seen, problems);
        }
    }

    /// <summary>
    /// Snapshots the database with VACUUM INTO, which writes a consistent copy without stopping
    /// writers and without depending on the file being closed.
    /// </summary>
    private async Task<string> CreateBackupAsync(CancellationToken cancellationToken)
    {
        var directory = Path.Combine(Path.GetDirectoryName(_databasePath) ?? ".", "backups");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"mnemo-pre-sid-{DateTime.UtcNow:yyyyMMdd-HHmmss}.db");

        if (File.Exists(path))
            File.Delete(path); // VACUUM INTO refuses to write over an existing file

        await using var connection = new SqliteConnection($"Data Source={_databasePath}");
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "VACUUM INTO $path";
        cmd.Parameters.AddWithValue("$path", path);
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);

        _logger.Info("Notes", $"Sid migration backed the database up to {path}.");
        return path;
    }

    /// <param name="Version">Marker format version, so a later migration can recognise this one.</param>
    /// <param name="Status">"started" once a backup exists, "complete" once validation has passed.</param>
    internal sealed record NoteSidMigrationMark(
        int Version,
        string Status,
        string? BackupPath,
        DateTime StartedAtUtc,
        DateTime? CompletedAtUtc);
}
