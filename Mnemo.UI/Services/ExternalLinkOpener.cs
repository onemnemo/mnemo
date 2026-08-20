using System;
using System.Diagnostics;
using Avalonia.Controls;

namespace Mnemo.UI.Services;

/// <summary>
/// Opens an external URL in the system browser or mail client. A small shared helper so callers outside the
/// block editor need not reach into it: http/https/mailto only, preferring the TopLevel launcher and falling
/// back to a shell process start. Opening a link must never crash the app, so every failure is swallowed.
/// </summary>
public static class ExternalLinkOpener
{
    public static void Open(string url, Control? anchor = null)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return;
        if (uri.Scheme is not ("http" or "https" or "mailto"))
            return;

        try
        {
            var top = anchor is not null ? TopLevel.GetTopLevel(anchor) : null;
            if (top?.Launcher is not null)
            {
                _ = top.Launcher.LaunchUriAsync(uri);
                return;
            }
        }
        catch
        {
            // Launcher unavailable or threw; fall through to the shell.
        }

        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch
        {
            // Nothing more we can do; a missing browser shouldn't take the app down.
        }
    }
}
