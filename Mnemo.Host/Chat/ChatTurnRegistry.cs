using System.Collections.Concurrent;

namespace Mnemo.Host.Chat;

/// <summary>
/// Tracks in-flight assistant turns so the stop button can cancel one by id. The
/// client mints the turn id and sends it with the turn request, then hits the cancel
/// endpoint with the same id, so a turn can be stopped the instant it starts without
/// waiting for a server-assigned handle.
/// </summary>
public sealed class ChatTurnRegistry
{
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _turns = new(StringComparer.Ordinal);

    /// <summary>Registers a turn and returns its cancellation source; the caller disposes it via <see cref="Complete"/>.</summary>
    public CancellationTokenSource Register(string turnId)
    {
        var cts = new CancellationTokenSource();
        // A duplicate id (client bug or retry) supersedes the old registration; cancel the stale one.
        if (_turns.TryGetValue(turnId, out var existing))
        {
            existing.Cancel();
            existing.Dispose();
        }
        _turns[turnId] = cts;
        return cts;
    }

    /// <summary>Cancels a running turn. Returns false when the id is unknown (already finished or never started).</summary>
    public bool Cancel(string turnId)
    {
        if (_turns.TryGetValue(turnId, out var cts))
        {
            cts.Cancel();
            return true;
        }
        return false;
    }

    /// <summary>Removes and disposes a finished turn's registration.</summary>
    public void Complete(string turnId)
    {
        if (_turns.TryRemove(turnId, out var cts))
            cts.Dispose();
    }
}
