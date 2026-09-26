using Mnemo.Infrastructure.Services.ProfileBackup;
using TestProfile = Mnemo.Infrastructure.Tests.ProfileBackup.ProfileBackupServiceTests.TestProfile;

namespace Mnemo.Infrastructure.Tests.ProfileBackup;

public sealed class ProfileRestoreRecoveryTests
{
    [Fact]
    public async Task A_second_restore_keeps_the_copy_the_first_one_made()
    {
        using var source = await TestProfile.CreateAsync("source");
        var archive = Path.Combine(source.Parent, "source.mnemo-backup");
        await source.Service().CreateAsync(archive, "0.8.0-beta");
        using var target = await TestProfile.CreateAsync("target");
        await target.WriteAssetAsync("images", "only-here.png", "original");

        var first = await RestoreAsync(target, archive);
        var second = await RestoreAsync(target, archive);

        Assert.NotEqual(first, second);
        Assert.Equal(
            "original",
            await File.ReadAllTextAsync(Path.Combine(RecoveryRoot(target), first, "images", "only-here.png")));
        Assert.True(Directory.Exists(Path.Combine(RecoveryRoot(target), second)));
    }

    [Fact]
    public async Task A_fourth_restore_removes_only_the_oldest_copy()
    {
        using var source = await TestProfile.CreateAsync("source");
        var archive = Path.Combine(source.Parent, "source.mnemo-backup");
        await source.Service().CreateAsync(archive, "0.8.0-beta");
        using var target = await TestProfile.CreateAsync("target");
        var now = DateTimeOffset.UtcNow;
        var earlier = new[] { 3, 2, 1 }.Select(hours => MakeRecovery(target, now.AddHours(-hours))).ToArray();
        var foreign = Path.Combine(RecoveryRoot(target), "copied-by-hand");
        Directory.CreateDirectory(foreign);

        var latest = await RestoreAsync(target, archive);

        Assert.False(Directory.Exists(Path.Combine(RecoveryRoot(target), earlier[0])));
        Assert.True(Directory.Exists(Path.Combine(RecoveryRoot(target), earlier[1])));
        Assert.True(Directory.Exists(Path.Combine(RecoveryRoot(target), earlier[2])));
        Assert.True(Directory.Exists(Path.Combine(RecoveryRoot(target), latest)));
        Assert.True(Directory.Exists(foreign));
    }

    [Fact]
    public async Task Age_removes_old_copies_but_never_the_newest()
    {
        using var target = await TestProfile.CreateAsync("target");
        var now = DateTimeOffset.UtcNow;
        var ancient = MakeRecovery(target, now.AddDays(-90));
        var newest = MakeRecovery(target, now.AddDays(-60));

        ProfileRestoreStartup.PruneRecoveriesAt(target.Root, newest, now);

        Assert.True(Directory.Exists(Path.Combine(RecoveryRoot(target), newest)));
        Assert.False(Directory.Exists(Path.Combine(RecoveryRoot(target), ancient)));
    }

    [Fact]
    public async Task A_copy_inside_the_lifetime_survives_beside_the_newest()
    {
        using var target = await TestProfile.CreateAsync("target");
        var now = DateTimeOffset.UtcNow;
        var recent = MakeRecovery(target, now.AddDays(-29));
        var expired = MakeRecovery(target, now.AddDays(-31));
        var newest = MakeRecovery(target, now);

        ProfileRestoreStartup.PruneRecoveriesAt(target.Root, newest, now);

        Assert.True(Directory.Exists(Path.Combine(RecoveryRoot(target), recent)));
        Assert.False(Directory.Exists(Path.Combine(RecoveryRoot(target), expired)));
    }

    private static async Task<string> RestoreAsync(TestProfile target, string archive)
    {
        await target.Service().StageRestoreAsync(archive, "0.8.0-beta");
        var status = await ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta");
        Assert.True(status?.Success);
        return status!.RecoveryDirectoryName!;
    }

    private static string MakeRecovery(TestProfile target, DateTimeOffset stamp)
    {
        var name = $"{stamp.UtcDateTime:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}";
        Directory.CreateDirectory(Path.Combine(RecoveryRoot(target), name));
        return name;
    }

    private static string RecoveryRoot(TestProfile target) =>
        Path.Combine(target.Root, ProfileRestoreStartup.RecoveryDirectoryName);
}
