using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Infrastructure.Services.Trash;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Trash;

/// <summary>
/// The handover between a module destroying rows and the application removing the files those rows
/// were the last owners of.
/// </summary>
public sealed class AssetCleanupQueueTests
{
    private static readonly DateTimeOffset Origin = new(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task A_file_named_by_a_committed_purge_is_waiting_to_be_removed()
    {
        await using var fixture = new CleanupFixture();
        await using (var connection = await fixture.OpenAsync())
        {
            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
            await AssetCleanupQueue.EnqueueAsync(connection, transaction, "notes", "assets/a.png", Origin);
            await transaction.CommitAsync();
        }

        var job = Assert.Single(await fixture.Store.ListPendingAsync(10));
        Assert.Equal("notes", job.Owner);
        Assert.Equal("assets/a.png", job.Path);
        Assert.Equal(0, job.Attempts);
        Assert.Null(job.LastError);
    }

    [Fact]
    public async Task A_purge_that_never_committed_leaves_no_file_marked_for_removal()
    {
        await using var fixture = new CleanupFixture();
        await using (var connection = await fixture.OpenAsync())
        {
            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
            await AssetCleanupQueue.EnqueueAsync(connection, transaction, "notes", "assets/a.png", Origin);
            await transaction.RollbackAsync();
        }

        Assert.Equal(0, await fixture.Store.CountPendingAsync());
    }

    [Fact]
    public async Task The_same_file_named_twice_by_one_module_is_removed_once()
    {
        await using var fixture = new CleanupFixture();
        await fixture.EnqueueAsync("notes", "assets/a.png");
        await fixture.EnqueueAsync("notes", "assets/a.png");

        Assert.Equal(1, await fixture.Store.CountPendingAsync());
    }

    [Fact]
    public async Task Two_modules_naming_the_same_path_each_get_their_own_job()
    {
        await using var fixture = new CleanupFixture();
        await fixture.EnqueueAsync("notes", "assets/a.png");
        await fixture.EnqueueAsync("mindmaps", "assets/a.png");

        var owners = (await fixture.Store.ListPendingAsync(10)).Select(j => j.Owner).OrderBy(o => o).ToList();

        Assert.Equal(["mindmaps", "notes"], owners);
    }

    [Fact]
    public async Task A_path_that_says_nothing_is_not_queued()
    {
        await using var fixture = new CleanupFixture();
        await using var connection = await fixture.OpenAsync();
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
        await AssetCleanupQueue.EnqueueAsync(connection, transaction, "notes", ["", "   "], Origin);
        await transaction.CommitAsync();

        Assert.Equal(0, await fixture.Store.CountPendingAsync());
    }

    [Fact]
    public async Task A_removed_file_leaves_the_queue()
    {
        await using var fixture = new CleanupFixture();
        await fixture.EnqueueAsync("notes", "assets/a.png");
        var job = Assert.Single(await fixture.Store.ListPendingAsync(10));

        await fixture.Store.CompleteAsync(job.Id);

        Assert.Equal(0, await fixture.Store.CountPendingAsync());
    }

    [Fact]
    public async Task A_file_that_could_not_be_removed_lets_the_rest_of_the_queue_go_first()
    {
        await using var fixture = new CleanupFixture();
        await fixture.EnqueueAsync("notes", "locked.png");
        await fixture.EnqueueAsync("notes", "next.png", Origin.AddMinutes(1));

        var locked = (await fixture.Store.ListPendingAsync(10)).Single(j => j.Path == "locked.png");
        await fixture.Store.FailAsync(locked.Id, "the file is in use");

        var queue = await fixture.Store.ListPendingAsync(10);

        Assert.Equal(["next.png", "locked.png"], queue.Select(j => j.Path));
        Assert.Equal(1, queue[1].Attempts);
        Assert.Equal("the file is in use", queue[1].LastError);
    }

    [Fact]
    public async Task A_module_can_queue_a_file_before_the_trash_has_opened_its_tables()
    {
        var path = TempDatabasePath();
        try
        {
            await using (var connection = new SqliteConnection(ConnectionString(path)))
            {
                await connection.OpenAsync();
                await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
                await AssetCleanupQueue.EnqueueAsync(connection, transaction, "notes", "assets/a.png", Origin);
                await transaction.CommitAsync();
            }

            await using var database = new TrashDatabase(new TestLogger(), path);
            var store = new AssetCleanupStore(database);

            Assert.Equal(1, await store.CountPendingAsync());
        }
        finally
        {
            Delete(path);
        }
    }

    private static string TempDatabasePath() =>
        Path.Combine(Path.GetTempPath(), $"mnemo_cleanup_{Guid.NewGuid():N}.db");

    private static string ConnectionString(string path) =>
        new SqliteConnectionStringBuilder { DataSource = path }.ToString();

    private static void Delete(string path)
    {
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try
            {
                File.Delete(path + suffix);
            }
            catch
            {
                // Best effort: a leftover temp file is not worth failing a test over.
            }
        }
    }

    /// <summary>An initialized set of trash tables in a throwaway database.</summary>
    private sealed class CleanupFixture : IAsyncDisposable
    {
        private readonly string _path = TempDatabasePath();

        public CleanupFixture()
        {
            Database = new TrashDatabase(new TestLogger(), _path);
            Store = new AssetCleanupStore(Database);
        }

        public TrashDatabase Database { get; }

        public AssetCleanupStore Store { get; }

        /// <summary>A second connection, standing in for the one a module purges through.</summary>
        public async Task<SqliteConnection> OpenAsync()
        {
            await Database.InitializeAsync();
            var connection = new SqliteConnection(ConnectionString(_path));
            await connection.OpenAsync();
            return connection;
        }

        public async Task EnqueueAsync(string owner, string path, DateTimeOffset? enqueuedAt = null)
        {
            await using var connection = await OpenAsync();
            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
            await AssetCleanupQueue.EnqueueAsync(connection, transaction, owner, path, enqueuedAt ?? Origin);
            await transaction.CommitAsync();
        }

        public async ValueTask DisposeAsync()
        {
            await Database.DisposeAsync();
            Delete(_path);
        }
    }
}
