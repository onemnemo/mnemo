using Mnemo.Core.Models;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Models.Tools.Settings;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Tools;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Services;

public sealed class SettingsToolServiceTests
{
    [Fact]
    public async Task Profile_colour_accepts_a_supported_value_case_insensitively()
    {
        var settings = new SettingsService(new InMemoryStorageProvider());
        var service = new SettingsToolService(settings, new UnusedThemeService());

        var result = await service.SetSettingAsync(new SetSettingParameters
        {
            Key = "User.ProfileColour",
            Value = "IRIS"
        });

        Assert.True(result.Ok);
        Assert.Equal("iris", await settings.GetAsync("User.ProfileColour", "missing"));
    }

    [Fact]
    public async Task Profile_colour_rejects_a_value_outside_the_advertised_catalog()
    {
        var settings = new SettingsService(new InMemoryStorageProvider());
        var service = new SettingsToolService(settings, new UnusedThemeService());

        var result = await service.SetSettingAsync(new SetSettingParameters
        {
            Key = "User.ProfileColour",
            Value = "ultraviolet"
        });

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.ValidationError, result.Code);
        Assert.False(await settings.ExistsAsync("User.ProfileColour"));
    }

    private sealed class UnusedThemeService : IThemeService
    {
        public Task ApplyThemeAsync(string themeName) => throw new NotSupportedException();

        public Task<IEnumerable<ThemeManifest>> GetAllThemesAsync() => throw new NotSupportedException();

        public Task<string> GetCurrentThemeAsync() => throw new NotSupportedException();
    }
}
