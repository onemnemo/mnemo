using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Trash;
using Xunit;

namespace Mnemo.Host.Tests.Trash;

public sealed class AssetCleanupWorkerTests
{
    [Fact]
    public async Task ADeferredJobCountsAnAttemptSoItMovesBehindTheOthers()
    {
        var store = new RecordingStore("young.png");
        var worker = new AssetCleanupWorker(store, [new FixedOwner(AssetCleanupOutcome.Deferred)], new SilentLogger());

        await worker.RunAsync();

        Assert.Equal(["young.png"], store.Failed);
        Assert.Empty(store.Completed);
    }

    [Theory]
    [InlineData(AssetCleanupOutcome.Deleted)]
    [InlineData(AssetCleanupOutcome.Missing)]
    [InlineData(AssetCleanupOutcome.StillReferenced)]
    public async Task EveryOtherOutcomeRetiresTheJob(AssetCleanupOutcome outcome)
    {
        var store = new RecordingStore("file.png");
        var worker = new AssetCleanupWorker(store, [new FixedOwner(outcome)], new SilentLogger());

        await worker.RunAsync();

        Assert.Equal(["file.png"], store.Completed);
        Assert.Empty(store.Failed);
    }

    private sealed class FixedOwner(AssetCleanupOutcome outcome) : IAssetCleanupOwner
    {
        public string Owner => "test";

        public bool IsReady => true;

        public Task<AssetCleanupOutcome> DeleteIfUnreferencedAsync(string path, CancellationToken cancellationToken = default) =>
            Task.FromResult(outcome);
    }

    private sealed class RecordingStore(string path) : IAssetCleanupStore
    {
        private readonly AssetCleanupJob _job = new(path, "test", path, DateTimeOffset.UnixEpoch, 0, null);

        public List<string> Completed { get; } = [];

        public List<string> Failed { get; } = [];

        public Task<IReadOnlyList<AssetCleanupJob>> ListPendingAsync(int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<AssetCleanupJob>>([_job]);

        public Task<int> CountPendingAsync(CancellationToken cancellationToken = default) => Task.FromResult(1);

        public Task CompleteAsync(string jobId, CancellationToken cancellationToken = default)
        {
            Completed.Add(jobId);
            return Task.CompletedTask;
        }

        public Task FailAsync(string jobId, string error, CancellationToken cancellationToken = default)
        {
            Failed.Add(jobId);
            return Task.CompletedTask;
        }
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
