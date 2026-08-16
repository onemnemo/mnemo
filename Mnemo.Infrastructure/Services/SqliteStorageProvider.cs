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

    private async Task InitializeDatabaseAsync()
    {
        try
        {
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync(CancellationToken.None).ConfigureAwait(false);
            using var command = connection.CreateCommand();

            command.CommandText = "CREATE TABLE IF NOT EXISTS Storage (Key TEXT PRIMARY KEY, Value TEXT)";
            await command.ExecuteNonQueryAsync(CancellationToken.None).ConfigureAwait(false);

            command.CommandText = "CREATE TABLE IF NOT EXISTS DbVersion (Version INTEGER PRIMARY KEY, AppliedAt TEXT)";
            await command.ExecuteNonQueryAsync(CancellationToken.None).ConfigureAwait(false);

            command.CommandText = "SELECT COUNT(*) FROM DbVersion";
            var countObj = await command.ExecuteScalarAsync(CancellationToken.None).ConfigureAwait(false);
            var count = Convert.ToInt32(countObj);
            if (count == 0)
            {
                command.CommandText = "INSERT INTO DbVersion (Version, AppliedAt) VALUES (1, $date)";
                command.Parameters.Clear();
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
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync().ConfigureAwait(false);
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
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync().ConfigureAwait(false);
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
            using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync().ConfigureAwait(false);
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

