using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Runtime.Versioning;
using System.Text;
using Mnemo.Core.Services;
using Mnemo.Host.Branding;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Branding;

/// <summary>
/// Real shell links in temporary folders standing in for the Start menu, the Desktop and the
/// pinned taskbar, so nothing here reaches the shortcuts of an installed copy. Windows only.
/// </summary>
public sealed class WindowsShortcutIconTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("mnemo-shortcuts").FullName;

    private string StartMenu => Path.Combine(_root, "Start Menu", "Programs");
    private string Desktop => Path.Combine(_root, "Desktop");
    private string Pinned => Path.Combine(_root, "User Pinned", "TaskBar");
    private string InstallRoot => Path.Combine(_root, "Mnemo.Desktop.V2");
    private string Exe => Path.Combine(InstallRoot, "current", "Mnemo.Host.exe");
    private string Stub => Path.Combine(InstallRoot, "Mnemo.exe");
    private string OtherExe => Path.Combine(_root, "Elsewhere", "Mnemo.Host.exe");
    private string Icon => Path.Combine(_root, "brand", "icon-forest.ico");

    public WindowsShortcutIconTests()
    {
        foreach (var file in new[] { Exe, Stub, OtherExe, Icon })
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            File.WriteAllBytes(file, [0]);
        }

        Directory.CreateDirectory(StartMenu);
        Directory.CreateDirectory(Desktop);
        Directory.CreateDirectory(Pinned);
    }

    [Fact]
    public async Task PointsTheInstallsLinksAtTheIconAndLeavesOthersAlone()
    {
        if (!OperatingSystem.IsWindows())
            return;

        await CreateInstallLinksAsync();
        var foreign = Path.Combine(Pinned, "Someone else.lnk");
        await CreateLinkAsync(foreign, OtherExe, OtherExe);

        var written = await Shortcuts().ApplyAsync(Icon);

        Assert.Equal(3, written);
        foreach (var link in InstallLinks())
            Assert.Equal((Icon, 0), await ReadIconAsync(link));
        Assert.Equal((OtherExe, 0), await ReadIconAsync(foreign));
    }

    [Fact]
    public async Task ASecondRunWithTheSameIconWritesNothing()
    {
        if (!OperatingSystem.IsWindows())
            return;

        await CreateInstallLinksAsync();
        var shortcuts = Shortcuts();
        await shortcuts.ApplyAsync(Icon);
        var stamps = InstallLinks().Select(File.GetLastWriteTimeUtc).ToArray();

        var written = await shortcuts.ApplyAsync(Icon);

        Assert.Equal(0, written);
        Assert.Equal(stamps, InstallLinks().Select(File.GetLastWriteTimeUtc).ToArray());
    }

    [Fact]
    public async Task TheDefaultPointsTheLinksBackAtTheExecutable()
    {
        if (!OperatingSystem.IsWindows())
            return;

        await CreateInstallLinksAsync();
        var shortcuts = Shortcuts();
        await shortcuts.ApplyAsync(Icon);

        var written = await shortcuts.ApplyAsync(null);

        Assert.Equal(3, written);
        foreach (var link in InstallLinks())
            Assert.Equal((Exe, 0), await ReadIconAsync(link));
    }

    [Fact]
    public async Task TheDefaultLeavesAnUntouchedInstallAlone()
    {
        if (!OperatingSystem.IsWindows())
            return;

        await CreateInstallLinksAsync();

        Assert.Equal(0, await Shortcuts().ApplyAsync(null));
    }

    [Fact]
    public async Task OnlyTheAppsOwnLinkNameCountsInTheStartMenuAndOnTheDesktop()
    {
        if (!OperatingSystem.IsWindows())
            return;

        var renamed = Path.Combine(Desktop, "My Mnemo.lnk");
        await CreateLinkAsync(renamed, Exe, Exe);

        Assert.Equal(0, await Shortcuts().ApplyAsync(Icon));
        Assert.Equal((Exe, 0), await ReadIconAsync(renamed));
    }

    [SupportedOSPlatform("windows")]
    private WindowsShortcutIcon Shortcuts() =>
        new(StartMenu, Desktop, Pinned, InstallRoot, Exe, new SilentLogger());

    private IEnumerable<string> InstallLinks() =>
    [
        Path.Combine(StartMenu, "Mnemo.lnk"),
        Path.Combine(Desktop, "Mnemo.lnk"),
        Path.Combine(Pinned, "Mnemo.lnk"),
    ];

    /// <summary>The links Velopack writes: its executable as both target and icon, the pinned one at the stub.</summary>
    [SupportedOSPlatform("windows")]
    private async Task CreateInstallLinksAsync()
    {
        await CreateLinkAsync(Path.Combine(StartMenu, "Mnemo.lnk"), Exe, Exe);
        await CreateLinkAsync(Path.Combine(Desktop, "Mnemo.lnk"), Exe, Exe);
        await CreateLinkAsync(Path.Combine(Pinned, "Mnemo.lnk"), Stub, Exe);
    }

    [SupportedOSPlatform("windows")]
    private static Task<bool> CreateLinkAsync(string path, string target, string icon) =>
        WindowsShortcutIcon.RunOnStaThread(() =>
        {
            var link = (WindowsShortcutIcon.IShellLinkW)new WindowsShortcutIcon.ShellLink();
            try
            {
                link.SetPath(target);
                link.SetIconLocation(icon, 0);
                ((IPersistFile)link).Save(path, true);
                return true;
            }
            finally
            {
                Marshal.FinalReleaseComObject(link);
            }
        });

    [SupportedOSPlatform("windows")]
    private static Task<(string Path, int Index)> ReadIconAsync(string path) =>
        WindowsShortcutIcon.RunOnStaThread(() =>
        {
            var link = (WindowsShortcutIcon.IShellLinkW)new WindowsShortcutIcon.ShellLink();
            try
            {
                ((IPersistFile)link).Load(path, 0);
                var icon = new StringBuilder(260);
                link.GetIconLocation(icon, icon.Capacity, out var index);
                return (icon.ToString(), index);
            }
            finally
            {
                Marshal.FinalReleaseComObject(link);
            }
        });

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
