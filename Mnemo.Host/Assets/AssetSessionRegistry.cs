namespace Mnemo.Host.Assets;

/// <summary>
/// Tracks the editing sessions that could still resurrect an asset through undo.
/// </summary>
/// <remarks>
/// A deleted image block leaves the document but stays in the editor's undo history, so its
/// file must survive until that history is gone. The history lives in the browser and dies
/// when the editor unmounts; the client registers a session on mount and closes it after its
/// final save settles. The sweeper refuses to delete anything while a session is open, which
/// is what makes "collect on navigate away, and at startup after a crash" safe.
///
/// The registry is in-memory on purpose: sessions cannot outlive the host process, and a
/// webview that dies without closing (crash, dev reload) leaks a token that only defers
/// sweeping until the next launch, never deletes too much.
/// </remarks>
public sealed class AssetSessionRegistry
{
    private readonly object _gate = new();
    private readonly HashSet<string> _open = new(StringComparer.Ordinal);

    public int ActiveCount
    {
        get
        {
            lock (_gate)
                return _open.Count;
        }
    }

    /// <summary>Registers an open editing session and returns the token that closes it.</summary>
    public string Open()
    {
        var sessionId = Guid.NewGuid().ToString("N");
        lock (_gate)
            _open.Add(sessionId);
        return sessionId;
    }

    /// <summary>True when the token named an open session; false for unknown or already-closed tokens.</summary>
    public bool Close(string sessionId)
    {
        lock (_gate)
            return _open.Remove(sessionId);
    }
}
