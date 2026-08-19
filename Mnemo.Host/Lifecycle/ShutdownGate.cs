namespace Mnemo.Host.Lifecycle;

/// <summary>What the SPA said when it was asked to let the window go.</summary>
public enum ShutdownVerdict
{
    /// <summary>Everything is saved. Close.</summary>
    Ready,

    /// <summary>The user declined. The window stays open and the gate is reusable.</summary>
    Cancelled,

    /// <summary>Nobody answered in time. Close anyway.</summary>
    TimedOut,
}

/// <summary>
/// Holds the window open while the SPA writes what it has not written yet, and
/// while it asks the user whether to leave at all.
/// </summary>
/// <remarks>
/// <para>
/// Closing the window is the one exit that gives the frontend no warning: React
/// unmounts nothing, so a note's autosave debounce simply never fires and the
/// last few seconds of typing are gone. A <c>beforeunload</c> handler cannot fix
/// that from the web side - it cannot await a request - and neither can a
/// keepalive one, because the API it would post to is <em>this</em> process,
/// which is on its way down.
/// </para>
/// <para>
/// So the wait happens here instead. The window's closing handler cancels the
/// close, the SPA is told over the event stream, and it answers through
/// <see cref="SignalReady"/> or <see cref="SignalCancelled"/>. Only on a ready
/// verdict is the window closed for real, and by that point the commits have
/// already been served by a Kestrel that was still running.
/// </para>
/// <para>
/// The grace period is the subtlety. It was sized for one small commit against a
/// local file, not for a person reading a dialog nor for a document large enough
/// to be slow to serialize, and it starts before the SPA has serialized anything.
/// So a client with either to do says so through <see cref="SignalHolding"/> and
/// the deadline stops applying. That trades a bounded delay for an unbounded one,
/// which is safe only because the drain is claimed once: a second press of the
/// close button finds <see cref="TryBeginDrain"/> already claimed and goes
/// straight through. There is always a way out of a wait that never resolves.
/// </para>
/// <para>
/// <see cref="WaitForVerdictAsync"/> is asynchronous by construction, because the
/// closing handler runs on the UI thread - blocking it would stop the message
/// loop the WebView needs to run the very save being waited for.
/// </para>
/// </remarks>
public sealed class ShutdownGate
{
    private readonly Lock _sync = new();

    // Reassigned by Reset, so every read happens under the lock rather than
    // through the field a wait started with.
    private TaskCompletionSource<bool> _verdict = NewVerdict();
    private TaskCompletionSource _holding = NewHolding();
    private bool _draining;

    private static TaskCompletionSource<bool> NewVerdict() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static TaskCompletionSource NewHolding() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>
    /// Claims the one drain. Returns <c>true</c> for the first caller only;
    /// every later close request should be allowed straight through.
    /// </summary>
    public bool TryBeginDrain()
    {
        lock (_sync)
        {
            if (_draining)
                return false;

            _draining = true;
            return true;
        }
    }

    /// <summary>
    /// Reports that there is a person to ask or work to write, so the grace period
    /// should stop counting. Ignored once a verdict has been given.
    /// </summary>
    public void SignalHolding()
    {
        lock (_sync)
        {
            _holding.TrySetResult();
        }
    }

    /// <summary>Reports that every client has saved. Extra calls are ignored.</summary>
    public void SignalReady()
    {
        lock (_sync)
        {
            _verdict.TrySetResult(true);
        }
    }

    /// <summary>Reports that the user declined to close. Extra calls are ignored.</summary>
    public void SignalCancelled()
    {
        lock (_sync)
        {
            _verdict.TrySetResult(false);
        }
    }

    /// <summary>
    /// Arms the gate for another close request, after a cancelled one.
    /// </summary>
    /// <remarks>
    /// Not optional. The window is still open, so without this the next close
    /// finds the drain already claimed and skips it entirely - closing with no
    /// save and no prompt, which is the exact failure this class exists to
    /// prevent.
    /// </remarks>
    public void Reset()
    {
        lock (_sync)
        {
            _draining = false;
            _verdict = NewVerdict();
            _holding = NewHolding();
        }
    }

    /// <summary>
    /// Waits for the SPA's answer, giving up after <paramref name="grace"/> unless
    /// <see cref="SignalHolding"/> has stopped the clock first.
    /// </summary>
    public async Task<ShutdownVerdict> WaitForVerdictAsync(TimeSpan grace, CancellationToken cancellationToken = default)
    {
        Task<bool> verdict;
        Task holding;
        lock (_sync)
        {
            verdict = _verdict.Task;
            holding = _holding.Task;
        }

        // Linked so the delay's timer is disposed on the way out rather than left
        // to fire into nothing on every close for the life of the process.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var expiry = Task.Delay(grace, deadline.Token);
        try
        {
            var first = await Task.WhenAny(verdict, holding, expiry).ConfigureAwait(false);
            if (first == expiry)
                return ShutdownVerdict.TimedOut;

            // A hold is not an answer, only a reason to stop timing one.
            return await verdict.ConfigureAwait(false) ? ShutdownVerdict.Ready : ShutdownVerdict.Cancelled;
        }
        finally
        {
            deadline.Cancel();
        }
    }
}
