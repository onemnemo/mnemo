using System.Net;
using System.Net.Sockets;
using Mnemo.Host;
using Mnemo.Host.Startup;

namespace Mnemo.Host.Tests.Startup;

/// <summary>
/// The port production binds is half of the window's origin, and browsers key
/// localStorage and IndexedDB off the origin. These cover the rule that decides it and
/// the reservation that keeps it.
/// </summary>
/// <remarks>
/// These exist because the answer used to be "whatever the OS had spare". Every launch
/// got a fresh ephemeral port, so every launch got an empty web store, and the theme
/// hint that prevents a light flash on a dark install could never fire.
///
/// The socket tests use a band of their own. Binding the real production ports would
/// perturb an app starting on the same machine, which is precisely the interference the
/// reservation exists to handle correctly.
/// </remarks>
public sealed class LoopbackPortTests
{
    private static readonly int[] TestCandidates = [29470, 29471, 29472];

    [Fact]
    public void AFreeMachineGetsThePreferredPort()
    {
        var port = LoopbackPort.Resolve(_ => true);

        Assert.Equal(LoopbackPort.Preferred, port);
    }

    [Fact]
    public void TheSameMachineStateResolvesTheSamePortEveryLaunch()
    {
        // The invariant is a stable origin, not a constant one: a machine where the
        // preferred port is permanently taken still has to answer the same way twice.
        bool IsAvailable(int port) => port != LoopbackPort.Preferred;

        Assert.Equal(LoopbackPort.Resolve(IsAvailable), LoopbackPort.Resolve(IsAvailable));
    }

    [Fact]
    public void APortSomethingElseOwnsIsSteppedOver()
    {
        var port = LoopbackPort.Resolve(candidate => candidate != LoopbackPort.Preferred);

        Assert.Equal(LoopbackPort.Preferred + 1, port);
    }

    [Fact]
    public void ARunOfTakenPortsResolvesToTheFirstOneAfterIt()
    {
        var taken = new[] { LoopbackPort.Preferred, LoopbackPort.Preferred + 1, LoopbackPort.Preferred + 2 };

        var port = LoopbackPort.Resolve(candidate => !taken.Contains(candidate));

        Assert.Equal(LoopbackPort.Preferred + 3, port);
    }

    [Fact]
    public void EveryCandidateTakenFailsStartupInsteadOfPickingAnEphemeralPort()
    {
        // Falling back to a port nobody can predict is the defect, not the recovery.
        var error = Assert.Throws<InvalidOperationException>(() => LoopbackPort.Resolve(_ => false));

        Assert.Contains(LoopbackPort.Preferred.ToString(), error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void EveryCandidateIsProbedBeforeGivingUp()
    {
        var probed = new List<int>();

        Assert.Throws<InvalidOperationException>(() => LoopbackPort.Resolve(port =>
        {
            probed.Add(port);
            return false;
        }));

        Assert.Equal(LoopbackPort.Candidates, probed);
    }

    [Fact]
    public void TheCandidatesStayClearOfTheRangeTheOsHandsOutForOutboundConnections()
    {
        // Linux allocates ephemeral ports from 32768 up, Windows and macOS from 49152.
        // A candidate inside either range can be held by an unrelated connection while
        // Mnemo is closed, which costs the user their web storage on the next launch.
        Assert.All(LoopbackPort.Candidates, port => Assert.InRange(port, 1024, 32767));
    }

    [Fact]
    public void TheDevPortIsNotOneOfThem()
    {
        // A dev host and a packaged install run side by side against separate profiles,
        // and sharing a port would make whichever started second look reset.
        Assert.DoesNotContain(HostOptions.DefaultDevApiPort, LoopbackPort.Candidates);
    }

    [Fact]
    public void AReservationKeepsThePortUntilItIsDisposed()
    {
        // The reservation is held across backend init, which is the half second that
        // decides whether a second instance can still claim the same port.
        var reservation = LoopbackPort.Reserve(TestCandidates);

        Assert.Throws<SocketException>(() => Listen(reservation.Port).Dispose());

        reservation.Dispose();

        Listen(reservation.Port).Dispose();
    }

    [Fact]
    public void ASecondReservationStepsToTheNextCandidate()
    {
        // Two instances launched together. Before the port was held rather than probed,
        // both of these came back with the same answer and the loser died on Kestrel's bind.
        using var first = LoopbackPort.Reserve(TestCandidates);
        using var second = LoopbackPort.Reserve(TestCandidates);

        Assert.Equal(TestCandidates[0], first.Port);
        Assert.Equal(TestCandidates[1], second.Port);
    }

    [Fact]
    public void DisposingAReservationTwiceIsHarmless()
    {
        // The caller hands the port to Kestrel explicitly and still guards the failure
        // paths with using, so the second call is the normal case, not an error.
        var reservation = LoopbackPort.Reserve(TestCandidates);

        reservation.Dispose();
        reservation.Dispose();

        Listen(reservation.Port).Dispose();
    }

    [Fact]
    public void EveryCandidateHeldByARealSocketFailsWithTheLadderMessage()
    {
        var held = TestCandidates.Select(Listen).ToList();
        try
        {
            var error = Assert.Throws<InvalidOperationException>(() => LoopbackPort.Reserve(TestCandidates));

            Assert.Contains(TestCandidates[0].ToString(), error.Message, StringComparison.Ordinal);
            Assert.Contains(TestCandidates[^1].ToString(), error.Message, StringComparison.Ordinal);
        }
        finally
        {
            foreach (var socket in held)
                socket.Dispose();
        }
    }

    private static Socket Listen(int port)
    {
        var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
        try
        {
            socket.Bind(new IPEndPoint(IPAddress.Loopback, port));
            socket.Listen(1);
            return socket;
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
}
