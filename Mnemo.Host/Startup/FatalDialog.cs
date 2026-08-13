using System.Runtime.InteropServices;

using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Startup;

/// <summary>
/// The last-ditch way to tell a person that the app is not going to start.
/// </summary>
/// <remarks>
/// The packaged app is a WinExe, so a fault on the way up otherwise looks like
/// double-clicking the shortcut and having nothing happen at all. That turns
/// every report into "it doesn't work", and leaves the log file that does have
/// the fault in it sitting in a folder the person was never told about. This
/// says what broke and where to look, which is the difference between a
/// diagnosable alpha and a silent one.
/// </remarks>
internal static class FatalDialog
{
    private const uint MessageBoxOk = 0x00000000;
    private const uint MessageBoxIconError = 0x00000010;
    private const uint MessageBoxSetForeground = 0x00010000;
    private const uint MessageBoxTopMost = 0x00040000;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    /// <summary>
    /// Shows the fault, if there is anyone there to see it. Never throws: this
    /// runs while the process is already failing, and a second fault raised by
    /// the code reporting the first would replace it.
    /// </summary>
    public static void Show(Exception error)
    {
        // user32 is a Windows API, and Windows is where the console-less packaged
        // shape this exists for actually happens. A service or a CI run has no
        // desktop to put a modal on and must not be blocked by one.
        if (!OperatingSystem.IsWindows() || !Environment.UserInteractive)
            return;

        try
        {
            MessageBoxW(
                IntPtr.Zero,
                Compose(error),
                "Mnemo could not start",
                MessageBoxOk | MessageBoxIconError | MessageBoxSetForeground | MessageBoxTopMost);
        }
        catch
        {
            // Nothing left to report to.
        }
    }

    private static string Compose(Exception error)
    {
        var detail = $"{error.GetType().Name}: {error.Message}";
        var logs = SafeLogsDirectory();

        return logs is null
            ? $"Mnemo could not start.{Environment.NewLine}{Environment.NewLine}{detail}"
            : $"Mnemo could not start.{Environment.NewLine}{Environment.NewLine}{detail}"
              + $"{Environment.NewLine}{Environment.NewLine}The full details were written to:{Environment.NewLine}{logs}";
    }

    private static string? SafeLogsDirectory()
    {
        try
        {
            return MnemoAppPaths.GetLogsDirectory();
        }
        catch
        {
            // Resolving the data root is itself a plausible cause of the fault
            // being reported, so the message has to work without it.
            return null;
        }
    }
}
