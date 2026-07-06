using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// SQLite-backed <see cref="IFlashcardStore"/>. Holds one owned writer connection (WAL,
/// foreign keys on) guarded by a single-writer semaphore, so every write is serialized and each
/// <see cref="WriteAsync"/> body commits as one atomic transaction. Reads open short-lived pooled
/// connections and run concurrently.
/// </summary>
public sealed class FlashcardStore : IFlashcardStore, IAsyncDisposable
{
    private readonly string _connectionString;
    private readonly ILoggerService _logger;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly SemaphoreSlim _initGate = new(1, 1);

    private SqliteConnection? _writer;
    private bool _initialized;

    /// <param name="databasePath">Optional absolute DB path (tests). Defaults to app user data <c>mnemo.db</c>.</param>
    public FlashcardStore(ILoggerService logger, string? databasePath = null)
    {
        _logger = logger;
        var dbPath = databasePath ?? MnemoAppPaths.GetLocalUserDataFile("mnemo.db");
        var dbDir = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrWhiteSpace(dbDir))
            Directory.CreateDirectory(dbDir);
        _connectionString = $"Data Source={dbPath}";
    }

    /// <inheritdoc />
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
            await ApplyConnectionPragmasAsync(writer, cancellationToken, isWriter: true).ConfigureAwait(false);

            await using (var cmd = writer.CreateCommand())
            {
                cmd.CommandText = FlashcardStoreSchema.CreateSql;
                await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await EnsureSchemaVersionAsync(writer, cancellationToken).ConfigureAwait(false);

            _writer = writer;
            _initialized = true;
        }
        catch (Exception ex)
        {
            _logger.Error("Flashcards", "Flashcard store initialization failed.", ex);
            throw;
        }
        finally
        {
            _initGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<T> ReadAsync<T>(Func<SqliteConnection, CancellationToken, Task<T>> read, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(read);
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ApplyConnectionPragmasAsync(connection, cancellationToken, isWriter: false).ConfigureAwait(false);
        return await read(connection, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task WriteAsync(Func<SqliteConnection, SqliteTransaction, CancellationToken, Task> write, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(write);
        return WriteAsync(async (conn, tx, ct) =>
        {
            await write(conn, tx, ct).ConfigureAwait(false);
            return true;
        }, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<T> WriteAsync<T>(Func<SqliteConnection, SqliteTransaction, CancellationToken, Task<T>> write, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(write);
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var writer = _writer ?? throw new InvalidOperationException("Flashcard store writer connection is not available.");
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

    private static async Task ApplyConnectionPragmasAsync(SqliteConnection connection, CancellationToken cancellationToken, bool isWriter)
    {
        await using var cmd = connection.CreateCommand();
        // foreign_keys must be set per connection so ON DELETE CASCADE/SET NULL actually fire.
        // busy_timeout guards the rare cross-connection contention window; WAL is a database-level
        // setting but is cheap to (re)assert and only meaningfully applied by the writer.
        cmd.CommandText = isWriter
            ? "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"
            : "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;";
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureSchemaVersionAsync(SqliteConnection writer, CancellationToken cancellationToken)
    {
        await using var check = writer.CreateCommand();
        check.CommandText = "SELECT MAX(Version) FROM FlashcardSchemaVersion;";
        var current = await check.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        var version = current is null || current == DBNull.Value ? 0 : Convert.ToInt32(current);
        if (version >= FlashcardStoreSchema.TargetVersion)
            return;

        await using var insert = writer.CreateCommand();
        insert.CommandText = "INSERT OR IGNORE INTO FlashcardSchemaVersion (Version, AppliedAt) VALUES ($v, $at);";
        insert.Parameters.AddWithValue("$v", FlashcardStoreSchema.TargetVersion);
        insert.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        await insert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
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
}
