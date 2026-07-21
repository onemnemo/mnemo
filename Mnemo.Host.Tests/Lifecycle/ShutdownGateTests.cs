using System.Diagnostics;
using Mnemo.Host.Lifecycle;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// The gate decides whether the window closes. Its failure mode is not a lost
/// save but an application that will not quit, so both exits - the client
/// answered, and nobody did - are covered here rather than left to a live run.
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
        var waiting = gate.WaitForReadyAsync(Generous);

        gate.SignalReady();

        Assert.True(await waiting);
    }

    [Fact]
    public async Task WaitingEndsImmediatelyWhenTheClientAlreadyAnswered()
    {
        var gate = new ShutdownGate();
        gate.SignalReady();

        // A save that finished before the window got around to waiting still counts.
        Assert.True(await gate.WaitForReadyAsync(Generous));
    }

    [Fact]
    public async Task WaitingGivesUpWhenNobodyAnswers()
    {
        var gate = new ShutdownGate();
        var clock = Stopwatch.StartNew();

        Assert.False(await gate.WaitForReadyAsync(Instant));
        Assert.True(clock.Elapsed < Generous, "the grace period bounds the wait");
    }

    [Fact]
    public async Task RepeatedReadyReportsAreHarmless()
    {
        var gate = new ShutdownGate();
        gate.SignalReady();
        gate.SignalReady();

        Assert.True(await gate.WaitForReadyAsync(Generous));
    }

    [Fact]
    public async Task WaitingEndsWhenTheCallerCancels()
    {
        var gate = new ShutdownGate();
        using var cancellation = new CancellationTokenSource();
        var waiting = gate.WaitForReadyAsync(Generous, cancellation.Token);

        await cancellation.CancelAsync();

        // Reported as "not ready" rather than thrown: the caller's next move is to
        // close either way, and an exception there would go nowhere.
        Assert.False(await waiting);
    }
}
