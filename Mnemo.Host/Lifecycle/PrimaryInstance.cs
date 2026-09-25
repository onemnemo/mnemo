using System.Diagnostics;
using System.Globalization;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using Mnemo.Core.Services;

namespace Mnemo.Host.Lifecycle;

/// <summary>What a launch got: the profile to run on, or a running instance that took over.</summary>
/// <param name="Primary">The claim this launch now holds, or null when it must not run.</param>
/// <param name="Activated">True when the instance already running answered and came forward.</param>
public sealed record InstanceClaim(PrimaryInstance? Primary, bool Activated);

/// <summary>
/// The one host a data profile runs at a time, and the channel a later launch on that profile
/// uses to bring the running window forward instead of opening a second copy.
/// </summary>
/// <remarks>
/// The claim is an exclusively held lock file, which the OS drops on any process death, so it is
/// never stale. The channel is keyed on the data root and role; a dev host takes its own role so
/// it can run beside the installed app.
/// </remarks>
public sealed class PrimaryInstance : IDisposable
{
    public const string AppRole = "app";
    public const string DevRole = "dev";

    private const string LogCategory = "Instance";
    private const string Greeting = "mnemo";
    private const string ActivateRequest = "activate";
    private const string Accepted = "ok";
    private const string Declined = "closing";

    private static readonly TimeSpan AnswerTimeout = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan ExchangeTimeout = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan MaxListenBackoff = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan DisposeWait = TimeSpan.FromSeconds(1);
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    private readonly FileStream _claim;
    private readonly string _endpoint;
    private CancellationTokenSource? _stop;
    private Task? _serving;

    private PrimaryInstance(FileStream claim, string endpoint)
    {
        _claim = claim;
        _endpoint = endpoint;
    }

    /// <summary>
    /// Claims <paramref name="dataRoot"/> for this process in <paramref name="role"/>. Returns
    /// null when a live process already holds that claim.
    /// </summary>
    public static PrimaryInstance? TryClaim(string dataRoot, string role)
    {
        var directory = Path.Combine(dataRoot, "locks");
        Directory.CreateDirectory(directory);

        // Never deleted: removing it would let a launch holding the old file and one creating a
        // new file both claim the profile.
        var path = Path.Combine(directory, $"primary-{role}.lock");
        try
        {
            var handle = new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            return new PrimaryInstance(handle, EndpointName(dataRoot, role));
        }
        catch (IOException ex) when (ex is not FileNotFoundException and not DirectoryNotFoundException)
        {
            // A sharing violation on Windows, a held flock elsewhere: another live host.
            return null;
        }
    }

    /// <summary>
    /// Answers later launches on this profile in the background until stopped. Each answer
    /// runs <paramref name="onActivate"/>, which returns false when this instance is on its way
    /// out, so the launch waits for the claim instead of handing over to a closing window.
    /// </summary>
    public void Listen(Func<bool> onActivate, ILoggerService logger)
    {
        if (_serving is not null)
            throw new InvalidOperationException("This instance is already listening.");

        if (!OperatingSystem.IsWindows())
        {
            // We hold the claim, so a socket file here is left over from a crash and would block binding.
            try
            {
                File.Delete(_endpoint);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                logger.Warning(LogCategory, $"Could not clear the leftover launch endpoint {_endpoint}: {ex.Message}");
            }
        }

        _stop = new CancellationTokenSource();
        var stop = _stop.Token;
        _serving = Task.Run(() => ServeAsync(onActivate, logger, stop));
    }

    /// <summary>Stops answering launches and waits for the listener to let go of the endpoint.</summary>
    public async Task StopListeningAsync()
    {
        if (_stop is null || _serving is null)
            return;

        await _stop.CancelAsync().ConfigureAwait(false);
        await _serving.ConfigureAwait(false);
    }

    /// <summary>
    /// Asks the instance holding <paramref name="dataRoot"/> in <paramref name="role"/> to bring
    /// its window forward. True only when it confirmed; false when nothing answered within
    /// <paramref name="timeout"/> or the instance declined because it is closing.
    /// </summary>
    public static async Task<bool> TryActivateAsync(string dataRoot, string role, TimeSpan timeout)
    {
        using var deadline = new CancellationTokenSource(timeout);
        try
        {
            await using var pipe = new NamedPipeClientStream(".", EndpointName(dataRoot, role), PipeDirection.InOut,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            await pipe.ConnectAsync(deadline.Token).ConfigureAwait(false);

            using var reader = new StreamReader(pipe, Utf8, false, 256, leaveOpen: true);
            await using var writer = new StreamWriter(pipe, Utf8, 256, leaveOpen: true) { AutoFlush = true };

            var greeting = await reader.ReadLineAsync(deadline.Token).ConfigureAwait(false);
            if (!TryReadProcessId(greeting, out var processId))
                return false;

            // Windows only lets the foreground process hand focus on, so pass that right along.
            if (OperatingSystem.IsWindows())
                AllowSetForegroundWindow(processId);

            await writer.WriteLineAsync(ActivateRequest.AsMemory(), deadline.Token).ConfigureAwait(false);
            return await reader.ReadLineAsync(deadline.Token).ConfigureAwait(false) == Accepted;
        }
        catch (Exception ex) when (ex is OperationCanceledException or IOException or TimeoutException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <summary>
    /// Claims the profile, or hands the launch to the instance holding it. A silent holder is
    /// usually exiting (a restart relaunches before it lets go), so the claim is retried for up
    /// to <paramref name="patience"/> before giving up.
    /// </summary>
    public static async Task<InstanceClaim> ClaimOrActivateAsync(string dataRoot, string role, TimeSpan patience, ILoggerService logger)
    {
        var waited = Stopwatch.StartNew();
        while (true)
        {
            var primary = TryClaim(dataRoot, role);
            if (primary is not null)
                return new InstanceClaim(primary, Activated: false);

            if (await TryActivateAsync(dataRoot, role, AnswerTimeout).ConfigureAwait(false))
            {
                logger.Info(LogCategory, $"Mnemo is already running on {dataRoot}; brought its window forward and exiting.");
                return new InstanceClaim(null, Activated: true);
            }

            if (waited.Elapsed >= patience)
            {
                logger.Warning(LogCategory,
                    $"Another Mnemo process holds {dataRoot} but did not answer within {patience.TotalSeconds:0.#}s; exiting instead of opening a second copy.");
                return new InstanceClaim(null, Activated: false);
            }

            await Task.Delay(RetryDelay).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Stops listening and releases the claim. Waits briefly for the listener first: on Unix a
    /// listener closing after the claim is gone would remove the next holder's socket path.
    /// </summary>
    public void Dispose()
    {
        _stop?.Cancel();
        if (_serving is { } serving)
            SpinWait.SpinUntil(() => serving.IsCompleted, DisposeWait);
        _stop?.Dispose();
        _claim.Dispose();
    }

    private async Task ServeAsync(Func<bool> onActivate, ILoggerService logger, CancellationToken stop)
    {
        var backoff = TimeSpan.Zero;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(_endpoint, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(stop).ConfigureAwait(false);

                using var exchange = CancellationTokenSource.CreateLinkedTokenSource(stop);
                exchange.CancelAfter(ExchangeTimeout);
                await AnswerAsync(pipe, onActivate, exchange.Token).ConfigureAwait(false);
                backoff = TimeSpan.Zero;
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Logged once per run of failures, since a broken endpoint fails on every pass.
                if (backoff == TimeSpan.Zero)
                    logger.Warning(LogCategory, $"A launch on this profile could not be answered: {ex.Message}");
                backoff = NextBackoff(backoff);
                try
                {
                    await Task.Delay(backoff, stop).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    private static async Task AnswerAsync(Stream pipe, Func<bool> onActivate, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(pipe, Utf8, false, 256, leaveOpen: true);
        await using var writer = new StreamWriter(pipe, Utf8, 256, leaveOpen: true) { AutoFlush = true };

        var greeting = string.Create(CultureInfo.InvariantCulture, $"{Greeting} {Environment.ProcessId}");
        await writer.WriteLineAsync(greeting.AsMemory(), cancellationToken).ConfigureAwait(false);
        if (await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false) != ActivateRequest)
            return;

        var reply = onActivate() ? Accepted : Declined;
        await writer.WriteLineAsync(reply.AsMemory(), cancellationToken).ConfigureAwait(false);

        // Held open until the launch hangs up, so the reply is read before the pipe goes away.
        await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
    }

    private static bool TryReadProcessId(string? greeting, out int processId)
    {
        processId = 0;
        var parts = greeting?.Split(' ');
        return parts is [Greeting, var id]
            && int.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out processId);
    }

    internal static TimeSpan NextBackoff(TimeSpan current) =>
        current == TimeSpan.Zero ? RetryDelay : TimeSpan.FromTicks(Math.Min(current.Ticks * 2, MaxListenBackoff.Ticks));

    /// <summary>
    /// A short name derived from the profile path; outside Windows a socket path, which is capped
    /// at around a hundred bytes.
    /// </summary>
    internal static string EndpointName(string dataRoot, string role)
    {
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dataRoot));
        if (OperatingSystem.IsWindows())
            root = root.ToUpperInvariant();

        var hash = SHA256.HashData(Utf8.GetBytes($"{role}|{root}"));
        var name = $"mnemo-{Convert.ToHexStringLower(hash, 0, 8)}";
        if (OperatingSystem.IsWindows())
            return name;

        var directory = SocketDirectory(
            OperatingSystem.IsLinux() ? Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR") : null,
            Path.GetTempPath());
        return Path.Combine(directory, name + ".sock");
    }

    /// <summary>
    /// The session's runtime directory when it has one, else the temp directory. Linux ages files
    /// out of the temp directory, which could remove the socket of a long-running instance.
    /// </summary>
    internal static string SocketDirectory(string? runtimeDirectory, string tempDirectory) =>
        !string.IsNullOrWhiteSpace(runtimeDirectory) && Path.IsPathRooted(runtimeDirectory) && Directory.Exists(runtimeDirectory)
            ? runtimeDirectory
            : tempDirectory;

    [SupportedOSPlatform("windows")]
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AllowSetForegroundWindow(int processId);
}
