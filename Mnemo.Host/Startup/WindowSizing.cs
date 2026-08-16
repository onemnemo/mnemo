using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Mnemo.Host.Startup;

/// <summary>
/// The size the main window opens at.
/// </summary>
/// <remarks>
/// The preferred size is a ceiling, not a promise. The app draws its own caption
/// buttons, so a window taller or wider than the display puts them off-screen with
/// no OS titlebar left to drag the window back by, and on a 1366x768 laptop an
/// unclamped 1440x900 overhangs all four sides.
/// </remarks>
public static class WindowSizing
{
    public const int PreferredWidth = 1440;
    public const int PreferredHeight = 900;

    /// <summary>Below this the sidebar and the content pane stop coexisting.</summary>
    public const int MinimumWidth = 960;
    public const int MinimumHeight = 640;

    public readonly record struct WindowBounds(int Width, int Height, int MinWidth, int MinHeight);

    /// <summary>Measures the display and fits the window to it.</summary>
    public static WindowBounds Resolve() =>
        TryGetPrimaryWorkArea(out var width, out var height) ? Resolve(width, height) : Resolve(0, 0);

    /// <summary>
    /// Fits the preferred size into a work area. A non-positive dimension means the
    /// work area could not be measured, and the preferred value stands.
    /// </summary>
    public static WindowBounds Resolve(int workAreaWidth, int workAreaHeight)
    {
        var width = Fit(PreferredWidth, workAreaWidth);
        var height = Fit(PreferredHeight, workAreaHeight);

        // A floor larger than the window it constrains would be enforced by the OS as a
        // window bigger than the screen, which is the problem this type exists to avoid.
        return new WindowBounds(width, height, Math.Min(MinimumWidth, width), Math.Min(MinimumHeight, height));
    }

    private static int Fit(int preferred, int available) =>
        available > 0 ? Math.Min(preferred, available) : preferred;

    /// <summary>
    /// Photino only exposes its monitor list once the native window exists, which is
    /// after the size that window should have been created at was needed, so the
    /// measurement is taken from the OS directly.
    /// </summary>
    private static bool TryGetPrimaryWorkArea(out int width, out int height)
    {
        width = 0;
        height = 0;
        return OperatingSystem.IsWindows() && TryGetWindowsPrimaryWorkArea(out width, out height);
    }

    [SupportedOSPlatform("windows")]
    private static bool TryGetWindowsPrimaryWorkArea(out int width, out int height)
    {
        width = 0;
        height = 0;

        try
        {
            // PhotinoX creates its window on a per-monitor-aware thread, so its sizes are
            // physical pixels. This thread inherits the process default, which is unaware
            // without a manifest, and would report a work area scaled down by the display
            // scaling factor. Matching contexts is what keeps the two in the same unit.
            Rect area;
            var previous = SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
            try
            {
                if (!SystemParametersInfoW(SpiGetWorkArea, 0, out area, 0))
                    return false;
            }
            finally
            {
                if (previous != IntPtr.Zero)
                    SetThreadDpiAwarenessContext(previous);
            }

            width = area.Right - area.Left;
            height = area.Bottom - area.Top;
            return width > 0 && height > 0;
        }
        catch (Exception)
        {
            // A window sized from the fallback beats a window that never opens.
            return false;
        }
    }

    private const uint SpiGetWorkArea = 0x0030;
    private static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 = -4;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SystemParametersInfoW(uint action, uint param, out Rect result, uint update);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
