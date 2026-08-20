namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Detects the pre-rewrite, Avalonia-only Mnemo install sharing this profile's data root.
/// </summary>
/// <remarks>
/// Both apps read the same data root through
/// <see cref="Mnemo.Infrastructure.Common.MnemoAppPaths.GetLocalUserDataRoot"/>, and
/// <see cref="HostInstanceLock"/> only recognises another live instance of this app, not the
/// old one, so nothing stops the two running against one collection together.
///
/// The old app's Velopack install used the pack id "Mnemo.Desktop" (this app ships as
/// "Mnemo.Desktop.V2", deliberately different so the old install's own updater never offers
/// this build; see .github/workflows/release.yml). Velopack creates
/// %LocalAppData%\Mnemo.Desktop\current\ on install and removes the whole pack id folder on
/// uninstall, so the folder's presence is a live signal rather than a memory of one.
///
/// Windows only. On Windows the pack id names a distinct per-app install folder, which is
/// exactly the signal needed. macOS Velopack installs a bundle keyed by app title rather than
/// pack id, both versions carry the same title, and Linux ships an AppImage with no install
/// directory Velopack manages at all, so neither platform has an equivalent way to name only
/// the old app's install without guessing. Detection answers false there rather than guess.
/// </remarks>
public static class LegacyInstallDetector
{
    private const string LegacyPackId = "Mnemo.Desktop";
    private const string LegacyExecutableName = "Mnemo.UI.exe";

    /// <summary>Where the legacy install's executable would sit under a given LocalApplicationData root.</summary>
    internal static string LegacyExecutablePath(string localAppData) =>
        Path.Combine(localAppData, LegacyPackId, "current", LegacyExecutableName);

    /// <param name="localAppDataOverride">Override for tests; defaults to the real LocalApplicationData folder.</param>
    public static bool IsPresent(string? localAppDataOverride = null)
    {
        if (!OperatingSystem.IsWindows())
            return false;

        var localAppData = localAppDataOverride ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData))
            return false;

        return File.Exists(LegacyExecutablePath(localAppData));
    }
}
