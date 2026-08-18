using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Services;

/// <summary>
/// Opening a database against a build that may be older than the one that wrote it.
/// </summary>
/// <remarks>
/// DbVersion was written once and never read, so an older build opening a newer database
/// went ahead and wrote back through assumptions that no longer held. Nothing has needed
/// the guard yet, because every schema change so far has been additive, which is exactly
/// why it is worth having one before a change that is not.
/// </remarks>
public sealed class SqliteStorageProviderSchemaTests
{
    [Fact]
    public async Task A_database_from_a_newer_build_is_refused()
    {
        var path = TempDatabasePath();
        try
        {
            await WriteSchemaVersionAsync(path, 999);
            var provider = new SqliteStorageProvider(new TestLogger(), path);

            var result = await provider.SaveAsync("App.Theme", "dark");

            Assert.False(result.IsSuccess);
            Assert.Contains("newer version of Mnemo", result.Exception?.Message ?? string.Empty);
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public async Task A_database_at_this_build_s_version_opens_and_round_trips()
    {
        var path = TempDatabasePath();
        try
        {
            await WriteSchemaVersionAsync(path, 1);
            var provider = new SqliteStorageProvider(new TestLogger(), path);

            Assert.True((await provider.SaveAsync("App.Theme", "dark")).IsSuccess);

            var loaded = await provider.LoadAsync<string>("App.Theme");
            Assert.True(loaded.IsSuccess);
            Assert.Equal("dark", loaded.Value);
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public async Task A_database_this_build_creates_records_its_version()
    {
        var path = TempDatabasePath();
        try
        {
            var provider = new SqliteStorageProvider(new TestLogger(), path);
            Assert.True((await provider.SaveAsync("App.Theme", "dark")).IsSuccess);

            Assert.Equal(1, await ReadSchemaVersionAsync(path));
        }
        finally
        {
            Delete(path);
        }
    }

    private static string TempDatabasePath() =>
        Path.Combine(Path.GetTempPath(), $"mnemo_storage_{Guid.NewGuid():N}.db");

    /// <summary>
    /// Writes only the version marker, leaving the provider to create the rest, so the test
    /// says which build wrote the database without restating its whole schema.
    /// </summary>
    private static async Task WriteSchemaVersionAsync(string path, int version)
    {
        await using var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText =
            "CREATE TABLE IF NOT EXISTS DbVersion (Version INTEGER PRIMARY KEY, AppliedAt TEXT);"
            + "INSERT INTO DbVersion (Version, AppliedAt) VALUES ($version, $date);";
        command.Parameters.AddWithValue("$version", version);
        command.Parameters.AddWithValue("$date", DateTime.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<int> ReadSchemaVersionAsync(string path)
    {
        await using var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT MAX(Version) FROM DbVersion";
        var value = await command.ExecuteScalarAsync();
        return value is null or DBNull ? 0 : Convert.ToInt32(value);
    }

    private static void Delete(string path)
    {
        SqliteConnection.ClearAllPools();
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (IOException)
        {
            // A temp file the OS is still holding is not a test failure.
        }
    }
}
