using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Infrastructure.Common;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

public class SqliteStorageProvider : IStorageProvider
{
    /// <summary>
    /// The schema version this build writes and knows how to read.
    /// </summary>
    /// <remarks>
    /// Raise this in the same change that alters the shape of what is stored. It has stayed
    /// at 1 because every change so far has been additive, which an older build tolerates by
    /// ignoring what it does not recognise. A change that is not additive is the one that
    /// needs the number, and the guard in the initializer is what makes it mean something.
    /// </remarks>
    private const int SchemaVersion = 1;

    private readonly string _connectionString;
    private readonly ILoggerService _logger;
    private readonly Lazy<Task> _initTask;

    /// <param name="databasePath">Optional absolute DB path (tests). Defaults to app user data <c>mnemo.db</c>.</param>
    public SqliteStorageProvider(ILoggerService logger, string? databasePath = null)
    {
        _logger = logger;
        var dbPath = databasePath ?? MnemoAppPaths.GetLocalUserDataFile("mnemo.db");
        var dbDir = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrWhiteSpace(dbDir))
        {
            Directory.CreateDirectory(dbDir);
        }
        _connectionString = $"Data Source={dbPath}";
        _initTask = new Lazy<Task>(() => InitializeDatabaseAsync());
    }

    private async Task EnsureInitializedAsync()
    {
        await _initTask.Value.ConfigureAwait(false);
    }

    /// <summary>
    /// Opens a connection carrying the same settings the other stores open theirs with.
    /// </summary>
    /// <remarks>
    /// busy_timeout is the one that matters here. Without it a write that arrives while
    /// another connection holds the lock fails at once with SQLITE_BUSY instead of waiting,
    /// and this provider is what settings are stored through, so the failure reaches a
    /// person as a setting that said it saved and did not. Two instances against one
    /// database make that ordinary rather than theoretical, and the note, flashcard and
    /// mindmap stores have all been waiting five seconds for the lock for some time.
    /// </remarks>
    private async Task<SqliteConnection> OpenConnectionAsync()
    {
        var connection = new SqliteConnection(_connectionString);
        try
        {
            await connection.OpenAsync(CancellationToken.None).ConfigureAwait(false);

            using var pragma = connection.CreateCommand();
            pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;";
            await pragma.ExecuteNonQueryAsync(CancellationToken.None).ConfigureAwait(false);

            return connection;
        }
        catch
        {
            // The caller never received it, so nothing else is going to close it.
            connection.Dispose();
            throw;
        }
    }

    private async Task InitializeDatabaseAsync()
    {
        try
        {
            using var connection = await OpenConnectionAsync().ConfigureAwait(false);
            using var command = connection.CreateCommand();

            command.CommandText = "CREATE TABLE IF NOT EXISTS Storage (Key TEXT PRIMARY KEY, Value TEXT)";
            await command.ExecuteNonQueryAsync(CancellationToken.None).ConfigureAwait(false);

            command.CommandText = "CREATE TABLE IF NOT EXISTS DbVersion (Version INTEGER PRIMARY KEY, AppliedAt TEXT)";
            await command.ExecuteNonQueryAsync(CancellationToken.None).ConfigureAwait(false);

            command.CommandText = "SELECT MAX(Version) FROM DbVersion";
            var storedObj = await command.ExecuteScalarAsync(CancellationToken.None).ConfigureAwait(false);

            // MAX over an empty table answers NULL, which is a database this build has not
            // written to yet rather than one at version zero.
            var stored = storedObj is null or DBNull ? 0 : Convert.ToInt32(storedObj);

            // Written by a build newer than this one. Carrying on would read it through this
            // build's assumptions and write back over whatever it did not understand, so this
            // stops while that is still recoverable.
            if (stored > SchemaVersion)
            {
                throw new InvalidOperationException(
                    $"This database was written by a newer version of Mnemo (schema {stored}, and this build "
                    + $"understands {SchemaVersion}). Update Mnemo, or start it against a different data folder.");
            }

            if (stored < SchemaVersion)
            {
                command.CommandText = "INSERT INTO DbVersion (Version, AppliedAt) VALUES ($version, $date)";
                command.Parameters.Clear();
                command.Parameters.AddWithValue("$version", SchemaVersion);
                command.Parameters.AddWithValue("$date", DateTime.UtcNow.ToString("O"));
                await command.ExecuteNonQueryAsync(CancellationToken.None).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            _logger.Error("Storage", "Storage database initialization failed.", ex);
            throw;
        }
    }

    public async Task<Result> SaveAsync<T>(string key, T data)
    {
        try
        {
            await EnsureInitializedAsync().ConfigureAwait(false);
            // JsonSerializer.Serialize is synchronous CPU work. For large payloads (e.g. a Note with
            // 1500 blocks) this would block the UI thread for 10-30 ms on every autosave when callers
            // invoke SaveAsync from a UI dispatcher tick. Dispatching to the threadpool keeps the UI
            // responsive and lets SQLite I/O overlap with the next frame.
            var json = await Task.Run(() => JsonSerializer.Serialize(data)).ConfigureAwait(false);
            using var connection = await OpenConnectionAsync().ConfigureAwait(false);
            var command = connection.CreateCommand();
            command.CommandText = "INSERT OR REPLACE INTO Storage (Key, Value) VALUES ($key, $value)";
            command.Parameters.AddWithValue("$key", key);
            command.Parameters.AddWithValue("$value", json);
            await command.ExecuteNonQueryAsync().ConfigureAwait(false);
            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.Error("Storage", $"Failed to save data for key: {key}", ex);
            return Result.Failure($"Failed to save data for key: {key}", ex);
        }
    }

    public async Task<Result<T?>> LoadAsync<T>(string key)
    {
        try
        {
            await EnsureInitializedAsync().ConfigureAwait(false);
            using var connection = await OpenConnectionAsync().ConfigureAwait(false);
            var command = connection.CreateCommand();
            command.CommandText = "SELECT Value FROM Storage WHERE Key = $key";
            command.Parameters.AddWithValue("$key", key);
            var result = await command.ExecuteScalarAsync().ConfigureAwait(false);
            if (result is string json)
            {
                var data = JsonSerializer.Deserialize<T>(json);
                return Result<T?>.Success(data);
            }
            return Result<T?>.Failure("Key not found");
        }
        catch (Exception ex)
        {
            _logger.Error("Storage", $"Failed to load data for key: {key}", ex);
            return Result<T?>.Failure($"Failed to load data for key: {key}", ex);
        }
    }

    public async Task<Result> DeleteAsync(string key)
    {
        try
        {
            await EnsureInitializedAsync().ConfigureAwait(false);
            using var connection = await OpenConnectionAsync().ConfigureAwait(false);
            var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM Storage WHERE Key = $key";
            command.Parameters.AddWithValue("$key", key);
            await command.ExecuteNonQueryAsync().ConfigureAwait(false);
            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.Error("Storage", $"Failed to delete data for key: {key}", ex);
            return Result.Failure($"Failed to delete data for key: {key}", ex);
        }
    }
}

