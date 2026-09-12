using Mnemo.Host.Settings;
using Mnemo.Host.Transfer;
using Mnemo.Infrastructure.Services.ProfileBackup;
using Mnemo.Infrastructure.Services.Updates;

namespace Mnemo.Host.Tests.Backup;

public sealed class ProfileBackupSettingsCatalogTests
{
    [Fact]
    public void EveryExposedSettingHasAnExplicitBackupClassification()
    {
        var classified = ProfileBackupSettingsCatalog.All;

        foreach (var setting in SettingsKeyRegistry.All)
        {
            Assert.True(classified.ContainsKey(setting.Key), $"Setting '{setting.Key}' is not classified for backups.");
            Assert.Equal(
                setting.WriteOnly,
                classified[setting.Key] == ProfileSettingClassification.Secret);
        }
    }

    [Fact]
    public void EveryPersistedUpdateValueHasAnExplicitBackupClassification()
    {
        var updateKeys = typeof(UpdateSettingsKeys)
            .GetFields()
            .Select(field => field.GetRawConstantValue())
            .OfType<string>();

        foreach (var key in updateKeys)
            Assert.True(ProfileBackupSettingsCatalog.All.ContainsKey(key), $"Update value '{key}' is not classified for backups.");
    }

    [Theory]
    [InlineData("profile.mnemo-backup", true)]
    [InlineData("PROFILE.MNEMO-BACKUP", true)]
    [InlineData("deck.mnemo", false)]
    [InlineData("notes.md", false)]
    public void ModuleImportsRecognizeWholeProfileBackups(string fileName, bool expected)
    {
        Assert.Equal(expected, TransferStagingStore.IsProfileBackup(fileName));
    }
}
