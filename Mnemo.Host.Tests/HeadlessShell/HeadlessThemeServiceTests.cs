using Mnemo.Core.Services;
using Mnemo.Host.HeadlessShell;

namespace Mnemo.Host.Tests.HeadlessShell;

/// <summary>
/// What survives a restart when someone picks a theme.
/// </summary>
/// <remarks>
/// These exist because the answer used to be "nothing". The catalog was still the
/// desktop app's four ported Avalonia themes while the SPA had collapsed to a light and
/// dark pair, so every write missed the catalog, fell back to the default and persisted
/// <c>Dawn</c>. Picking dark applied for the session and reverted on the next load, which
/// looks exactly like the app losing the setting.
/// </remarks>
public sealed class HeadlessThemeServiceTests
{
    private const string ThemeKey = "Appearance.Theme";

    [Fact]
    public async Task ApplyPersistsTheThemeItWasGiven()
    {
        var settings = new FakeSettings();
        var themes = new HeadlessThemeService(settings);

        await themes.ApplyThemeAsync("dark");

        Assert.Equal("Dark", settings.Read(ThemeKey));
    }

    [Fact]
    public async Task ApplyAcceptsTheLowercaseIdTheSpaSends()
    {
        var settings = new FakeSettings();
        var themes = new HeadlessThemeService(settings);

        await themes.ApplyThemeAsync("light");

        Assert.Equal("Light", settings.Read(ThemeKey));
        Assert.Equal("Light", await themes.GetCurrentThemeAsync());
    }

    [Fact]
    public async Task SystemIsStoredEvenThoughItIsNotAThemeInTheCatalog()
    {
        // It names a way of choosing one, and only the client can see the answer, so the
        // server has to carry it through untouched rather than resolve it.
        var settings = new FakeSettings();
        var themes = new HeadlessThemeService(settings);

        await themes.ApplyThemeAsync("system");

        Assert.Equal("System", settings.Read(ThemeKey));
        Assert.Equal("System", await themes.GetCurrentThemeAsync());
    }

    [Theory]
    [InlineData("Dawn", "Light")]
    [InlineData("Noon", "Light")]
    [InlineData("Dusk", "Dark")]
    [InlineData("Ember", "Dark")]
    [InlineData("New-Dark", "Dark")]
    public async Task ARetiredNameReadsBackAsWhicheverThemeReplacedIt(string stored, string expected)
    {
        var settings = new FakeSettings();
        await settings.SetAsync(ThemeKey, stored);
        var themes = new HeadlessThemeService(settings);

        Assert.Equal(expected, await themes.GetCurrentThemeAsync());
    }

    [Fact]
    public async Task AnUnknownNameFallsBackRatherThanBeingApplied()
    {
        var settings = new FakeSettings();
        var themes = new HeadlessThemeService(settings);

        await themes.ApplyThemeAsync("glass");

        Assert.Equal("Light", settings.Read(ThemeKey));
    }

    [Fact]
    public async Task NothingStoredReadsAsTheDefault()
    {
        var themes = new HeadlessThemeService(new FakeSettings());

        Assert.Equal("Light", await themes.GetCurrentThemeAsync());
    }

    [Fact]
    public async Task TheCatalogIsTheTwoThemesTheAppCanActuallyRender()
    {
        var themes = new HeadlessThemeService(new FakeSettings());

        var all = (await themes.GetAllThemesAsync()).ToList();

        Assert.Equal(["Light", "Dark"], all.Select(t => t.Name));
        Assert.All(all, t => Assert.NotEmpty(t.PreviewColors));
    }

    private sealed class FakeSettings : ISettingsService
    {
        private readonly Dictionary<string, object?> _values = new(StringComparer.Ordinal);

        public event EventHandler<string>? SettingChanged;

        public Task<T> GetAsync<T>(string key, T defaultValue = default!) =>
            Task.FromResult(_values.TryGetValue(key, out var value) && value is T typed ? typed : defaultValue);

        public Task SetAsync<T>(string key, T value)
        {
            _values[key] = value;
            SettingChanged?.Invoke(this, key);
            return Task.CompletedTask;
        }

        public string? Read(string key) => _values.TryGetValue(key, out var value) ? value as string : null;
    }
}
