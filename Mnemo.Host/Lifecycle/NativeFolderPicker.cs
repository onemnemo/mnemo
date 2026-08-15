using System;
using System.IO;
using System.Threading.Tasks;
using Photino.NET;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Opens the operating system's folder chooser on the SPA's behalf.
/// </summary>
/// <remarks>
/// The window and the server are two halves of one process that never share a thread: Kestrel
/// answers on the thread pool, and a native dialog has to be raised on the window's own thread
/// or it never appears. So this is a singleton the request path can reach and the window fills
/// in once it exists, the same shape as <see cref="ShutdownGate"/>.
///
/// It stays empty when there is no window: the dev server opened in a browser tab, and the
/// headless host the tests run against. Callers check <see cref="IsAvailable"/> and offer the
/// browser's own download instead of a path nobody can choose.
/// </remarks>
public sealed class NativeFolderPicker
{
    private PhotinoWindow? _window;

    /// <summary>True once a real window has attached and a dialog can actually be raised.</summary>
    public bool IsAvailable => _window is not null;

    public void Attach(PhotinoWindow window) => _window = window;

    /// <summary>
    /// Shows the chooser and returns the selected directory, or null if it was dismissed.
    /// </summary>
    /// <param name="title">Dialog title, localized by the caller.</param>
    /// <param name="startPath">Where to open. Ignored unless it is an existing directory.</param>
    public Task<string?> PickAsync(string title, string? startPath)
    {
        var window = _window;
        if (window is null)
            return Task.FromResult<string?>(null);

        var start = !string.IsNullOrWhiteSpace(startPath) && Directory.Exists(startPath)
            ? startPath!
            : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);

        // Invoke marshals onto the window thread; the completion source carries the answer back
        // to the request that is awaiting it. RunContinuationsAsynchronously so the awaiting
        // request never resumes on the window thread and stalls the message loop behind it.
        var completion = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        window.Invoke(() =>
        {
            try
            {
                var chosen = window.ShowOpenFolder(title, start, multiSelect: false);
                completion.SetResult(chosen is { Length: > 0 } ? chosen[0] : null);
            }
            catch (Exception ex)
            {
                completion.SetException(ex);
            }
        });

        return completion.Task;
    }
}
