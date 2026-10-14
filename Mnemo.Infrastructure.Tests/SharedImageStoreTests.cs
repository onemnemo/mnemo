using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Infrastructure.Services;
using Xunit;

namespace Mnemo.Infrastructure.Tests;

public sealed class SharedImageStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "mnemo-shared-images", Guid.NewGuid().ToString("N"));
    private readonly ImageFileLocks _locks = new();
    private readonly TestLogger _logger = new();
    private readonly SharedImageStore _store;

    public SharedImageStoreTests()
    {
        _store = new SharedImageStore(_locks, _logger, _directory);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory))
            Directory.Delete(_directory, recursive: true);
    }

    private static byte[] Png(byte marker) => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, marker, 1, 2, 3];

    private Task<string> SaveAsync(byte[] bytes, string? claimed = ".png") => _store.SaveAsync(new MemoryStream(bytes), claimed);

    private string[] Files() => Directory.GetFiles(_directory).Select(Path.GetFileName).ToArray()!;

    private string Age(string id)
    {
        var path = Path.Combine(_directory, id);
        var old = DateTime.UtcNow - TimeSpan.FromDays(2);
        File.SetCreationTimeUtc(path, old);
        File.SetLastWriteTimeUtc(path, old);
        return path;
    }

    [Fact]
    public async Task IdenticalBytesShareOneFileUnderTheirHash()
    {
        var first = await SaveAsync(Png(1));
        var second = await SaveAsync(Png(1));

        Assert.Equal(first, second);
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(Png(1))) + ".png", first);
        Assert.True(SharedImageStore.IsContentName(first));
        Assert.Equal([first], Files());
    }

    [Fact]
    public async Task DifferentBytesGetDifferentIds()
    {
        var first = await SaveAsync(Png(1));
        var second = await SaveAsync(Png(2));

        Assert.NotEqual(first, second);
        Assert.Equal(2, Files().Length);
    }

    [Fact]
    public async Task TheExtensionComesFromTheBytes()
    {
        var id = await SaveAsync(Png(1), claimed: null);

        Assert.EndsWith(".png", id);
    }

    [Fact]
    public async Task BytesThatAreNotTheClaimedTypeAreRefusedAndLeaveNothing()
    {
        await Assert.ThrowsAsync<InvalidDataException>(() => SaveAsync(Png(1), ".jpg"));
        await Assert.ThrowsAsync<InvalidDataException>(() => SaveAsync([1, 2, 3], claimed: null));

        Assert.Empty(Files());
    }

    [Fact]
    public async Task ReusingAFileRefreshesItsTimeSoADeleteRightAfterKeepsIt()
    {
        var id = await SaveAsync(Png(1));
        var path = Age(id);

        await SaveAsync(Png(1));

        Assert.False(await _locks.DeleteIfStaleAsync(path, TimeSpan.FromHours(1)));
        Assert.True(File.Exists(path));
    }

    [Fact]
    public async Task ADeleteWaitingOnTheLockSeesATouchMadeWhileItWaited()
    {
        var path = Age(await SaveAsync(Png(1)));
        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();

        var holder = Task.Run(() => _locks.LockedAsync(_directory, () =>
        {
            entered.Set();
            release.Wait();
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow);
            return true;
        }));
        entered.Wait();
        var delete = _locks.DeleteIfStaleAsync(path, TimeSpan.FromHours(1));
        Assert.False(delete.IsCompleted);

        release.Set();
        await holder;

        Assert.False(await delete);
        Assert.True(File.Exists(path));
    }

    [Fact]
    public async Task DeleteIfStaleRemovesAnOldFileAndReportsAMissingOne()
    {
        var path = Age(await SaveAsync(Png(1)));

        Assert.True(await _locks.DeleteIfStaleAsync(path, TimeSpan.FromHours(1)));
        Assert.False(File.Exists(path));
        Assert.False(await _locks.DeleteIfStaleAsync(path, TimeSpan.FromHours(1)));
    }

    [Fact]
    public async Task AHashNameHoldingOtherBytesIsRepairedSoItsReferencesShowTheRightImage()
    {
        var expected = Convert.ToHexStringLower(SHA256.HashData(Png(1))) + ".png";
        Directory.CreateDirectory(_directory);
        File.WriteAllBytes(Path.Combine(_directory, expected), Png(9));

        var id = await SaveAsync(Png(1));

        Assert.Equal(expected, id);
        Assert.Equal(Png(1), File.ReadAllBytes(Path.Combine(_directory, expected)));
        Assert.Equal([expected], Files());
    }

    [Fact]
    public async Task ADamagedFileThatIsOpenIsKeptAndTheSaveGetsANameOfItsOwn()
    {
        if (!OperatingSystem.IsWindows())
            return;
        var expected = Convert.ToHexStringLower(SHA256.HashData(Png(1))) + ".png";
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, expected);
        File.WriteAllBytes(path, Png(9));

        string id;
        using (File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            id = await SaveAsync(Png(1));

        Assert.NotEqual(expected, id);
        Assert.Equal(Png(9), File.ReadAllBytes(path));
        Assert.Equal(Png(1), File.ReadAllBytes(Path.Combine(_directory, id)));
        Assert.Equal(2, Files().Length);
    }

    [Fact]
    public async Task ARestoreOfAContentNameStoresItOnceAndRefreshesTheStoredCopy()
    {
        var name = Convert.ToHexStringLower(SHA256.HashData(Png(1))) + ".png";
        var path = Age(await SaveAsync(Png(1)));

        Assert.True(await _store.RestoreAsync(name, Png(1)));

        Assert.Equal([name], Files());
        Assert.True(ImageFileLocks.IsYoung(path, TimeSpan.FromMinutes(1)));
    }

    [Fact]
    public async Task ARestoreLeavesAnyOtherNameToTheCaller()
    {
        Assert.False(await _store.RestoreAsync("0123456789abcdef0123456789abcdef.png", Png(2)));
        Assert.False(await _store.RestoreAsync("script.exe", Png(2)));

        Assert.False(Directory.Exists(_directory));
    }

    [Fact]
    public async Task ARestoreOfAContentNameItsBytesDoNotMatchWarnsAndLeavesItToTheCaller()
    {
        var wrongHash = Convert.ToHexStringLower(SHA256.HashData(Png(1))) + ".png";

        Assert.False(await _store.RestoreAsync(wrongHash, Png(2)));

        Assert.False(Directory.Exists(_directory));
        Assert.Contains(_logger.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains(wrongHash));
    }

    [Fact]
    public async Task LocateFindsAStoredIdAndRejectsAnythingElse()
    {
        var id = await SaveAsync(Png(1));

        Assert.Equal(Path.Combine(_directory, id), _store.Locate(id));
        Assert.Null(_store.Locate("missing.png"));
        Assert.Null(_store.Locate("../" + id));
        Assert.Null(_store.Locate(id + ".uploading"));
        Assert.Null(_store.Locate(null));
    }

    [Fact]
    public async Task ImportingTheSameFileTwiceStoresItOnce()
    {
        var source = Path.Combine(Path.GetTempPath(), $"mnemo-import-{Guid.NewGuid():N}");
        File.WriteAllBytes(source, Png(1));
        try
        {
            var first = await _store.ImportAndCopyAsync(source);
            var second = await _store.ImportAndCopyAsync(source);

            Assert.True(first.IsSuccess);
            Assert.Equal(first.Value, second.Value);
            Assert.Single(Files());
        }
        finally
        {
            File.Delete(source);
        }
    }

    [Theory]
    [InlineData("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png", true)]
    [InlineData("0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef.png", false)]
    [InlineData("0123456789abcdef0123456789abcdef.png", false)]
    [InlineData("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.txt", false)]
    public void RecognizesTheNamesItMints(string name, bool expected) =>
        Assert.Equal(expected, SharedImageStore.IsContentName(name));
}
