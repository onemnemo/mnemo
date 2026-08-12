using Mnemo.Core.Enums;
using Mnemo.Core.Services;

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
            Write("Unhandled exception on a background thread.", e.ExceptionObject as Exception);

        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
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
            var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(root))
                root = AppContext.BaseDirectory;

            var directory = Path.Combine(root, "Mnemo", "logs");
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
