using Mnemo.Infrastructure.Services.ProfileBackup;
using TestProfile = Mnemo.Infrastructure.Tests.ProfileBackup.ProfileBackupServiceTests.TestProfile;

namespace Mnemo.Infrastructure.Tests.ProfileBackup;

public sealed class ProfileBackupScratchTests
{
    private static readonly DateTime LongAgo = DateTime.UtcNow.AddHours(-2);

    [Fact]
    public async Task SweepAbandoned_RemovesOnlyScratchNoRunningBackupHolds()
    {
        using var profile = await TestProfile.CreateAsync();
        await profile.WriteAssetAsync("note-assets", "note.png", "kept");
        var unlocked = MakeScratch(profile.Root, "backup-create", withLock: true);
        var legacy = MakeScratch(profile.Root, "backup-inspect", withLock: false, age: LongAgo);
        var fresh = MakeScratch(profile.Root, "backup-create", withLock: false);
        var held = MakeScratch(profile.Root, "backup-create", withLock: true);
        var notAnId = MakeScratch(profile.Root, "backup-create", withLock: false, age: LongAgo, id: "leftover");
        var noDot = Path.Combine(profile.Root, $"backup-create-{Guid.NewGuid():N}");
        Directory.CreateDirectory(noDot);
        var file = Path.Combine(profile.Root, $".backup-create-{Guid.NewGuid():N}");
        await File.WriteAllTextAsync(file, "not a directory");
        var logger = new TestLogger();

        using (new FileStream(Path.Combine(held, ProfileBackupScratch.LockFileName), FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            ProfileBackupScratch.SweepAbandoned(profile.Root, logger);

        Assert.False(Directory.Exists(unlocked));
        Assert.False(Directory.Exists(legacy));
        Assert.True(Directory.Exists(fresh));
        Assert.True(Directory.Exists(held));
        Assert.True(Directory.Exists(notAnId));
        Assert.True(Directory.Exists(noDot));
        Assert.True(File.Exists(file));
        Assert.True(File.Exists(profile.DatabasePath));
        Assert.Equal("kept", await File.ReadAllTextAsync(Path.Combine(profile.Root, "note-assets", "note.png")));
        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task CreateAsync_SweepsWhatAKilledBackupLeftButNeverItsOwnWork()
    {
        using var profile = await TestProfile.CreateAsync();
        var archive = Path.Combine(profile.Parent, "out", "profile.mnemo-backup");
        Directory.CreateDirectory(Path.GetDirectoryName(archive)!);
        var leftoverScratch = MakeScratch(profile.Root, "backup-create", withLock: true);
        var leftoverBuild = BuildingPath(archive, Guid.NewGuid().ToString("N"));
        var otherBuild = BuildingPath(Path.Combine(profile.Parent, "out", "other.mnemo-backup"), Guid.NewGuid().ToString("N"));
        var foreignBuild = BuildingPath(archive, "mine");
        foreach (var path in new[] { leftoverBuild, otherBuild, foreignBuild })
            await File.WriteAllTextAsync(path, "partial archive");
        var logger = new TestLogger();
        string[] liveScratch = [];
        string[] liveBuilds = [];

        var service = profile.Service(checkpoint: _ =>
        {
            // A sweep from startup or a second backup while this one is mid-write.
            ProfileBackupScratch.SweepAbandoned(profile.Root, logger);
            ProfileBackupScratch.SweepAbandonedBuilds(archive, logger);
            liveScratch = Directory.GetDirectories(profile.Root, ".backup-create-*");
            liveBuilds = Directory.GetFiles(Path.GetDirectoryName(archive)!, ".profile.mnemo-backup.*.building");
        });
        await service.CreateAsync(archive, "0.8.0-beta");

        Assert.NotEqual(leftoverScratch, Assert.Single(liveScratch));
        Assert.NotEqual(leftoverBuild, Assert.Single(liveBuilds, path => path != foreignBuild));
        Assert.False(Directory.Exists(leftoverScratch));
        Assert.False(File.Exists(leftoverBuild));
        Assert.True(File.Exists(otherBuild));
        Assert.True(File.Exists(foreignBuild));
        Assert.Empty(Directory.EnumerateDirectories(profile.Root, ".backup-create-*"));
        await service.InspectAsync(archive, "0.8.0-beta");
        Assert.Empty(Directory.EnumerateDirectories(profile.Root, ".backup-inspect-*"));
        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task SweepAbandonedBuilds_SkipsAnUnfinishedArchiveStillOpenForWriting()
    {
        using var profile = await TestProfile.CreateAsync();
        var archive = Path.Combine(profile.Parent, "profile.mnemo-backup");
        var writing = BuildingPath(archive, Guid.NewGuid().ToString("N"));

        using (new FileStream(writing, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            ProfileBackupScratch.SweepAbandonedBuilds(archive, new TestLogger());

        Assert.True(File.Exists(writing));
    }

    private static string MakeScratch(string root, string purpose, bool withLock, DateTime? age = null, string? id = null)
    {
        var path = Path.Combine(root, $".{purpose}-{id ?? Guid.NewGuid().ToString("N")}");
        Directory.CreateDirectory(path);
        var snapshot = Path.Combine(path, ProfileBackupArchive.DatabasePath);
        File.WriteAllText(snapshot, "cleartext copy");
        if (withLock)
            File.WriteAllText(Path.Combine(path, ProfileBackupScratch.LockFileName), string.Empty);
        if (age is { } stamp)
        {
            File.SetLastWriteTimeUtc(snapshot, stamp);
            Directory.SetLastWriteTimeUtc(path, stamp);
        }
        return path;
    }

    private static string BuildingPath(string output, string id) =>
        Path.Combine(Path.GetDirectoryName(output)!, $".{Path.GetFileName(output)}.{id}.building");
}
