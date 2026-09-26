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
        var outFolder = Path.Combine(profile.Parent, "out");
        var archive = Path.Combine(outFolder, "profile.mnemo-backup");
        Directory.CreateDirectory(outFolder);
        var leftoverScratch = MakeScratch(profile.Root, "backup-create", withLock: true);
        var leftoverBuild = BuildingPath(archive, NewId());
        var datedBuild = BuildingPath(Path.Combine(outFolder, "mnemo-2026-09-20.mnemo-backup"), NewId());
        var foreignShape = BuildingPath(Path.Combine(outFolder, "notes.txt"), NewId());
        var foreignId = BuildingPath(archive, "mine");
        foreach (var path in new[] { leftoverBuild, datedBuild, foreignShape, foreignId })
            await File.WriteAllTextAsync(path, "partial archive");
        var logger = new TestLogger();
        string[] liveScratch = [];
        string? liveBuild = null;

        var service = profile.Service(checkpoint: _ =>
        {
            liveBuild = Directory.GetFiles(outFolder, ".profile.mnemo-backup.*.building").Single(path => path != foreignId);
            // The finished archive is closed here, so only in-process tracking keeps it safe.
            using (new FileStream(liveBuild, FileMode.Open, FileAccess.Read, FileShare.None))
            {
            }
            ProfileBackupScratch.SweepAbandoned(profile.Root, logger);
            ProfileBackupScratch.SweepAbandonedBuilds(archive, logger);
            liveScratch = Directory.GetDirectories(profile.Root, ".backup-create-*");
        });
        await service.CreateAsync(archive, "0.8.0-beta");
        await service.LastSweep;

        Assert.NotEqual(leftoverScratch, Assert.Single(liveScratch));
        Assert.NotEqual(leftoverBuild, liveBuild);
        Assert.False(File.Exists(liveBuild));
        Assert.False(Directory.Exists(leftoverScratch));
        Assert.False(File.Exists(leftoverBuild));
        Assert.False(File.Exists(datedBuild));
        Assert.True(File.Exists(foreignShape));
        Assert.True(File.Exists(foreignId));
        Assert.Empty(Directory.EnumerateDirectories(profile.Root, ".backup-create-*"));
        await service.InspectAsync(archive, "0.8.0-beta");
        Assert.Empty(Directory.EnumerateDirectories(profile.Root, ".backup-inspect-*"));
        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task SweepAbandoned_SkipsAScratchThisProcessIsTracking()
    {
        using var profile = await TestProfile.CreateAsync();
        var scratch = MakeScratch(profile.Root, "backup-create", withLock: true, age: LongAgo);

        using (ProfileBackupScratch.Track(scratch, new TestLogger()))
            ProfileBackupScratch.SweepAbandoned(profile.Root, new TestLogger());
        Assert.True(Directory.Exists(scratch));

        ProfileBackupScratch.SweepAbandoned(profile.Root, new TestLogger());
        Assert.False(Directory.Exists(scratch));
    }

    [Fact]
    public async Task SweepAbandoned_KeepsALocklessScratchWithAFreshFileInside()
    {
        using var profile = await TestProfile.CreateAsync();
        var scratch = MakeScratch(profile.Root, "backup-create", withLock: false, age: LongAgo);
        var assets = Directory.CreateDirectory(Path.Combine(scratch, "assets", "images"));
        await File.WriteAllTextAsync(Path.Combine(assets.FullName, "card.png"), "still copying");
        Directory.SetLastWriteTimeUtc(assets.FullName, LongAgo);
        Directory.SetLastWriteTimeUtc(Path.Combine(scratch, "assets"), LongAgo);
        Directory.SetLastWriteTimeUtc(scratch, LongAgo);

        ProfileBackupScratch.SweepAbandoned(profile.Root, new TestLogger());

        Assert.True(Directory.Exists(scratch));
    }

    [Fact]
    public async Task SweepAbandoned_NeverFollowsOrRemovesALink()
    {
        using var profile = await TestProfile.CreateAsync();
        var elsewhere = Path.Combine(profile.Parent, "elsewhere");
        Directory.CreateDirectory(elsewhere);
        await File.WriteAllTextAsync(Path.Combine(elsewhere, "keep.txt"), "not scratch");
        await File.WriteAllTextAsync(Path.Combine(elsewhere, ProfileBackupScratch.LockFileName), string.Empty);
        var link = Path.Combine(profile.Root, $".backup-create-{NewId()}");
        CreateDirectoryLink(link, elsewhere);

        ProfileBackupScratch.SweepAbandoned(profile.Root, new TestLogger());

        Assert.True(Directory.Exists(link));
        Assert.Equal("not scratch", await File.ReadAllTextAsync(Path.Combine(elsewhere, "keep.txt")));
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

    private static string NewId() => Guid.NewGuid().ToString("N");

    // A junction needs no privilege on Windows, where a symbolic link can.
    private static void CreateDirectoryLink(string link, string target)
    {
        if (!OperatingSystem.IsWindows())
        {
            Directory.CreateSymbolicLink(link, target);
            return;
        }

        using var process = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
            "cmd.exe", $"/c mklink /J \"{link}\" \"{target}\"")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
        })!;
        process.WaitForExit();
        Assert.True((File.GetAttributes(link) & FileAttributes.ReparsePoint) != 0);
    }

    private static string BuildingPath(string output, string id) =>
        Path.Combine(Path.GetDirectoryName(output)!, $".{Path.GetFileName(output)}.{id}.building");
}
