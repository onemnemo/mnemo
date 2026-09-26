using Mnemo.Infrastructure.Services.ProfileBackup;
using TestProfile = Mnemo.Infrastructure.Tests.ProfileBackup.ProfileBackupServiceTests.TestProfile;

namespace Mnemo.Infrastructure.Tests.ProfileBackup;

public sealed class ProfileBackupCompletionMarkTests
{
    [Fact]
    public async Task Restore_KeepsFinishedOnboardingButNotTheBetaNoticeAcknowledgement()
    {
        using var source = await TestProfile.CreateAsync("source");
        await source.SetStorageAsync("Onboarding.Completed", "true");
        var archive = Path.Combine(source.Parent, "source.mnemo-backup");
        var created = await source.Service().CreateAsync(archive, "0.8.0-beta");

        using var target = await TestProfile.CreateAsync("target");
        await target.Service().StageRestoreAsync(archive, "0.8.0-beta");
        var status = await ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta");

        Assert.True(status?.Success);
        Assert.Equal(10, created.Contents.PortableSettings);
        Assert.Equal("true", await target.StoredValueAsync("Onboarding.Completed"));
        Assert.Null(await target.StoredValueAsync("App.BetaNoticeSeenVersion"));
    }

    [Fact]
    public async Task Restore_OfABackupWithoutTheOnboardingMarkStillSkipsOnboarding()
    {
        // Backups leave the mark out, so the restore has to put it back.
        using var source = await TestProfile.CreateAsync("source");
        await source.SetStorageAsync("User.DisplayName", "\"Source\"");
        var archive = Path.Combine(source.Parent, "source.mnemo-backup");
        var created = await source.Service().CreateAsync(archive, "0.8.0-beta");

        using var target = await TestProfile.CreateAsync("target");
        await target.Service().InspectAsync(archive, "0.8.0-beta");
        await target.Service().StageRestoreAsync(archive, "0.8.0-beta");
        var status = await ProfileRestoreStartup.ApplyPendingAsync(target.Root, "0.8.0-beta");

        Assert.True(status?.Success);
        Assert.Equal(10, created.Contents.PortableSettings);
        Assert.Equal("\"Source\"", await target.StoredValueAsync("User.DisplayName"));
        Assert.Equal("true", await target.StoredValueAsync("Onboarding.Completed"));
    }
}
