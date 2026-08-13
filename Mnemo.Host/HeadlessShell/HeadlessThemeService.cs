using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// Inert theme service. The SPA owns theme rendering. Nothing on the server
/// resolves themes yet.
/// </summary>
public sealed class HeadlessThemeService : IThemeService
{
    public Task ApplyThemeAsync(string themeName) => Task.CompletedTask;
    public Task<IEnumerable<ThemeManifest>> GetAllThemesAsync() => Task.FromResult(Enumerable.Empty<ThemeManifest>());
    public Task<string> GetCurrentThemeAsync() => Task.FromResult(string.Empty);
    public void StartWatching() { }
    public void StopWatching() { }
    public Task<bool> ImportAsync(string path) => Task.FromResult(false);
    public Task ExportAsync(string themeName, string path) => Task.CompletedTask;
}
