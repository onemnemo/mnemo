using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// The shared application database as the trash subsystem sees it: the ledger and the asset
/// cleanup queue. Holds one owned writer connection guarded by a single-writer semaphore; reads
/// open short-lived pooled connections and run concurrently.
/// </summary>
/// <remarks>
/// The ledger and the cleanup queue share one writer because they are created together and are
/// written by the same background passes, so a second writer connection would only add contention.
/// </remarks>
public sealed class TrashDatabase : IAsyncDisposable
{
    private readonly string _connectionString;
    private readonly ILoggerService _logger;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly SemaphoreSlim _initGate = new(1, 1);

    private SqliteConnection? _writer;
    private bool _initialized;

    /// <param name="logger">Where initialization failures are reported.</param>
    /// <param name="databasePath">Optional absolute DB path (tests). Defaults to app user data <c>mnemo.db</c>.</param>
    public TrashDatabase(ILoggerService logger, string? databasePath = null)
    {
        _logger = logger;
        var dbPath = databasePath ?? MnemoAppPaths.GetLocalUserDataFile("mnemo.db");
        var dbDir = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrWhiteSpace(dbDir))
            Directory.CreateDirectory(dbDir);
        _connectionString = $"Data Source={dbPath}";
    }

    /// <summary>Creates the trash tables if they are not already there.</summary>
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
            await ApplyPragmasAsync(writer, isWriter: true, cancellationToken).ConfigureAwait(false);

            await using (var cmd = writer.CreateCommand())
            {
                cmd.CommandText = TrashSchema.CreateSql;
                await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            _writer = writer;
            _initialized = true;
        }
        catch (Exception ex)
        {
            _logger.Error("Trash", "Trash database initialization failed.", ex);
            throw;
        }
        finally
        {
            _initGate.Release();
        }
    }

    /// <summary>Runs one statement on the owned writer, serialized against every other write.</summary>
    public async Task<int> ExecuteAsync(string sql, Action<SqliteCommand>? bind, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var writer = _writer ?? throw new InvalidOperationException("Trash database writer connection is not available.");
            await using var cmd = writer.CreateCommand();
            cmd.CommandText = sql;
            bind?.Invoke(cmd);
            return await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>Reads every row a statement returns, on a connection of its own.</summary>
    public async Task<IReadOnlyList<T>> QueryAsync<T>(
        string sql,
        Action<SqliteCommand>? bind,
        Func<SqliteDataReader, T> map,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(map);
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = await OpenReadAsync(cancellationToken).ConfigureAwait(false);
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        bind?.Invoke(cmd);

        var rows = new List<T>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            rows.Add(map(reader));
        return rows;
    }

    /// <summary>Reads a single count, on a connection of its own.</summary>
    public async Task<int> CountAsync(string sql, Action<SqliteCommand>? bind, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = await OpenReadAsync(cancellationToken).ConfigureAwait(false);
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        bind?.Invoke(cmd);
        var scalar = await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return scalar is null or DBNull ? 0 : Convert.ToInt32(scalar);
    }

    /// <summary>Closes the owned writer connection.</summary>
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

    private async Task<SqliteConnection> OpenReadAsync(CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(_connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            await ApplyPragmasAsync(connection, isWriter: false, cancellationToken).ConfigureAwait(false);
            RegisterSearchFunction(connection);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private static async Task ApplyPragmasAsync(SqliteConnection connection, bool isWriter, CancellationToken cancellationToken)
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

    /// <summary>
    /// Case-insensitive substring matching for title search.
    /// </summary>
    /// <remarks>
    /// SQLite's own LIKE and lower() fold ASCII only, which would make searching a Japanese or
    /// German title behave differently from searching an English one. Doing the comparison in
    /// managed code keeps one behaviour across every language the application ships.
    /// </remarks>
    private static void RegisterSearchFunction(SqliteConnection connection) =>
        connection.CreateFunction(
            "mnemo_icontains",
            (string? haystack, string? needle) =>
                haystack is not null && needle is not null &&
                haystack.Contains(needle, StringComparison.OrdinalIgnoreCase),
            isDeterministic: true);
}
