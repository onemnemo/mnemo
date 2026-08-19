using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Spins up a <see cref="MindmapStore"/> and <see cref="MindmapDocumentService"/> over a throwaway temp
/// database, and cleans up the file (plus WAL sidecars) on dispose.
/// </summary>
internal sealed class MindmapTestHarness : IAsyncDisposable
{
    private readonly string _dbPath;

    public MindmapStore Store { get; }

    public MindmapDocumentService Service { get; }

    /// <summary>The database file, so a test can put a row in it that no write path would produce.</summary>
    public string DatabasePath => _dbPath;

    /// <summary>
    /// Runs one statement against the database directly, for tests that need a row no write path
    /// would produce. The statement may name the map as <c>$id</c>.
    /// </summary>
    public async Task DamageAsync(string sql, string mapId)
    {
        await using var connection = new SqliteConnection($"Data Source={_dbPath}");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("$id", mapId);
        await command.ExecuteNonQueryAsync();
    }

    public MindmapTestHarness(MindmapShortIdGenerator? idGenerator = null)
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_mm_{Guid.NewGuid():N}.db");
        Store = new MindmapStore(new TestLogger(), _dbPath);
        Service = new MindmapDocumentService(Store, new TestLogger(), idGenerator);
    }

    public async ValueTask DisposeAsync()
    {
        await Store.DisposeAsync();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_dbPath + suffix); }
            catch { /* best effort */ }
        }
    }
}
