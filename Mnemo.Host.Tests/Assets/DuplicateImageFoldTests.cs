using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Host.Tests.Assets;

public sealed class DuplicateImageFoldTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "mnemo-fold-tests", Guid.NewGuid().ToString("N"));
    private string? _hold;

    public DuplicateImageFoldTests()
    {
        Directory.CreateDirectory(_directory);
    }

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    private DuplicateImageFold Fold() =>
        new(new ImageFileLocks(), () => _directory, () => _hold, new NullLogger(), TimeSpan.FromMinutes(30));

    private string Write(string name, byte[] bytes, bool old = true)
    {
        var path = Path.Combine(_directory, name);
        File.WriteAllBytes(path, bytes);
        if (old)
        {
            var then = DateTime.UtcNow - TimeSpan.FromDays(2);
            File.SetCreationTimeUtc(path, then);
            File.SetLastWriteTimeUtc(path, then);
        }
        return path;
    }

    private string Marker => Path.Combine(_directory, MnemoAppPaths.ImagesFoldedMarkerName);

    private bool Marked => File.Exists(Marker) && File.ReadAllText(Marker).Length == 0;

    // Only a hard link shows a write through one name in the other.
    private static bool Linked(string first, string second)
    {
        File.WriteAllBytes(first, [42]);
        return File.ReadAllBytes(second).SequenceEqual(new byte[] { 42 });
    }

    [Fact]
    public async Task FoldsIdenticalFilesIntoOneAndLeavesOthersAlone()
    {
        var a = Write("a.png", [1, 2, 3]);
        var b = Write("b.png", [1, 2, 3]);
        var other = Write("c.png", [1, 2, 4]);

        Assert.True(await Fold().RunAsync());

        Assert.Equal(new byte[] { 1, 2, 3 }, File.ReadAllBytes(b));
        Assert.Equal(new byte[] { 1, 2, 4 }, File.ReadAllBytes(other));
        Assert.True(Marked);
        Assert.True(Linked(a, b));
        Assert.False(Linked(a, other));
    }

    [Fact]
    public async Task ThreeCopiesBecomeOneFile()
    {
        var a = Write("a.png", [5, 5]);
        var b = Write("b.png", [5, 5]);
        var c = Write("c.png", [5, 5]);

        Assert.True(await Fold().RunAsync());

        File.WriteAllBytes(a, [42]);
        Assert.Equal(new byte[] { 42 }, File.ReadAllBytes(b));
        Assert.Equal(new byte[] { 42 }, File.ReadAllBytes(c));
    }

    [Fact]
    public async Task AMarkedDirectoryIsLeftAlone()
    {
        var a = Write("a.png", [1, 2, 3]);
        var b = Write("b.png", [1, 2, 3]);
        Write(MnemoAppPaths.ImagesFoldedMarkerName, []);

        Assert.True(await Fold().RunAsync());

        Assert.False(Linked(a, b));
    }

    [Fact]
    public async Task AnUnreadableFileEndsTheRunAndIsRetriedNextRun()
    {
        if (!OperatingSystem.IsWindows())
            return;
        var a = Write("a.png", [1, 2, 3]);
        var b = Write("b.png", [1, 2, 3]);

        using (File.Open(b, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            Assert.False(await Fold().RunAsync());

        Assert.False(Marked);
        Assert.True(await Fold().RunAsync());
        Assert.True(Linked(a, b));
    }

    [Fact]
    public async Task ThePassStopsAfterThreeFailedRuns()
    {
        if (!OperatingSystem.IsWindows())
            return;
        var a = Write("a.png", [1, 2, 3]);
        var b = Write("b.png", [1, 2, 3]);

        using (File.Open(b, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            Assert.False(await Fold().RunAsync());
            Assert.False(await Fold().RunAsync());
            Assert.True(await Fold().RunAsync());
        }

        Assert.True(Marked);
        Assert.False(Linked(a, b));
    }

    [Fact]
    public async Task WaitingOnAYoungFileNeverEndsThePass()
    {
        Write("a.png", [1, 2, 3]);
        Write("b.png", [1, 2, 3], old: false);

        for (var run = 0; run < 4; run++)
            Assert.False(await Fold().RunAsync());

        Assert.False(File.Exists(Marker));
    }

    [Fact]
    public async Task AYoungDuplicateWaitsForALaterRun()
    {
        var a = Write("a.png", [1, 2, 3]);
        var b = Write("b.png", [1, 2, 3], old: false);

        Assert.False(await Fold().RunAsync());

        Assert.False(Marked);
        Assert.False(Linked(a, b));
    }

    [Fact]
    public async Task AHoldStopsThePassBeforeAnythingChanges()
    {
        var a = Write("a.png", [1, 2, 3]);
        var b = Write("b.png", [1, 2, 3]);
        _hold = "another app instance is running";

        Assert.False(await Fold().RunAsync());

        Assert.False(Marked);
        Assert.False(Linked(a, b));
    }

    [Fact]
    public async Task LeftoverTempFilesAreRemovedFirst()
    {
        var leftover = Write("a.png.folding", [9]);

        Assert.True(await Fold().RunAsync());

        Assert.False(File.Exists(leftover));
    }

    [Fact]
    public async Task LeftoverTempFilesAreRemovedEvenOnceMarked()
    {
        Write(MnemoAppPaths.ImagesFoldedMarkerName, []);
        var leftover = Write("a.png.0123.folding", [9]);

        Assert.True(await Fold().RunAsync());

        Assert.False(File.Exists(leftover));
    }

    [Fact]
    public async Task NoTempSurvivesAPairThatIsAlreadyOneFile()
    {
        var a = Write("a.png", [1, 2, 3]);
        var b = Write("b.png", [1, 2, 3]);
        Assert.True(await Fold().RunAsync());
        File.Delete(Path.Combine(_directory, MnemoAppPaths.ImagesFoldedMarkerName));

        Assert.True(await Fold().RunAsync());

        Assert.Empty(Directory.GetFiles(_directory, "*.folding"));
        Assert.True(Linked(a, b));
    }

    [Fact]
    public async Task ADuplicateInUseIsKeptAndRetriedNextRun()
    {
        if (!OperatingSystem.IsWindows())
            return;
        var a = Write("a.png", [1, 2, 3]);
        var b = Write("b.png", [1, 2, 3]);

        using (File.Open(b, FileMode.Open, FileAccess.Read, FileShare.Read))
            Assert.False(await Fold().RunAsync());

        Assert.False(Marked);
        Assert.Equal(new byte[] { 1, 2, 3 }, File.ReadAllBytes(b));
        Assert.True(await Fold().RunAsync());
        Assert.True(Linked(a, b));
    }

    private sealed class NullLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
