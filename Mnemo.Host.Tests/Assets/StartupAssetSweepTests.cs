using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Services;
using Xunit;

namespace Mnemo.Host.Tests.Assets;

public sealed class StartupAssetSweepTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "mnemo-startup-sweep", Guid.NewGuid().ToString("N"));
    private readonly string _orphan;

    public StartupAssetSweepTests()
    {
        Directory.CreateDirectory(_directory);
        _orphan = Path.Combine(_directory, "orphan.png");
        File.WriteAllBytes(_orphan, [1, 2, 3]);
        var old = DateTime.UtcNow - TimeSpan.FromDays(2);
        File.SetCreationTimeUtc(_orphan, old);
        File.SetLastWriteTimeUtc(_orphan, old);
    }

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    private StartupAssetSweep Sweep(Source source, string? standDown = null, TimeSpan? timeout = null) =>
        new(
            [(new ManagedAssetStore(() => _directory, ManagedAssetStore.ImageExtensions), [source])],
            new ImageFileLocks(),
            () => standDown,
            new NullLogger(),
            timeout ?? TimeSpan.FromSeconds(30));

    [Fact]
    public async Task AFinishedReadOpensTheGateAndDeletesOrphans()
    {
        var sweep = Sweep(new Source(() => Task.FromResult<IReadOnlyCollection<string>>([])));

        await sweep.RunAsync();

        Assert.True(sweep.ReferencesRead.IsCompletedSuccessfully);
        Assert.False(File.Exists(_orphan));
    }

    [Fact]
    public async Task AFailedReadOpensTheGateAndDeletesNothing()
    {
        var sweep = Sweep(new Source(() => throw new InvalidOperationException("unreadable")));

        await sweep.RunAsync();

        Assert.True(sweep.ReferencesRead.IsCompletedSuccessfully);
        Assert.True(File.Exists(_orphan));
    }

    [Fact]
    public async Task StandingDownOpensTheGateWithoutReading()
    {
        var read = false;
        var sweep = Sweep(new Source(() => { read = true; return Task.FromResult<IReadOnlyCollection<string>>([]); }), "another app instance is running");

        await sweep.RunAsync();

        Assert.True(sweep.ReferencesRead.IsCompletedSuccessfully);
        Assert.False(read);
        Assert.True(File.Exists(_orphan));
    }

    [Fact]
    public async Task ASourceThatIsNotReadyOpensTheGateAndDeletesNothing()
    {
        var sweep = Sweep(new Source(() => Task.FromResult<IReadOnlyCollection<string>>([])) { IsReady = false });

        await sweep.RunAsync();

        Assert.True(sweep.ReferencesRead.IsCompletedSuccessfully);
        Assert.True(File.Exists(_orphan));
    }

    [Fact]
    public async Task ASlowReadOpensTheGateAndNeverDeletesLate()
    {
        var late = new TaskCompletionSource<IReadOnlyCollection<string>>();
        var sweep = Sweep(new Source(() => late.Task), timeout: TimeSpan.FromMilliseconds(50));

        await sweep.RunAsync();
        late.SetResult([]);
        await Task.Delay(100);

        Assert.True(sweep.ReferencesRead.IsCompletedSuccessfully);
        Assert.True(File.Exists(_orphan));
    }

    private sealed class Source(Func<Task<IReadOnlyCollection<string>>> read) : IAssetReferenceSource
    {
        public bool IsReady { get; init; } = true;

        public Task<IReadOnlyCollection<string>> CollectReferencedIdsAsync(CancellationToken cancellationToken = default) => read();
    }

    private sealed class NullLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
