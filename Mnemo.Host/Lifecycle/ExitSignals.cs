using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Mnemo.Core.Services;
using Mnemo.Host.Startup;
using Photino.NET;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Routes Unix termination signals through the window close handshake. Windows uses native window
/// messages; console termination cannot provide the same save guarantee.
/// </summary>
internal static class ExitSignals
{
    // Retain registrations through host shutdown so late signals cannot interrupt pending writes.
    private static IDisposable[]? _registrations;

    /// <summary>
    /// Routes SIGINT and SIGTERM into <paramref name="window"/>'s close. A no-op on Windows, and
    /// a no-op on a second call: this process opens one window.
    /// </summary>
    public static void Attach(PhotinoWindow window, ILoggerService logger)
    {
        if (OperatingSystem.IsWindows() || _registrations is not null)
            return;

        void Close() => window.Invoke(window.Close);

        _registrations =
        [
            PosixSignalRegistration.Create(PosixSignal.SIGINT, context => RequestClose(context, Close, logger)),
            PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => RequestClose(context, Close, logger)),
        ];
    }

    /// <summary>
    /// Cancels the default signal action and schedules the close callback on another thread.
    /// </summary>
    internal static void RequestClose(PosixSignalContext context, Action close, ILoggerService logger)
    {
        // Cancel before returning to the runtime, or it may terminate the process before saving.
        context.Cancel = true;

        // Do not block signal delivery while the close handler waits for the window message loop.
        _ = Task.Run(() =>
        {
            try
            {
                close();
            }
            catch (Exception ex)
            {
                // A late signal may arrive after the window closes. Keep the remaining host
                // shutdown running.
                logger.Error(CrashLog.Category, "A termination signal could not be delivered to the window.", ex);
            }
        });
    }
}
