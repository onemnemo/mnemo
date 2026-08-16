using System.Diagnostics;
using Mnemo.Host.Lifecycle;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// The gate decides whether the window closes. Its failure modes are not a lost
/// save but an application that will not quit, and a decline that quietly closes
/// anyway, so every exit - answered, declined, and nobody home - is covered here
/// rather than left to a live run.
/// </summary>
public sealed class ShutdownGateTests
{
    private static readonly TimeSpan Instant = TimeSpan.FromMilliseconds(50);
    private static readonly TimeSpan Generous = TimeSpan.FromSeconds(5);

    [Fact]
    public void FirstCloseRequestClaimsTheDrain()
    {
        var gate = new ShutdownGate();
        Assert.True(gate.TryBeginDrain());
    }

    [Fact]
    public void LaterCloseRequestsAreNotHeld()
    {
        var gate = new ShutdownGate();
        gate.TryBeginDrain();

        // The close the gate asks for itself arrives through the same handler, and
        // so does an impatient second press. Holding either would strand the window.
        Assert.False(gate.TryBeginDrain());
        Assert.False(gate.TryBeginDrain());
    }

    [Fact]
    public async Task WaitingEndsWhenTheClientReportsReady()
    {
        var gate = new ShutdownGate();
        var waiting = gate.WaitForVerdictAsync(Generous);

        gate.SignalReady();

        Assert.Equal(ShutdownVerdict.Ready, await waiting);
    }

    [Fact]
    public async Task WaitingEndsImmediatelyWhenTheClientAlreadyAnswered()
    {
        var gate = new ShutdownGate();
        gate.SignalReady();

        // A save that finished before the window got around to waiting still counts.
        Assert.Equal(ShutdownVerdict.Ready, await gate.WaitForVerdictAsync(Generous));
    }

    [Fact]
    public async Task WaitingGivesUpWhenNobodyAnswers()
    {
        var gate = new ShutdownGate();
        var clock = Stopwatch.StartNew();

        Assert.Equal(ShutdownVerdict.TimedOut, await gate.WaitForVerdictAsync(Instant));
        Assert.True(clock.Elapsed < Generous, "the grace period bounds the wait");
    }

    [Fact]
    public async Task RepeatedReadyReportsAreHarmless()
    {
        var gate = new ShutdownGate();
        gate.SignalReady();
        gate.SignalReady();

        Assert.Equal(ShutdownVerdict.Ready, await gate.WaitForVerdictAsync(Generous));
    }

    [Fact]
    public async Task WaitingEndsWhenTheCallerCancels()
    {
        var gate = new ShutdownGate();
        using var cancellation = new CancellationTokenSource();
        var waiting = gate.WaitForVerdictAsync(Generous, cancellation.Token);

        await cancellation.CancelAsync();

        // Reported as a timeout rather than thrown: the caller's next move is to
        // close either way, and an exception there would go nowhere.
        Assert.Equal(ShutdownVerdict.TimedOut, await waiting);
    }

    [Fact]
    public async Task DecliningKeepsTheWindowOpen()
    {
        var gate = new ShutdownGate();
        var waiting = gate.WaitForVerdictAsync(Generous);

        gate.SignalCancelled();

        Assert.Equal(ShutdownVerdict.Cancelled, await waiting);
    }

    [Fact]
    public async Task TheFirstAnswerIsTheOneThatCounts()
    {
        var gate = new ShutdownGate();
        gate.SignalCancelled();
        gate.SignalReady();

        // Otherwise a late ready from a client that already backed out would close a
        // window the user just asked to keep.
        Assert.Equal(ShutdownVerdict.Cancelled, await gate.WaitForVerdictAsync(Generous));
    }

    [Fact]
    public async Task HoldingStopsTheClock()
    {
        var gate = new ShutdownGate();
        gate.SignalHolding();

        // A person reading a dialog will outlast any grace period, so the wait must
        // survive one that has already expired.
        var waiting = gate.WaitForVerdictAsync(Instant);
        await Task.Delay(Instant * 4);
        Assert.False(waiting.IsCompleted);

        gate.SignalReady();
        Assert.Equal(ShutdownVerdict.Ready, await waiting);
    }

    [Fact]
    public async Task AHoldWithoutAnAnswerStillLetsASecondPressThrough()
    {
        var gate = new ShutdownGate();
        gate.TryBeginDrain();
        gate.SignalHolding();

        var waiting = gate.WaitForVerdictAsync(Instant);
        await Task.Delay(Instant * 4);

        // The unbounded wait is only safe because this is true: a prompt that never
        // resolves must not be a window that cannot be closed.
        Assert.False(waiting.IsCompleted);
        Assert.False(gate.TryBeginDrain());
    }

    [Fact]
    public async Task ResetArmsTheGateForTheNextClose()
    {
        var gate = new ShutdownGate();
        gate.TryBeginDrain();
        gate.SignalCancelled();
        Assert.Equal(ShutdownVerdict.Cancelled, await gate.WaitForVerdictAsync(Generous));

        gate.Reset();

        // Without this the next close finds the drain spent and skips it, closing
        // with neither a prompt nor a save.
        Assert.True(gate.TryBeginDrain());
        var waiting = gate.WaitForVerdictAsync(Generous);
        gate.SignalReady();
        Assert.Equal(ShutdownVerdict.Ready, await waiting);
    }

    [Fact]
    public async Task ResetForgetsAnEarlierHold()
    {
        var gate = new ShutdownGate();
        gate.SignalHolding();
        gate.SignalCancelled();
        await gate.WaitForVerdictAsync(Generous);

        gate.Reset();

        // A stale hold would leave the next close waiting forever on a client that
        // has nothing to ask.
        Assert.Equal(ShutdownVerdict.TimedOut, await gate.WaitForVerdictAsync(Instant));
    }
}
