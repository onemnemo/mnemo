namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Holds the window open for one short moment so the SPA can write what it has
/// not written yet.
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
/// close exactly once, the SPA is told over the event stream, and it answers
/// through <see cref="SignalReady"/> when it has finished saving. Only then is
/// the window closed for real, and by that point the commits have already been
/// served by a Kestrel that was still running.
/// </para>
/// <para>
/// Two properties matter more than promptness. The drain happens <em>once</em>:
/// a client that never answers costs a bounded delay rather than a window that
/// will not close, and a second press of the close button is always honoured
/// immediately. And <see cref="WaitForReadyAsync"/> is asynchronous by
/// construction, because the closing handler runs on the UI thread - blocking it
/// would stop the message loop the WebView needs to run the very save being
/// waited for.
/// </para>
/// </remarks>
public sealed class ShutdownGate
{
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _draining;

    /// <summary>
    /// Claims the one drain. Returns <c>true</c> for the first caller only;
    /// every later close request should be allowed straight through.
    /// </summary>
    public bool TryBeginDrain() => Interlocked.Exchange(ref _draining, 1) == 0;

    /// <summary>Reports that every client has saved. Extra calls are ignored.</summary>
    public void SignalReady() => _ready.TrySetResult();

    /// <summary>
    /// Waits for <see cref="SignalReady"/>, giving up after <paramref name="grace"/>.
    /// Returns whether the clients answered in time; either way the caller closes.
    /// </summary>
    public async Task<bool> WaitForReadyAsync(TimeSpan grace, CancellationToken cancellationToken = default)
    {
        using var timeout = new CancellationTokenSource(grace);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token, cancellationToken);
        try
        {
            await _ready.Task.WaitAsync(linked.Token).ConfigureAwait(false);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
