using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Identity;
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
///
/// Every write reads the stored note inside its own transaction and changes only what that write
/// owns, so two writers touching different halves of a note compose instead of racing.
/// </summary>
public sealed class NoteCommitStore : INoteCommitStore, IAsyncDisposable
{
    /// <summary>The storage key of the note id index. Owned here; readers must not restate it.</summary>
    public const string IndexKey = "notes_index";

    private readonly ILoggerService _logger;
    private readonly SidGenerator _sids;
    private readonly string _connectionString;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly SemaphoreSlim _initGate = new(1, 1);
    private SqliteConnection? _writer;
    private bool _initialized;

    /// <param name="databasePath">Optional absolute DB path (tests). Defaults to app user data <c>mnemo.db</c>.</param>
    /// <param name="sids">Optional generator, so a test can force a collision deterministically.</param>
    public NoteCommitStore(ILoggerService logger, string? databasePath = null, SidGenerator? sids = null)
    {
        _logger = logger;
        _sids = sids ?? new SidGenerator();
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

    public Task<NoteCommitResult> CommitAsync(string noteId, IReadOnlyList<Block>? blocks, long baseVer, string requestId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(noteId);
        if (string.IsNullOrWhiteSpace(requestId))
            throw new ArgumentException("A commit needs a request id to be idempotent on retry.", nameof(requestId));

        return WriteAsync(async (conn, tx, ct) =>
        {
            var stored = await ReadValueAsync<Note>(conn, tx, NoteKey(noteId), ct).ConfigureAwait(false);
            if (stored is null)
                return new NoteCommitResult(NoteCommitOutcome.NotFound, 0);

            // Checked before the version, because a retry of a commit that already landed carries a
            // base version that is now genuinely stale. Reading it as a conflict would turn a dropped
            // acknowledgement into a spurious merge prompt.
            var lastRequest = await ReadValueAsync<NoteCommitMark>(conn, tx, CommitKey(noteId), ct).ConfigureAwait(false);
            if (lastRequest is not null && lastRequest.RequestId == requestId)
                return new NoteCommitResult(NoteCommitOutcome.AlreadyApplied, stored.Ver);

            if (stored.Ver != baseVer)
                return new NoteCommitResult(NoteCommitOutcome.Stale, stored.Ver);

            // The stored note is what gets written back, so a commit is structurally unable to carry
            // a title, a sid or a folder along with the body it was asked to write.
            stored.Blocks = blocks is null ? null : [.. blocks];
            BlockSids.Repair(stored.Blocks, _sids);
            stored.Ver += 1;
            stored.ModifiedAt = DateTime.UtcNow;

            await WriteValueAsync(conn, tx, NoteKey(noteId), stored, ct).ConfigureAwait(false);
            await WriteValueAsync(conn, tx, CommitKey(noteId), new NoteCommitMark(requestId, stored.Ver), ct).ConfigureAwait(false);
            await EnsureIndexedAsync(conn, tx, noteId, ct).ConfigureAwait(false);

            return new NoteCommitResult(NoteCommitOutcome.Applied, stored.Ver);
        }, cancellationToken);
    }

    public Task<NoteCommitResult> UpdateMetadataAsync(string noteId, NoteMetadata metadata, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(noteId);
        ArgumentNullException.ThrowIfNull(metadata);

        return WriteAsync(async (conn, tx, ct) =>
        {
            var stored = await ReadValueAsync<Note>(conn, tx, NoteKey(noteId), ct).ConfigureAwait(false);
            if (stored is null)
                return new NoteCommitResult(NoteCommitOutcome.NotFound, 0);

            metadata.ApplyTo(stored);
            stored.ModifiedAt = DateTime.UtcNow;

            // The version is deliberately left alone. It counts body revisions, and every open editor
            // holds one as its edit token; advancing it for a rename would fail their next save as a
            // conflict they have no way to resolve.
            await WriteValueAsync(conn, tx, NoteKey(noteId), stored, ct).ConfigureAwait(false);
            await EnsureIndexedAsync(conn, tx, noteId, ct).ConfigureAwait(false);

            return new NoteCommitResult(NoteCommitOutcome.Applied, stored.Ver);
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

            await AssignNoteSidAsync(conn, tx, note, stored, ct).ConfigureAwait(false);
            BlockSids.Repair(note.Blocks, _sids);

            await WriteValueAsync(conn, tx, NoteKey(note.NoteId), note, ct).ConfigureAwait(false);
            await EnsureIndexedAsync(conn, tx, note.NoteId, ct).ConfigureAwait(false);

            return new NoteCommitResult(NoteCommitOutcome.Applied, note.Ver);
        }, cancellationToken);
    }

    /// <summary>
    /// Gives <paramref name="note"/> the sid it will be stored under. A note that already exists keeps
    /// the one it has, because a sid is durable identity and callers hand back stale copies of it.
    /// Anything else is minted against the sids the corpus currently holds, inside this transaction,
    /// so two notes created at once cannot be handed the same one.
    /// </summary>
    private async Task AssignNoteSidAsync(SqliteConnection conn, SqliteTransaction tx, Note note, Note? stored, CancellationToken ct)
    {
        if (stored is not null && Sid.IsWellFormedNoteSid(stored.Sid))
        {
            note.Sid = stored.Sid;
            return;
        }

        var taken = await ReadNoteSidsAsync(conn, tx, note.NoteId, ct).ConfigureAwait(false);
        if (!Sid.IsWellFormedNoteSid(note.Sid) || taken.Contains(note.Sid))
            note.Sid = _sids.NextNoteSid(taken);
    }

    /// <summary>
    /// The sids every other note holds. Read out of the stored row rather than by loading notes,
    /// because deserializing the corpus would parse every block in the database to answer a question
    /// about one field.
    /// </summary>
    private static async Task<HashSet<string>> ReadNoteSidsAsync(SqliteConnection conn, SqliteTransaction tx, string exceptNoteId, CancellationToken ct)
    {
        var sids = new HashSet<string>(StringComparer.Ordinal);

        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        // The folder rows share the note_ prefix, and the index and migration marker do not, which is
        // why the underscore is matched literally rather than scanned for with a wildcard.
        cmd.CommandText =
            @"SELECT COALESCE(json_extract(Value, '$.Sid'), json_extract(Value, '$.sid'))
              FROM Storage
              WHERE Key LIKE 'note\_%' ESCAPE '\'
                AND Key NOT LIKE 'note\_folder\_%' ESCAPE '\'
                AND Key <> $self";
        cmd.Parameters.AddWithValue("$self", NoteKey(exceptNoteId));

        await using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            if (!await reader.IsDBNullAsync(0, ct).ConfigureAwait(false) && reader.GetString(0) is { Length: > 0 } sid)
                sids.Add(sid);
        }

        return sids;
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
