using System;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;

namespace Mnemo.UI.Modules.Updates.Services;

public static class UpdateReleaseLauncher
{
    public const string LatestReleaseUrl = "https://github.com/onemnemo/mnemo/releases/latest";

    /// <summary>Download page for the rebuilt app, which this release line cannot update to on its own.</summary>
    public const string DownloadPageUrl = "https://www.mnemo.one/download";

    public static Task LaunchLatestAsync() => LaunchAsync(new Uri(LatestReleaseUrl));

    public static Task LaunchDownloadPageAsync() => LaunchAsync(new Uri(DownloadPageUrl));

    private static async Task LaunchAsync(Uri uri)
    {
        var life = Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime;
        var top = life?.MainWindow;
        if (top == null)
            return;

        await top.Launcher.LaunchUriAsync(uri).ConfigureAwait(true);
    }
}
