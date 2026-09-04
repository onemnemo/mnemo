using System;
using System.Collections.Concurrent;

namespace Mnemo.Host.Chrome;

/// <summary>A native window procedure, as the platform passes one around.</summary>
internal delegate IntPtr WindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

/// <summary>
/// Remembers, for each native window handle, the window procedure that was there
/// before it was subclassed and the delegate that replaced it.
/// </summary>
/// <remarks>
/// <para>
/// Two things are kept, for two different reasons. The predecessor, because a message
/// a window does not handle has to continue to the procedure that was on
/// <em>that</em> handle: sent to another window's instead, it arrives somewhere it
/// was never addressed, and nothing fails at the point where that goes wrong. The
/// delegate, because what the handle holds is a raw function pointer produced by
/// <see cref="System.Runtime.InteropServices.Marshal.GetFunctionPointerForDelegate{TDelegate}(TDelegate)"/>
/// and the collector cannot see it, so something managed has to stay reachable for as
/// long as the handle can be sent a message.
/// </para>
/// <para>
/// An entry is dropped once its window is destroyed, which releases the delegate and
/// keeps the table from growing over a session of opening and closing windows. A
/// handle that arrives carrying an entry replaces it, since handle values are reused
/// and the arriving window's predecessor is the only correct one.
/// </para>
/// </remarks>
internal sealed class WindowSubclassTable
{
    private readonly ConcurrentDictionary<IntPtr, Entry> _entries = new();

    /// <summary>How many windows are currently subclassed.</summary>
    public int Count => _entries.Count;

    /// <summary>
    /// Roots <paramref name="subclass"/> against <paramref name="hwnd"/> and records the
    /// procedure it is replacing. Returns the delegate, so the caller installs the same
    /// instance that is now rooted.
    /// </summary>
    public WindowProc Add(IntPtr hwnd, WindowProc subclass, IntPtr previous)
    {
        _entries[hwnd] = new Entry(subclass, previous);
        return subclass;
    }

    /// <summary>
    /// The procedure this window had before it was subclassed, or zero if it is not
    /// subclassed (or is no longer).
    /// </summary>
    public IntPtr PreviousProc(IntPtr hwnd) =>
        _entries.TryGetValue(hwnd, out var entry) ? entry.Previous : IntPtr.Zero;

    /// <summary>
    /// Forgets this window, releasing the last reference to its delegate. Returns the
    /// procedure it was forwarding to, or zero if there was no entry.
    /// </summary>
    /// <remarks>Atomic, so a handle cannot be released twice.</remarks>
    public IntPtr Remove(IntPtr hwnd) =>
        _entries.TryRemove(hwnd, out var entry) ? entry.Previous : IntPtr.Zero;

    private sealed record Entry(WindowProc Subclass, IntPtr Previous);
}
