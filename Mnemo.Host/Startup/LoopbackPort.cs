using System.Net;
using System.Net.Sockets;

namespace Mnemo.Host.Startup;

/// <summary>
/// The loopback port the production API binds to, and with it the origin the window loads.
/// </summary>
/// <remarks>
/// Every browser engine partitions localStorage and IndexedDB by the full origin tuple,
/// port included. Letting the OS pick an ephemeral port therefore handed the SPA an empty
/// web store on every launch: the first-paint theme hint, the dock width, the last route
/// and the recent emoji were all written to an origin that never came back.
///
/// The preferred port sits below 32768 to stay clear of the ranges the OS allocates
/// outbound connections from (Linux 32768-60999, Windows and macOS 49152-65535), so it is
/// not handed to another process while Mnemo is closed. It pairs with the dev port in
/// <see cref="HostOptions.DefaultDevApiPort"/>, which stays where it is because the Vite
/// proxy targets it.
/// </remarks>
public static class LoopbackPort
{
    /// <summary>The port production binds when nothing else on the machine holds it.</summary>
    public const int Preferred = 27210;

    /// <summary>
    /// How many consecutive ports are tried, starting at <see cref="Preferred"/>.
    /// </summary>
    /// <remarks>
    /// Enough headroom for a stale instance, a second window and a neighbour that took the
    /// port first. Beyond that the machine is telling us something is wrong, and walking
    /// further only buys a launch that silently looks reset.
    /// </remarks>
    public const int CandidateCount = 8;

    /// <summary>The ports considered, in the fixed order they are tried.</summary>
    public static IReadOnlyList<int> Candidates { get; } = [.. Enumerable.Range(Preferred, CandidateCount)];

    /// <summary>
    /// A held loopback port. The socket stays bound until this is disposed, which is what
    /// stops a second instance claiming the same port while this one is still starting up.
    /// </summary>
    public sealed class Reservation : IDisposable
    {
        private Socket? _socket;

        internal Reservation(int port, Socket socket)
        {
            Port = port;
            _socket = socket;
        }

        /// <summary>The reserved port.</summary>
        public int Port { get; }

        /// <summary>
        /// Releases the port. Safe to call more than once, which lets a caller hand the
        /// port over at the right moment and still guard the failure paths with
        /// <c>using</c>.
        /// </summary>
        public void Dispose()
        {
            var socket = Interlocked.Exchange(ref _socket, null);
            socket?.Dispose();
        }
    }

    /// <summary>
    /// Binds the first free candidate port and holds it.
    /// </summary>
    /// <exception cref="InvalidOperationException">Every candidate is taken.</exception>
    public static Reservation Reserve() => Reserve(Candidates);

    /// <summary>
    /// Binds the first free port in <paramref name="candidates"/> and holds it.
    /// </summary>
    /// <remarks>
    /// The socket is kept open rather than probed and closed, because the caller has a
    /// whole backend to initialize before Kestrel binds. Half a second of leaving the port
    /// free is long enough for two instances started together to both find it available and
    /// for the loser to die on Kestrel's bind. Holding it means the second instance reads
    /// the port as taken and steps to the next candidate, which is the behavior a user
    /// double-clicking the shortcut twice already relied on.
    /// </remarks>
    /// <exception cref="InvalidOperationException">Every candidate is taken.</exception>
    public static Reservation Reserve(IReadOnlyList<int> candidates)
    {
        ArgumentNullException.ThrowIfNull(candidates);

        Socket? held = null;
        var refusal = SocketError.Success;

        try
        {
            var port = Resolve(candidates, candidate =>
            {
                held = TryListen(candidate, out var failure);
                if (held is null && failure != SocketError.AddressAlreadyInUse)
                    refusal = failure;

                return held is not null;
            });

            return new Reservation(port, held!);
        }
        catch (InvalidOperationException ex) when (refusal != SocketError.Success)
        {
            // A refusal that is not "in use" means the advice in the message below, close
            // the other instance, cannot help. Windows refuses a port inside a range
            // reserved by Hyper-V, WSL2 or Docker Desktop with access denied rather than
            // address in use, and the OS is the only thing that can say so.
            throw new InvalidOperationException($"{ex.Message} The last refusal was {refusal}.", ex);
        }
        catch
        {
            held?.Dispose();
            throw;
        }
    }

    /// <summary>
    /// The first candidate <paramref name="isAvailable"/> accepts.
    /// </summary>
    /// <exception cref="InvalidOperationException"><paramref name="isAvailable"/> rejected every candidate.</exception>
    public static int Resolve(Func<int, bool> isAvailable) => Resolve(Candidates, isAvailable);

    /// <summary>
    /// The first of <paramref name="candidates"/> that <paramref name="isAvailable"/> accepts.
    /// </summary>
    /// <remarks>
    /// The order is fixed, so the same machine state resolves to the same port on every
    /// launch. That is the whole contract: a stable origin, not merely a constant one.
    /// </remarks>
    /// <exception cref="InvalidOperationException">
    /// <paramref name="isAvailable"/> rejected every candidate. Startup fails here rather
    /// than falling back to an ephemeral port, because a port nobody can predict is the
    /// defect this type exists to prevent, and failing is easier to diagnose than an app
    /// that comes up having forgotten its settings.
    /// </exception>
    public static int Resolve(IReadOnlyList<int> candidates, Func<int, bool> isAvailable)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        ArgumentNullException.ThrowIfNull(isAvailable);

        if (candidates.Count == 0)
            throw new ArgumentException("At least one candidate port is required.", nameof(candidates));

        foreach (var port in candidates)
        {
            if (isAvailable(port))
                return port;
        }

        throw new InvalidOperationException(
            $"No free loopback port between {candidates[0]} and {candidates[^1]}. "
            + "Another Mnemo instance is probably still running; close it and try again.");
    }

    /// <summary>
    /// Opens a listener on <paramref name="port"/> at 127.0.0.1, or reports why not.
    /// </summary>
    /// <remarks>
    /// Listening rather than merely binding, because SO_REUSEADDR (which both this and
    /// Kestrel set) lets a second bind succeed against a bound socket that never listened.
    /// A reservation that does not listen does not reserve anything.
    /// </remarks>
    private static Socket? TryListen(int port, out SocketError failure)
    {
        var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
        try
        {
            socket.Bind(new IPEndPoint(IPAddress.Loopback, port));
            socket.Listen(1);
            failure = SocketError.Success;
            return socket;
        }
        catch (SocketException ex)
        {
            socket.Dispose();
            failure = ex.SocketErrorCode;
            return null;
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
}
