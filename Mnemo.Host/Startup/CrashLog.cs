using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Startup;

/// <summary>
/// The last place a fault can be written down.
/// </summary>
/// <remarks>
/// The packaged app is a WinExe, so nothing it prints reaches a console, and the
/// faults worth catching (composition, SPA resolution, backend init, window
/// creation) all happen before or around the point where the logger itself
/// exists. Without a sink of its own, a startup crash is a process that vanishes
/// and a tester with nothing to send back, so this writes to the same daily file
/// <see cref="ILoggerService"/> uses whether or not that service was ever built.
/// </remarks>
public static class CrashLog
{
    public const string Category = "Mnemo.Host";

    private static readonly object FileGate = new();
    private static ILoggerService? _logger;

    /// <summary>
    /// Routes later writes through the real logger. Called as soon as the service
    /// provider exists; before that every write takes the file fallback.
    /// </summary>
    public static void UseLogger(ILoggerService logger) => _logger = logger;

    /// <summary>
    /// Catches the faults no <c>try</c> in this process can see: a throw on a pool
    /// thread, and a task nobody awaited.
    /// </summary>
    public static void InstallProcessHandlers()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            var error = e.ExceptionObject as Exception;
            Write("Unhandled exception on a background thread.", error);

            // Only when the process is going down with it. The window is about to
            // disappear out from under whatever the person was doing, and without
            // this that is the entire report they can give: it vanished. The
            // dialog blocks, which is the point, since the alternative is that the
            // runtime tears the process down before anything is read.
            if (e.IsTerminating && error is not null)
                FatalDialog.ShowCrash(error);
        };

        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            // Deliberately no dialog. This fires from a finalizer for any task whose
            // fault nobody awaited, which includes fire-and-forget work that failed
            // harmlessly, and the app carries on running afterwards either way. A
            // modal here would interrupt a working app to report something it has
            // already recovered from, and could do it repeatedly.
            Write("Faulted task was never observed.", e.Exception);
            e.SetObserved();
        };
    }

    public static void Write(string message, Exception? error)
    {
        var logger = _logger;
        if (logger is not null)
        {
            try
            {
                logger.Critical(Category, message, error);
                return;
            }
            catch
            {
                // The logger is one of the things that can be broken here.
            }
        }

        WriteToFile(Format(message, error));
    }

    private static string Format(string message, Exception? error)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [{LogLevel.Critical}] [{Category}] {message}";
        return error is null ? line : $"{line}{Environment.NewLine}Exception: {error}";
    }

    /// <summary>
    /// Resolves the log file the same way <see cref="ILoggerService"/>'s file sink
    /// does, so a crash lands in the file a tester is already being asked for
    /// rather than in a second one nobody knows about.
    /// </summary>
    private static void WriteToFile(string line)
    {
        try
        {
            var directory = MnemoAppPaths.GetLogsDirectory();
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, $"log_{DateTime.Now:yyyyMMdd}.txt");

            lock (FileGate)
            {
                File.AppendAllText(path, line + Environment.NewLine);
            }
        }
        catch
        {
            // Nothing left to report to. Swallowing beats replacing the original
            // fault with an IO error from the code trying to record it.
        }
    }
}
