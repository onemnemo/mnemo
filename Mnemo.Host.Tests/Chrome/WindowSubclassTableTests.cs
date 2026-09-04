using System;
using System.Runtime.CompilerServices;
using Mnemo.Host.Chrome;

namespace Mnemo.Host.Tests.Chrome;

/// <remarks>
/// No window is created here. The table is the part of the frame subclassing that
/// holds state, and it is deliberately free of interop so its contract can be
/// asserted directly.
/// </remarks>
public sealed class WindowSubclassTableTests
{
    private static readonly IntPtr First = new(0x1010);
    private static readonly IntPtr Second = new(0x2020);
    private static readonly IntPtr FirstPrevious = new(0xAAAA);
    private static readonly IntPtr SecondPrevious = new(0xBBBB);

    [Fact]
    public void EachWindowForwardsToItsOwnPredecessor()
    {
        var table = new WindowSubclassTable();

        table.Add(First, Nothing(), FirstPrevious);
        table.Add(Second, Nothing(), SecondPrevious);

        Assert.Equal(FirstPrevious, table.PreviousProc(First));
        Assert.Equal(SecondPrevious, table.PreviousProc(Second));
        Assert.Equal(2, table.Count);
    }

    [Fact]
    public void AnUnknownWindowReportsNoPredecessor()
    {
        var table = new WindowSubclassTable();

        Assert.Equal(IntPtr.Zero, table.PreviousProc(First));
        Assert.Equal(IntPtr.Zero, table.Remove(First));
    }

    /// <remarks>
    /// Registering a window must not release what an earlier one still depends on.
    /// The table is the only managed reference to a delegate whose function pointer
    /// is already installed on a live handle.
    /// </remarks>
    [Fact]
    public void ASecondWindowDoesNotReleaseTheFirstWindowsDelegate()
    {
        var table = new WindowSubclassTable();
        var first = AddForgettableDelegate(table, First, FirstPrevious);

        AddForgettableDelegate(table, Second, SecondPrevious);
        Collect();

        Assert.True(first.IsAlive);
        Assert.Equal(FirstPrevious, table.PreviousProc(First));
    }

    [Fact]
    public void ForgettingAWindowReleasesItsDelegate()
    {
        var table = new WindowSubclassTable();
        var only = AddForgettableDelegate(table, First, FirstPrevious);

        Assert.Equal(FirstPrevious, table.Remove(First));
        Collect();

        Assert.False(only.IsAlive);
        Assert.Equal(IntPtr.Zero, table.PreviousProc(First));
        Assert.Equal(0, table.Count);
    }

    /// <remarks>
    /// Handle values are reused once a window is destroyed, so an arriving window
    /// that carries a handle the table has seen before must overwrite what is there
    /// rather than inherit a dead window's predecessor.
    /// </remarks>
    [Fact]
    public void AReusedHandleReplacesWhatWasThere()
    {
        var table = new WindowSubclassTable();

        table.Add(First, Nothing(), FirstPrevious);
        table.Add(First, Nothing(), SecondPrevious);

        Assert.Equal(SecondPrevious, table.PreviousProc(First));
        Assert.Equal(1, table.Count);
    }

    /// <remarks>
    /// A closure rather than a method group, so the compiler's cache for static
    /// method group conversions cannot be what keeps the delegate alive.
    /// </remarks>
    private static WindowProc Nothing()
    {
        var token = new object();
        return (_, _, _, _) =>
        {
            GC.KeepAlive(token);
            return IntPtr.Zero;
        };
    }

    /// <remarks>
    /// Separate and not inlined, so the only reference to the delegate once this
    /// returns is the one the table holds.
    /// </remarks>
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static WeakReference AddForgettableDelegate(WindowSubclassTable table, IntPtr hwnd, IntPtr previous)
    {
        var subclass = Nothing();
        table.Add(hwnd, subclass, previous);
        return new WeakReference(subclass);
    }

    private static void Collect()
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
    }
}
