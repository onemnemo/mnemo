using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

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
    private const string Title = "Mnemo could not start";

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
        // A service or a CI run has no desktop to put a modal on and must not be
        // blocked by one. This is only ever false on Windows: .NET reports every
        // unix process as interactive, so the platform paths below do their own
        // check for whether anything is there to draw on.
        if (!Environment.UserInteractive)
            return;

        var message = Compose(error);

        try
        {
            if (OperatingSystem.IsWindows())
            {
                ShowOnWindows(message);
                return;
            }

            // A packaged mac or linux build has no console either, but it can be
            // started from one, and that is how the first run on a new platform
            // usually happens. Writing first means the text survives even when
            // every dialog helper below turns out to be missing.
            Console.Error.WriteLine($"{Title}{Environment.NewLine}{message}");

            if (OperatingSystem.IsMacOS())
                ShowOnMacOS(message);
            else if (OperatingSystem.IsLinux())
                ShowOnLinux(message);
        }
        catch
        {
            // Nothing left to report to.
        }
    }

    [SupportedOSPlatform("windows")]
    private static void ShowOnWindows(string message) =>
        MessageBoxW(
            IntPtr.Zero,
            message,
            Title,
            MessageBoxOk | MessageBoxIconError | MessageBoxSetForeground | MessageBoxTopMost);

    /// <remarks>
    /// osascript is part of the base system, so this needs nothing installed. The
    /// message is passed as an argument and read out of <c>argv</c> rather than
    /// pasted into the script text, so a fault message containing a quote cannot
    /// change what AppleScript ends up running.
    /// </remarks>
    private static void ShowOnMacOS(string message) =>
        Run("/usr/bin/osascript",
            "-e", "on run argv",
            "-e", $"display dialog (item 1 of argv) with title \"{Title}\" buttons {{\"OK\"}} default button \"OK\" with icon stop",
            "-e", "end run",
            message);

    /// <remarks>
    /// Nothing is guaranteed to be installed on a linux desktop, so this walks the
    /// usual set and stops at the first one that runs: zenity ships with GNOME,
    /// kdialog with KDE, and xmessage with X itself.
    /// </remarks>
    private static void ShowOnLinux(string message)
    {
        // No session means nobody to show a dialog to, and a helper left waiting on a
        // display that is not there would hold a dying process open indefinitely.
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DISPLAY"))
            && string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WAYLAND_DISPLAY")))
            return;

        if (Run("zenity", "--error", "--title", Title, "--text", message))
            return;

        if (Run("kdialog", "--title", Title, "--error", message))
            return;

        Run("xmessage", "-center", message);
    }

    /// <summary>
    /// Runs a dialog helper to completion, reporting whether it was there to run.
    /// </summary>
    /// <remarks>
    /// Output is deliberately left attached to this process rather than redirected:
    /// draining a pipe correctly costs more than it is worth here, and an undrained
    /// one deadlocks the wait as soon as a helper writes enough warnings to fill it.
    /// </remarks>
    private static bool Run(string fileName, params string[] arguments)
    {
        try
        {
            var startInfo = new ProcessStartInfo(fileName) { UseShellExecute = false };
            foreach (var argument in arguments)
                startInfo.ArgumentList.Add(argument);

            using var process = Process.Start(startInfo);
            if (process is null)
                return false;

            process.WaitForExit();
            return process.ExitCode == 0;
        }
        catch
        {
            // A helper that is not installed throws rather than reporting a code.
            return false;
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
