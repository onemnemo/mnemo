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
    /// <remarks>
    /// Only Windows reports a true work area here. The other two measure the whole
    /// display, so a mac window is not held clear of the dock and a linux one is not
    /// held clear of a panel. That is deliberate: reading the real usable rectangle
    /// costs an AppKit or EWMH round trip on a startup path that has no toolkit loaded
    /// yet, and every failure this type exists to prevent is a window larger than the
    /// screen. A ceiling one panel too generous still prevents all of them.
    /// </remarks>
    private static bool TryGetPrimaryWorkArea(out int width, out int height)
    {
        width = 0;
        height = 0;

        if (OperatingSystem.IsWindows())
            return TryGetWindowsPrimaryWorkArea(out width, out height);

        if (OperatingSystem.IsMacOS())
            return TryGetMacOSPrimaryDisplay(out width, out height);

        if (OperatingSystem.IsLinux())
            return TryGetLinuxPrimaryDisplay(out width, out height);

        return false;
    }

    /// <remarks>
    /// CoreGraphics reports points, which is the same unit a mac window is sized in,
    /// so this one needs none of the scaling correction the Windows path does.
    /// </remarks>
    [SupportedOSPlatform("macos")]
    private static bool TryGetMacOSPrimaryDisplay(out int width, out int height)
    {
        width = 0;
        height = 0;

        try
        {
            var bounds = CGDisplayBounds(CGMainDisplayID());
            width = (int)bounds.Width;
            height = (int)bounds.Height;
            return width > 0 && height > 0;
        }
        catch (Exception)
        {
            // A window sized from the fallback beats a window that never opens.
            return false;
        }
    }

    /// <remarks>
    /// Xlib rather than a Wayland protocol because the shell runs under XWayland on a
    /// Wayland session anyway, and a compositor that offers no X server at all leaves
    /// the library missing, which lands on the fallback exactly as an unmeasurable
    /// display should.
    /// </remarks>
    [SupportedOSPlatform("linux")]
    private static bool TryGetLinuxPrimaryDisplay(out int width, out int height)
    {
        width = 0;
        height = 0;

        var display = IntPtr.Zero;
        try
        {
            // Null asks for the session named by $DISPLAY, which is the one the app
            // is about to open its own window on.
            display = XOpenDisplay(null);
            if (display == IntPtr.Zero)
                return false;

            var screen = XDefaultScreen(display);
            width = XDisplayWidth(display, screen);
            height = XDisplayHeight(display, screen);
            return width > 0 && height > 0;
        }
        catch (Exception)
        {
            return false;
        }
        finally
        {
            if (display != IntPtr.Zero)
                XCloseDisplay(display);
        }
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

    /// <summary>CoreGraphics CGRect: an origin and a size, all in points.</summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct CGRect
    {
        public double X;
        public double Y;
        public double Width;
        public double Height;
    }

    private const string CoreGraphics = "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics";

    [DllImport(CoreGraphics)]
    private static extern uint CGMainDisplayID();

    [DllImport(CoreGraphics)]
    private static extern CGRect CGDisplayBounds(uint display);

    private const string X11 = "libX11.so.6";

    [DllImport(X11)]
    private static extern IntPtr XOpenDisplay(string? name);

    [DllImport(X11)]
    private static extern int XCloseDisplay(IntPtr display);

    [DllImport(X11)]
    private static extern int XDefaultScreen(IntPtr display);

    [DllImport(X11)]
    private static extern int XDisplayWidth(IntPtr display, int screen);

    [DllImport(X11)]
    private static extern int XDisplayHeight(IntPtr display, int screen);
}
