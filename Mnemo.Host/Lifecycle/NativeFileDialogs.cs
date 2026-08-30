using System;
using System.IO;
using System.Threading.Tasks;
using Photino.NET;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Opens the operating system's save chooser on the SPA's behalf.
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
public sealed class NativeFileDialogs
{
    private PhotinoWindow? _window;

    /// <summary>True once a real window has attached and a dialog can actually be raised.</summary>
    public bool IsAvailable => _window is not null;

    public void Attach(PhotinoWindow window) => _window = window;

    /// <summary>
    /// Shows the save chooser and returns the file path the user settled on, or null if it was
    /// dismissed or there is no window to raise it on.
    /// </summary>
    /// <remarks>
    /// The path comes back exactly as typed, so it can be missing the extension the caller asked
    /// for. <see cref="ExportTarget.TryResolvePath"/> is what puts that right; nothing here does.
    /// </remarks>
    /// <param name="title">Dialog title, localized by the caller.</param>
    /// <param name="startDirectory">Where to open. Ignored unless it is an existing directory.</param>
    /// <param name="fileName">The name the field is pre-filled with.</param>
    public Task<string?> PickSaveFileAsync(string title, string? startDirectory, string fileName)
    {
        // The filter row is named after the extension rather than the format, so the one string
        // this dialog shows that the SPA did not supply needs no translation.
        var suffix = Path.GetExtension(fileName).TrimStart('.');
        var filters = suffix.Length == 0
            ? Array.Empty<(string, string[])>()
            : new[] { ($"*.{suffix}", new[] { suffix }) };

        return OnWindowThreadAsync(window =>
            window.ShowSaveFile(title, StartDirectory(startDirectory), filters, fileName));
    }

    private static string StartDirectory(string? requested) =>
        !string.IsNullOrWhiteSpace(requested) && Directory.Exists(requested)
            ? requested!
            : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);

    /// <remarks>
    /// Invoke marshals onto the window thread; the completion source carries the answer back to the
    /// request that is awaiting it. RunContinuationsAsynchronously so the awaiting request never
    /// resumes on the window thread and stalls the message loop behind it.
    /// </remarks>
    private Task<string?> OnWindowThreadAsync(Func<PhotinoWindow, string?> show)
    {
        var window = _window;
        if (window is null)
            return Task.FromResult<string?>(null);

        var completion = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        window.Invoke(() =>
        {
            try
            {
                completion.SetResult(show(window));
            }
            catch (Exception ex)
            {
                completion.SetException(ex);
            }
        });

        return completion.Task;
    }
}
