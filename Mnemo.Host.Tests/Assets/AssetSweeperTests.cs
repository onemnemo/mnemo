using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Xunit;

namespace Mnemo.Host.Tests.Assets;

public sealed class AssetSweeperTests : IDisposable
{
    private readonly string _directory =
        Path.Combine(Path.GetTempPath(), "mnemo-host-tests", Guid.NewGuid().ToString("N"));

    private readonly ManagedAssetStore _store;
    private readonly AssetSessionRegistry _sessions = new();
    private readonly FakeReferenceSource _references = new();

    public AssetSweeperTests()
    {
        _store = new ManagedAssetStore(() => _directory, ManagedAssetStore.ImageExtensions);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory))
            Directory.Delete(_directory, recursive: true);
    }

    private AssetSweeper Sweeper(TimeSpan? grace = null, Func<string?>? standDown = null) =>
        new(_store, [_references], _sessions, new NullLogger(), grace ?? TimeSpan.FromMinutes(30), standDown: standDown);

    /// <summary>A file old enough to be outside any grace window.</summary>
    private string WriteOldFile(string name)
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, name);
        File.WriteAllBytes(path, [1, 2, 3]);
        var old = DateTime.UtcNow - TimeSpan.FromDays(2);
        File.SetCreationTimeUtc(path, old);
        File.SetLastWriteTimeUtc(path, old);
        return path;
    }

    private string WriteFreshFile(string name)
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, name);
        File.WriteAllBytes(path, [1, 2, 3]);
        return path;
    }

    [Fact]
    public async Task DeletesAnOldUnreferencedAsset()
    {
        var orphan = WriteOldFile("aaaa.png");

        var result = await Sweeper().SweepAsync();

        Assert.True(result.Swept);
        Assert.Equal(1, result.Deleted);
        Assert.False(File.Exists(orphan));
    }

    [Fact]
    public async Task KeepsAReferencedAsset()
    {
        var referenced = WriteOldFile("aaaa.png");
        _references.Ids.Add("aaaa.png");

        var result = await Sweeper().SweepAsync();

        Assert.Equal(0, result.Deleted);
        Assert.True(File.Exists(referenced));
    }

    [Fact]
    public async Task KeepsAnAssetReferencedByBareId()
    {
        // The shape an `attachment:{guid}:{name}` reference reports: the guid, no extension.
        var referenced = WriteOldFile("cafe01.png");
        _references.Ids.Add("cafe01");

        var result = await Sweeper().SweepAsync();

        Assert.Equal(0, result.Deleted);
        Assert.True(File.Exists(referenced));
    }

    [Fact]
    public async Task KeepsAFreshUnreferencedAsset()
    {
        // An upload can exist before the document referencing it is saved.
        var fresh = WriteFreshFile("bbbb.png");

        var result = await Sweeper().SweepAsync();

        Assert.Equal(0, result.Deleted);
        Assert.True(File.Exists(fresh));
    }

    [Fact]
    public async Task LeavesForeignFilesAlone()
    {
        var foreign = WriteOldFile("Thumbs.db");

        var result = await Sweeper().SweepAsync();

        Assert.Equal(0, result.Deleted);
        Assert.True(File.Exists(foreign));
    }

    [Fact]
    public async Task DeletesAnAbandonedPendingUpload()
    {
        var pending = WriteOldFile("cccc.png" + ManagedAssetStore.PendingUploadSuffix);

        var result = await Sweeper().SweepAsync();

        Assert.Equal(1, result.Deleted);
        Assert.False(File.Exists(pending));
    }

    [Fact]
    public async Task SkipsWhileAnEditingSessionIsOpen()
    {
        var orphan = WriteOldFile("dddd.png");
        _sessions.Open();

        var result = await Sweeper().SweepAsync();

        Assert.False(result.Swept);
        Assert.True(File.Exists(orphan));
    }

    [Fact]
    public async Task SweepsAgainOnceTheSessionCloses()
    {
        var orphan = WriteOldFile("eeee.png");
        var session = _sessions.Open();

        Assert.False((await Sweeper().SweepAsync()).Swept);
        Assert.True(_sessions.Close(session));
        Assert.Equal(1, (await Sweeper().SweepAsync()).Deleted);
        Assert.False(File.Exists(orphan));
    }

    [Fact]
    public async Task SkipsWhileAReferenceSourceIsNotReady()
    {
        var orphan = WriteOldFile("ffff.png");
        _references.IsReady = false;

        var result = await Sweeper().SweepAsync();

        Assert.False(result.Swept);
        Assert.True(File.Exists(orphan));
    }

    [Fact]
    public async Task AbortsDeletionWhenASessionOpensMidSweep()
    {
        var orphan = WriteOldFile("abcd.png");
        // The registry gets a session between the readiness check and the delete phase; the
        // collector callback is the seam that models "an editor opened while we were scanning".
        _references.OnCollect = () => _sessions.Open();

        var result = await Sweeper().SweepAsync();

        Assert.True(result.Swept);
        Assert.Equal(0, result.Deleted);
        Assert.NotNull(result.SkipReason);
        Assert.True(File.Exists(orphan));
    }

    [Fact]
    public async Task StandsDownWhileTheExternalHoldIsRaised()
    {
        // The notes wiring raises this while another app instance runs: its editor sessions
        // are invisible to this process, so nothing may be deleted under it.
        var orphan = WriteOldFile("0a0a.png");

        var result = await Sweeper(standDown: () => "another app instance is running").SweepAsync();

        Assert.False(result.Swept);
        Assert.True(File.Exists(orphan));
    }

    [Fact]
    public async Task AbortsDeletionWhenTheExternalHoldRaisesMidSweep()
    {
        var orphan = WriteOldFile("0b0b.png");
        var held = false;
        _references.OnCollect = () => held = true;

        var result = await Sweeper(standDown: () => (held ? "another app instance is running" : null)).SweepAsync();

        Assert.True(result.Swept);
        Assert.Equal(0, result.Deleted);
        Assert.True(File.Exists(orphan));
    }

    [Fact]
    public async Task PropagatesAReferenceSourceFailureWithoutDeleting()
    {
        // Fail closed: a corpus that cannot be fully read must abort the sweep, not read as
        // "nothing is referenced".
        var referenced = WriteOldFile("0c0c.png");
        _references.OnCollect = () => throw new InvalidOperationException("corpus unreadable");

        await Assert.ThrowsAsync<InvalidOperationException>(() => Sweeper().SweepAsync());
        Assert.True(File.Exists(referenced));
    }

    [Fact]
    public async Task SweepingAMissingDirectorySucceeds()
    {
        var result = await Sweeper().SweepAsync();

        Assert.True(result.Swept);
        Assert.Equal(0, result.Scanned);
        Assert.Equal(0, result.Deleted);
    }

    [Fact]
    public async Task UnionsReferencesAcrossSources()
    {
        var first = WriteOldFile("1111.png");
        var second = WriteOldFile("2222.png");
        var other = new FakeReferenceSource();
        _references.Ids.Add("1111.png");
        other.Ids.Add("2222.png");
        var sweeper = new AssetSweeper(_store, [_references, other], _sessions, new NullLogger(), TimeSpan.FromMinutes(30));

        var result = await sweeper.SweepAsync();

        Assert.Equal(0, result.Deleted);
        Assert.True(File.Exists(first));
        Assert.True(File.Exists(second));
    }

    private sealed class FakeReferenceSource : IAssetReferenceSource
    {
        public bool IsReady { get; set; } = true;
        public List<string> Ids { get; } = [];
        public Action? OnCollect { get; set; }

        public Task<IReadOnlyCollection<string>> CollectReferencedIdsAsync(CancellationToken cancellationToken = default)
        {
            OnCollect?.Invoke();
            return Task.FromResult<IReadOnlyCollection<string>>(Ids);
        }
    }

    private sealed class NullLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
