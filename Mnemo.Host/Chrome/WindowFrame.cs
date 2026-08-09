using System;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Photino.NET;

namespace Mnemo.Host.Chrome;

/// <summary>
/// Gives the chromeless window back the parts of a real Windows window that a
/// bare popup does not get.
/// </summary>
/// <remarks>
/// PhotinoX creates a chromeless window as WS_POPUP and nothing else. Windows
/// reads a window's style bits to decide what the shell may do with it, and a
/// plain popup opts out of most of it: no Snap, no Win+Arrow, no shake, no
/// system menu, and no DWM frame, which is also where the drop shadow, the
/// rounded corners and the minimize and restore animations come from. That is
/// the difference between a window that moves when dragged and a window that
/// behaves like every other one on the desktop, and no amount of work on the
/// drag itself can close it.
///
/// So we ask for the ordinary overlapped frame and then take the whole of it
/// back as client area in WM_NCCALCSIZE. Windows sees a normal app window and
/// treats it like one; the user sees no caption and no border, because none is
/// ever left to draw. This is the same trick Electron and the Windows Terminal
/// use, and it is why their frameless windows still snap.
///
/// One trap for later: PhotinoX rewrites the style bits back to a popup in
/// SetFullScreen, so anything that starts using fullscreen has to reapply this
/// on the way out.
/// </remarks>
[SupportedOSPlatform("windows")]
internal static class WindowFrame
{
    /// <summary>
    /// Keeps the subclass delegate rooted. Mnemo has one window; a second call
    /// would need this per handle.
    /// </summary>
    private static WndProcDelegate? s_subclass;

    private static IntPtr s_previousProc;

    public static void Attach(PhotinoWindow window)
    {
        // The handle only exists once the native window does, and PhotinoX shows
        // it during construction, so the frame arrives a beat after the first
        // paint rather than before it.
        window.RegisterCreatedHandler((sender, _) =>
        {
            if (sender is PhotinoWindow created)
                Apply(created);
        });
    }

    private static void Apply(PhotinoWindow window)
    {
        try
        {
            var hwnd = window.WindowHandle;
            if (hwnd == IntPtr.Zero)
                return;

            // Before the styles, so the first WM_NCCALCSIZE that SWP_FRAMECHANGED
            // provokes is already ours and no caption is ever drawn.
            s_previousProc = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
            s_subclass = SubclassProc;
            SetWindowLongPtrW(hwnd, GWLP_WNDPROC, Marshal.GetFunctionPointerForDelegate(s_subclass));

            var style = (long)GetWindowLongPtrW(hwnd, GWL_STYLE);
            style &= ~WS_POPUP;
            style |= WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
            SetWindowLongPtrW(hwnd, GWL_STYLE, (IntPtr)style);

            // Nothing moves or resizes; this only makes Windows recompute the
            // non-client area against the styles it just gained.
            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }
        catch (Exception ex)
        {
            // A window that does not snap is worth strictly less than a window
            // that does not open, so any interop failure leaves the popup as it
            // was.
            Console.WriteLine($"[Mnemo.Host] Native window frame not applied: {ex.Message}");
        }
    }

    private static IntPtr SubclassProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_NCCALCSIZE && wParam != IntPtr.Zero)
        {
            var target = Marshal.PtrToStructure<Rect>(lParam);

            if (IsZoomed(hwnd))
            {
                // A maximized window is deliberately larger than the monitor by
                // the frame it normally hides behind. Left alone, that overhang
                // would now be client area and the edges of the page would sit
                // off-screen.
                var dpi = GetDpiForWindow(hwnd);
                var padding = GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
                var x = GetSystemMetricsForDpi(SM_CXFRAME, dpi) + padding;
                var y = GetSystemMetricsForDpi(SM_CYFRAME, dpi) + padding;

                target.Left += x;
                target.Right -= x;
                target.Top += y;
                target.Bottom -= y;

                KeepAutoHideBarReachable(hwnd, ref target);
                Marshal.StructureToPtr(target, lParam, false);
            }

            // Zero, with the rectangle otherwise untouched: the client area is
            // the window, and there is no non-client area left to paint.
            return IntPtr.Zero;
        }

        return CallWindowProcW(s_previousProc, hwnd, msg, wParam, lParam);
    }

    /// <summary>
    /// Leaves a hairline of the monitor uncovered on whichever edge holds an
    /// auto-hiding taskbar.
    /// </summary>
    /// <remarks>
    /// A maximized window normally stops at the work area, which already excludes
    /// the taskbar. An auto-hiding one is not in the work area, so our client
    /// area covers the whole monitor and the shell stops re-showing the bar when
    /// the pointer reaches the edge: the taskbar becomes unreachable until the
    /// window is restored. One pixel is enough to keep it coming back, and is not
    /// visible.
    /// </remarks>
    private static void KeepAutoHideBarReachable(IntPtr hwnd, ref Rect client)
    {
        var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if (monitor == IntPtr.Zero)
            return;

        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfoW(monitor, ref info))
            return;

        switch (FindAutoHideEdge(info.Monitor))
        {
            case ABE_TOP: client.Top += 1; break;
            case ABE_BOTTOM: client.Bottom -= 1; break;
            case ABE_LEFT: client.Left += 1; break;
            case ABE_RIGHT: client.Right -= 1; break;
        }
    }

    private static readonly uint[] Edges = [ABE_TOP, ABE_BOTTOM, ABE_LEFT, ABE_RIGHT];

    private static uint? FindAutoHideEdge(Rect monitor)
    {
        foreach (var edge in Edges)
        {
            var query = new AppBarData
            {
                Size = Marshal.SizeOf<AppBarData>(),
                Edge = edge,
                Rect = monitor,
            };

            if (SHAppBarMessage(ABM_GETAUTOHIDEBAREX, ref query) != IntPtr.Zero)
                return edge;
        }

        // Windows 11's taskbar does not answer the query above, so the documented
        // route finds nothing even while the bar is hiding. It does still report
        // the mode, and it still owns a window we can locate.
        var state = new AppBarData { Size = Marshal.SizeOf<AppBarData>() };
        if (((long)SHAppBarMessage(ABM_GETSTATE, ref state) & ABS_AUTOHIDE) == 0)
            return null;

        return TaskbarEdgeOn(monitor);
    }

    /// <summary>Which side of <paramref name="monitor"/> the taskbar hides on, if it is this monitor's.</summary>
    private static uint? TaskbarEdgeOn(Rect monitor)
    {
        foreach (var className in new[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" })
        {
            var bar = IntPtr.Zero;
            while ((bar = FindWindowExW(IntPtr.Zero, bar, className, null)) != IntPtr.Zero)
            {
                if (!IsWindowVisible(bar) || !GetWindowRect(bar, out var rect))
                    continue;

                // A hidden bar keeps a sliver on screen and hangs the rest off the
                // edge, so it is placed by which side of the monitor it clings to
                // rather than by where its centre lands.
                if (rect.Right <= monitor.Left || rect.Left >= monitor.Right
                    || rect.Bottom <= monitor.Top || rect.Top >= monitor.Bottom)
                    continue;

                if (rect.Right - rect.Left >= rect.Bottom - rect.Top)
                    return rect.Top - monitor.Top < monitor.Bottom - rect.Bottom ? ABE_TOP : ABE_BOTTOM;

                return rect.Left - monitor.Left < monitor.Right - rect.Right ? ABE_LEFT : ABE_RIGHT;
            }
        }

        return null;
    }

    private delegate IntPtr WndProcDelegate(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    private const int GWL_STYLE = -16;
    private const int GWLP_WNDPROC = -4;

    private const long WS_POPUP = 0x80000000L;
    private const long WS_CAPTION = 0x00C00000L;
    private const long WS_SYSMENU = 0x00080000L;
    private const long WS_THICKFRAME = 0x00040000L;
    private const long WS_MINIMIZEBOX = 0x00020000L;
    private const long WS_MAXIMIZEBOX = 0x00010000L;

    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;

    private const uint WM_NCCALCSIZE = 0x0083;

    private const int SM_CXFRAME = 32;
    private const int SM_CYFRAME = 33;
    private const int SM_CXPADDEDBORDER = 92;

    private const uint MONITOR_DEFAULTTONEAREST = 2;
    private const uint ABM_GETSTATE = 0x00000004;
    private const uint ABM_GETAUTOHIDEBAREX = 0x0000000B;
    private const long ABS_AUTOHIDE = 0x01;
    private const uint ABE_LEFT = 0;
    private const uint ABE_TOP = 1;
    private const uint ABE_RIGHT = 2;
    private const uint ABE_BOTTOM = 3;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        public int Size;
        public Rect Monitor;
        public Rect Work;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AppBarData
    {
        public int Size;
        public IntPtr Hwnd;
        public uint CallbackMessage;
        public uint Edge;
        public Rect Rect;
        public IntPtr Param;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindowLongPtrW(IntPtr hwnd, int index);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWindowLongPtrW(IntPtr hwnd, int index, IntPtr value);

    [DllImport("user32.dll")]
    private static extern IntPtr CallWindowProcW(IntPtr previous, IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsZoomed(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetricsForDpi(int index, uint dpi);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfo info);

    [DllImport("shell32.dll")]
    private static extern IntPtr SHAppBarMessage(uint message, ref AppBarData data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string? className, string? windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
}
