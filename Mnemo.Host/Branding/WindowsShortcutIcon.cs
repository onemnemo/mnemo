using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Runtime.Versioning;
using System.Text;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Velopack.Locators;

namespace Mnemo.Host.Branding;

/// <summary>
/// Points the Start menu, Desktop and pinned taskbar shortcuts of a Velopack install at the
/// chosen icon file. The signed executable is never touched; only the links' icon location.
/// </summary>
/// <remarks>
/// Velopack rewrites its shortcuts on every update, so this runs at each launch as well as
/// after a change. A link whose target lies outside the install root belongs to someone else
/// and is left alone. Links are never resolved, so a stale one is not searched for or fixed.
/// </remarks>
[SupportedOSPlatform("windows")]
internal sealed class WindowsShortcutIcon : IShortcutIconSync
{
    private const string LogCategory = "BrandIcon";
    private const string LinkName = "Mnemo.lnk";
    private const int StgmRead = 0x0;
    private const int StgmReadWrite = 0x2;
    private const int MaxPath = 260;
    private const int ShcneUpdateItem = 0x2000;
    private const uint ShcnfPathW = 0x0005;

    private readonly string _startMenuPrograms;
    private readonly string _desktop;
    private readonly string _pinnedTaskbar;
    private readonly string _installRoot;
    private readonly string _targetExe;
    private readonly ILoggerService _logger;

    public WindowsShortcutIcon(
        string startMenuPrograms,
        string desktop,
        string pinnedTaskbar,
        string installRoot,
        string targetExe,
        ILoggerService logger)
    {
        _startMenuPrograms = startMenuPrograms;
        _desktop = desktop;
        _pinnedTaskbar = pinnedTaskbar;
        _installRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installRoot)) + Path.DirectorySeparatorChar;
        _targetExe = Path.GetFullPath(targetExe);
        _logger = logger;
    }

    /// <summary>
    /// The shortcuts of the running Velopack install, or null when there is nothing to own: a
    /// development or portable run, or a redirected data root, which is a test or a side by side
    /// profile and must not repaint the real install's shortcuts.
    /// </summary>
    public static WindowsShortcutIcon? ForInstalledApp(ILoggerService logger)
    {
        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable)))
            return null;
        if (!VelopackLocator.IsCurrentSet)
            return null;

        var locator = VelopackLocator.Current;
        var executable = Environment.ProcessPath;
        if (locator.CurrentlyInstalledVersion is null
            || locator.IsPortable
            || string.IsNullOrWhiteSpace(locator.RootAppDir)
            || string.IsNullOrWhiteSpace(executable))
        {
            return null;
        }

        return new WindowsShortcutIcon(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
            locator.RootAppDir,
            executable,
            logger);
    }

    public Task<int> ApplyAsync(string? iconFile) => RunOnStaThread(() => Apply(iconFile));

    /// <summary>The body of <see cref="ApplyAsync"/>. Must run on an STA thread.</summary>
    internal int Apply(string? iconFile)
    {
        var wantedPath = iconFile is null ? _targetExe : Path.GetFullPath(iconFile);
        var written = 0;

        foreach (var link in CandidateLinks())
        {
            try
            {
                if (TryRepoint(link, wantedPath, isDefault: iconFile is null))
                {
                    SHChangeNotify(ShcneUpdateItem, ShcnfPathW, link, IntPtr.Zero);
                    written++;
                }
            }
            catch (Exception ex) when (ex is COMException or IOException or UnauthorizedAccessException)
            {
                _logger.Warning(LogCategory, $"Could not update the icon of shortcut {link}: {ex.Message}");
            }
        }

        return written;
    }

    private IEnumerable<string> CandidateLinks()
    {
        foreach (var folder in new[] { _startMenuPrograms, _desktop })
        {
            var link = Path.Combine(folder, LinkName);
            if (File.Exists(link))
                yield return link;
        }

        if (!Directory.Exists(_pinnedTaskbar))
            yield break;

        foreach (var link in Directory.EnumerateFiles(_pinnedTaskbar, "*.lnk"))
            yield return link;
    }

    private bool TryRepoint(string link, string wantedPath, bool isDefault)
    {
        string target;
        string currentPath;
        int currentIndex;

        var reader = (IShellLinkW)new ShellLink();
        try
        {
            ((IPersistFile)reader).Load(link, StgmRead);
            target = ReadTarget(reader);
            var icon = new StringBuilder(MaxPath);
            reader.GetIconLocation(icon, icon.Capacity, out currentIndex);
            currentPath = Environment.ExpandEnvironmentVariables(icon.ToString());
        }
        finally
        {
            Marshal.FinalReleaseComObject(reader);
        }

        if (!IsUnderInstallRoot(target))
            return false;

        // An empty location already shows the target's own icon, which is what the default wants.
        var unchanged = currentIndex == 0 && (SamePath(currentPath, wantedPath) || isDefault && currentPath.Length == 0);
        if (unchanged)
            return false;

        var writer = (IShellLinkW)new ShellLink();
        try
        {
            var file = (IPersistFile)writer;
            file.Load(link, StgmReadWrite);
            writer.SetIconLocation(wantedPath, 0);
            file.Save(null, true);
        }
        finally
        {
            Marshal.FinalReleaseComObject(writer);
        }

        return true;
    }

    internal static string ReadTarget(IShellLinkW link)
    {
        var target = new StringBuilder(MaxPath);
        link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
        return Environment.ExpandEnvironmentVariables(target.ToString());
    }

    private bool IsUnderInstallRoot(string target)
    {
        if (string.IsNullOrWhiteSpace(target))
            return false;

        try
        {
            return Path.GetFullPath(target).StartsWith(_installRoot, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }
    }

    private static bool SamePath(string a, string b)
    {
        if (a.Length == 0)
            return false;

        try
        {
            return string.Equals(Path.GetFullPath(a), b, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }
    }

    /// <summary>Runs <paramref name="work"/> on a fresh STA thread, which the shell link object requires.</summary>
    internal static Task<T> RunOnStaThread<T>(Func<T> work)
    {
        var done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                done.SetResult(work());
            }
            catch (Exception ex)
            {
                done.SetException(ex);
            }
        })
        {
            IsBackground = true,
            Name = "Mnemo shortcut icons",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return done.Task;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(int eventId, uint flags, string item1, IntPtr item2);

    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    internal class ShellLink
    {
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    internal interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int capacity, IntPtr findData, uint flags);
        void GetIDList(out IntPtr idList);
        void SetIDList(IntPtr idList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int capacity);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int capacity);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int capacity);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int showCmd);
        void SetShowCmd(int showCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int capacity, out int iconIndex);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string relativePath, uint reserved);
        void Resolve(IntPtr hwnd, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
    }
}
