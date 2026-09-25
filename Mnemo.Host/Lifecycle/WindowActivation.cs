using Mnemo.Core.Services;
using Mnemo.Host.Chrome;
using Mnemo.Host.Startup;
using Photino.NET;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Brings this instance's window forward when another launch on the same profile asks for it.
/// </summary>
/// <remarks>
/// Windows can still refuse the foreground (focus assist, a full screen app) and flash the
/// taskbar button instead; no app is allowed more than that.
/// </remarks>
internal sealed class WindowActivation
{
    private readonly ILoggerService _logger;
    private PhotinoWindow? _window;

    public WindowActivation(ILoggerService logger)
    {
        _logger = logger;
    }

    public void Attach(PhotinoWindow window) => Volatile.Write(ref _window, window);

    /// <summary>
    /// Runs on the listener thread. False once the window has closed, so the launch waits to take
    /// the profile over. A window held open by a save prompt still counts as open.
    /// </summary>
    public bool Activate()
    {
        var window = Volatile.Read(ref _window);

        // Still starting up; the window opens in front when it does.
        if (window is null || !window.IsInitialized)
            return true;

        if (window.IsClosed)
            return false;

        window.Invoke(() =>
        {
            try
            {
                // Raising a minimized window does not restore it on every platform.
                if (window.WindowState == PhotinoWindowState.Minimized)
                    window.SetMinimized(false);
                window.BringToFront();
                if (OperatingSystem.IsMacOS())
                    MacWindow.ActivateApp(_logger);
            }
            catch (InvalidOperationException ex)
            {
                _logger.Warning(CrashLog.Category, $"The window could not be brought forward: {ex.Message}");
            }
        });
        return true;
    }
}
