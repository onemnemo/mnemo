using Mnemo.Host.Lifecycle;
using Xunit;

namespace Mnemo.Host.Tests.Lifecycle;

public sealed class HostInstanceLockTests : IDisposable
{
    private readonly string _directory =
        Path.Combine(Path.GetTempPath(), "mnemo-host-tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_directory))
            Directory.Delete(_directory, recursive: true);
    }

    [Fact]
    public void ASingleInstanceSeesNoOthers()
    {
        using var only = HostInstanceLock.Acquire(_directory);
        Assert.False(only.AnotherInstanceIsRunning());
    }

    [Fact]
    public void TwoLiveInstancesSeeEachOther()
    {
        using var first = HostInstanceLock.Acquire(_directory);
        using var second = HostInstanceLock.Acquire(_directory);

        Assert.True(first.AnotherInstanceIsRunning());
        Assert.True(second.AnotherInstanceIsRunning());
    }

    [Fact]
    public void AReleasedInstanceStopsCounting()
    {
        using var first = HostInstanceLock.Acquire(_directory);
        var second = HostInstanceLock.Acquire(_directory);
        Assert.True(first.AnotherInstanceIsRunning());

        second.Dispose();
        Assert.False(first.AnotherInstanceIsRunning());
        // Delete-on-close removed the marker with the handle.
        Assert.Single(Directory.GetFiles(_directory, "host-*.lock"));
    }

    [Fact]
    public void AStaleUnheldMarkerIsClearedAndNotCounted()
    {
        // What a power loss leaves behind: a marker file nobody holds.
        Directory.CreateDirectory(_directory);
        var stale = Path.Combine(_directory, "host-deadbeef.lock");
        File.WriteAllBytes(stale, [1]);

        using var only = HostInstanceLock.Acquire(_directory);
        Assert.False(only.AnotherInstanceIsRunning());
        Assert.False(File.Exists(stale));
    }
}
