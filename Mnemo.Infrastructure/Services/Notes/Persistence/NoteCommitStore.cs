using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Notes.Persistence;

/// <summary>
/// Transactional note writer over the same <c>Storage</c> key/value table the rest of the app reads
/// from, so nothing else has to change to benefit from it. It owns one serialized writer connection
/// in the shape the flashcard and mindmap stores already use on this database.
///
/// Reads still go through <see cref="IStorageProvider"/>; only writes are funnelled here, because a
/// write is the only operation that can leave the note and its index disagreeing.
/// </summary>
public sealed class NoteCommitStore : INoteCommitStore, IAsyncDisposable
{
    /// <summary>The storage key of the note id index. Owned here; readers must not restate it.</summary>
    public const string IndexKey = "notes_index";

    private readonly ILoggerService _logger;
    private readonly string _connectionString;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly SemaphoreSlim _initGate = new(1, 1);
    private SqliteConnection? _writer;
    private bool _initialized;

    /// <param name="databasePath">Optional absolute DB path (tests). Defaults to app user data <c>mnemo.db</c>.</param>
    public NoteCommitStore(ILoggerService logger, string? databasePath = null)
    {
        _logger = logger;
        var dbPath = databasePath ?? MnemoAppPaths.GetLocalUserDataFile("mnemo.db");
        var dbDir = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrWhiteSpace(dbDir))
            Directory.CreateDirectory(dbDir);
        _connectionString = $"Data Source={dbPath}";
    }

    /// <summary>The storage key of one note's row. Owned here; readers must not restate it.</summary>
    public static string NoteKey(string noteId) => $"note_{noteId}";

    /// <summary>
    /// Deliberately not <c>note_commit_</c>: the folder rows are already <c>note_folder_</c>, and a
    /// third key sharing that prefix is how a prefix scan ends up counting the wrong rows.
    /// </summary>
    internal static string CommitKey(string noteId) => $"notecommit_{noteId}";

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (_initialized)
            return;

        await _initGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_initialized)
                return;

            var writer = new SqliteConnection(_connectionString);
            await writer.OpenAsync(cancellationToken).ConfigureAwait(false);
            await using (var cmd = writer.CreateCommand())
            {
                cmd.CommandText =
                    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;" +
                    "CREATE TABLE IF NOT EXISTS Storage (Key TEXT PRIMARY KEY, Value TEXT);";
                await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            _writer = writer;
            _initialized = true;
        }
        catch (Exception ex)
        {
            _logger.Error("Notes", "Note commit store initialization failed.", ex);
            throw;
        }
        finally
        {
            _initGate.Release();
        }
    }

    public Task<NoteCommitResult> CommitAsync(Note note, long baseVer, string requestId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(note);
        if (string.IsNullOrWhiteSpace(requestId))
            throw new ArgumentException("A commit needs a request id to be idempotent on retry.", nameof(requestId));

        return WriteAsync(async (conn, tx, ct) =>
        {
            var stored = await ReadValueAsync<Note>(conn, tx, NoteKey(note.NoteId), ct).ConfigureAwait(false);
            if (stored is null)
                return new NoteCommitResult(NoteCommitOutcome.NotFound, 0);

            // Checked before the version, because a retry of a commit that already landed carries a
            // base version that is now genuinely stale. Reading it as a conflict would turn a dropped
            // acknowledgement into a spurious merge prompt.
            var lastRequest = await ReadValueAsync<NoteCommitMark>(conn, tx, CommitKey(note.NoteId), ct).ConfigureAwait(false);
            if (lastRequest is not null && lastRequest.RequestId == requestId)
                return new NoteCommitResult(NoteCommitOutcome.AlreadyApplied, stored.Ver);

            if (stored.Ver != baseVer)
                return new NoteCommitResult(NoteCommitOutcome.Stale, stored.Ver);

            var nextVer = stored.Ver + 1;
            note.Ver = nextVer;
            note.Sid = stored.Sid;
            note.NoteId = stored.NoteId;
            note.CreatedAt = stored.CreatedAt;
            note.ModifiedAt = DateTime.UtcNow;

            await WriteValueAsync(conn, tx, NoteKey(note.NoteId), note, ct).ConfigureAwait(false);
            await WriteValueAsync(conn, tx, CommitKey(note.NoteId), new NoteCommitMark(requestId, nextVer), ct).ConfigureAwait(false);
            await EnsureIndexedAsync(conn, tx, note.NoteId, ct).ConfigureAwait(false);

            return new NoteCommitResult(NoteCommitOutcome.Applied, nextVer);
        }, cancellationToken);
    }

    public Task<NoteCommitResult> PutAsync(Note note, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(note);

        return WriteAsync(async (conn, tx, ct) =>
        {
            var stored = await ReadValueAsync<Note>(conn, tx, NoteKey(note.NoteId), ct).ConfigureAwait(false);

            // Never resets, so a note restored to older content still advances past every version a
            // client could be holding. An old edit token must not become valid again for new content.
            note.Ver = (stored?.Ver ?? 0) + 1;
            note.ModifiedAt = DateTime.UtcNow;
            if (stored is not null)
                note.CreatedAt = stored.CreatedAt;
            else if (note.CreatedAt == default)
                note.CreatedAt = DateTime.UtcNow;

            await WriteValueAsync(conn, tx, NoteKey(note.NoteId), note, ct).ConfigureAwait(false);
            await EnsureIndexedAsync(conn, tx, note.NoteId, ct).ConfigureAwait(false);

            return new NoteCommitResult(NoteCommitOutcome.Applied, note.Ver);
        }, cancellationToken);
    }

    /// <summary>
    /// Writes a note as part of the sid migration: atomic like any other write, but it leaves
    /// <see cref="Note.ModifiedAt"/> and <see cref="Note.Ver"/> exactly as the caller set them.
    /// Backfilling an identifier is not an edit, and stamping it as one would reorder every
    /// recently-modified list in the app the first time the app started.
    /// </summary>
    internal Task WriteMigratedAsync(Note note, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(note);

        return WriteAsync(async (conn, tx, ct) =>
        {
            await WriteValueAsync(conn, tx, NoteKey(note.NoteId), note, ct).ConfigureAwait(false);
            await EnsureIndexedAsync(conn, tx, note.NoteId, ct).ConfigureAwait(false);
            return true;
        }, cancellationToken);
    }

    public Task<bool> DeleteAsync(string noteId, CancellationToken cancellationToken = default)
    {
        return WriteAsync(async (conn, tx, ct) =>
        {
            var index = await ReadValueAsync<List<string>>(conn, tx, IndexKey, ct).ConfigureAwait(false) ?? new List<string>();
            var removed = index.Remove(noteId);

            await DeleteValueAsync(conn, tx, NoteKey(noteId), ct).ConfigureAwait(false);
            await DeleteValueAsync(conn, tx, CommitKey(noteId), ct).ConfigureAwait(false);
            if (removed)
                await WriteValueAsync(conn, tx, IndexKey, index, ct).ConfigureAwait(false);

            return true;
        }, cancellationToken);
    }

    private static async Task EnsureIndexedAsync(SqliteConnection conn, SqliteTransaction tx, string noteId, CancellationToken ct)
    {
        var index = await ReadValueAsync<List<string>>(conn, tx, IndexKey, ct).ConfigureAwait(false) ?? new List<string>();
        if (index.Contains(noteId))
            return;

        index.Add(noteId);
        await WriteValueAsync(conn, tx, IndexKey, index, ct).ConfigureAwait(false);
    }

    private static async Task<T?> ReadValueAsync<T>(SqliteConnection conn, SqliteTransaction tx, string key, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT Value FROM Storage WHERE Key = $key";
        cmd.Parameters.AddWithValue("$key", key);
        var value = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false) as string;
        return value is null ? default : JsonSerializer.Deserialize<T>(value);
    }

    private static async Task WriteValueAsync<T>(SqliteConnection conn, SqliteTransaction tx, string key, T value, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT OR REPLACE INTO Storage (Key, Value) VALUES ($key, $value)";
        cmd.Parameters.AddWithValue("$key", key);
        cmd.Parameters.AddWithValue("$value", JsonSerializer.Serialize(value));
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private static async Task DeleteValueAsync(SqliteConnection conn, SqliteTransaction tx, string key, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "DELETE FROM Storage WHERE Key = $key";
        cmd.Parameters.AddWithValue("$key", key);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private async Task<T> WriteAsync<T>(Func<SqliteConnection, SqliteTransaction, CancellationToken, Task<T>> write, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var writer = _writer ?? throw new InvalidOperationException("Note commit store writer connection is not available.");
            await using var tx = (SqliteTransaction)await writer.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var result = await write(writer, tx, cancellationToken).ConfigureAwait(false);
                await tx.CommitAsync(cancellationToken).ConfigureAwait(false);
                return result;
            }
            catch
            {
                await tx.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
                throw;
            }
        }
        finally
        {
            _writeGate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_writer is not null)
        {
            await _writer.DisposeAsync().ConfigureAwait(false);
            _writer = null;
        }

        _writeGate.Dispose();
        _initGate.Dispose();
    }

    /// <summary>The last commit applied to a note, so replaying its request id is recognised.</summary>
    internal sealed record NoteCommitMark(string RequestId, long Ver);
}
