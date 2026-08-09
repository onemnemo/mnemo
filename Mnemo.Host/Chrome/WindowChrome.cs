using System;
using System.Text.Json;
using Photino.NET;

namespace Mnemo.Host.Chrome;

/// <summary>
/// The native half of the chromeless titlebar: the SPA draws the bar, this moves,
/// resizes and closes the actual window on its behalf.
/// </summary>
/// <remarks>
/// Two mechanisms, because one does not exist everywhere.
///
/// On Windows and macOS the SPA calls in from a pointer-down handler and the OS
/// takes over the gesture. On Linux those entry points are no-ops: GTK and Wayland
/// only start a move or resize from the trusted native button event, which a
/// message arriving over the WebView bridge is not. There the drag area has to be
/// declared up front as a rectangle, so the SPA reports where its handle is
/// (<c>chrome.drag-region</c>) and this applies it.
///
/// A rectangle cannot express "everything except these buttons", so the SPA points
/// the Linux region at an area it keeps free of controls rather than at the whole
/// titlebar.
/// </remarks>
internal static class WindowChrome
{
    /// <summary>Matches the SPA's --topbar-h; the fallback until the SPA reports its own.</summary>
    private const int DefaultDragRegionHeight = 48;

    private const int LinuxResizeBorder = 6;

    public static void Configure(PhotinoWindow window)
    {
        window.SetChromeless(true);

        if (OperatingSystem.IsWindows())
        {
            // Turns on WebView2's own draggable regions, so `app-region: drag` in the
            // SPA becomes a real caption hit-test inside the browser process.
            //
            // This is the difference between a window that moves and a window that
            // behaves. The message path below can only ask the OS to start a drag
            // after a round trip, so it misses the press position, and Windows never
            // sees a caption drag at all: no Snap, no drag-to-edge tiling, no
            // shake-to-minimize. A hit-test region gets all of that for free because
            // the OS is running the drag, not us.
            //
            // Harmless on a runtime too old to know the flag. The bridge stays as the
            // fallback, and on a runtime that does honour this it never fires, because
            // a drag region swallows the pointer before the page sees it.
            window.SetBrowserControlInitParameters("--enable-features=msWebView2EnableDraggableRegions");
        }

        if (OperatingSystem.IsLinux())
        {
            window.SetLinuxChromelessResizeBorderThickness(LinuxResizeBorder);
            // Provisional, so the window is movable during the first paint. The SPA
            // narrows it to its real handle as soon as the shell mounts.
            window.SetLinuxChromelessDragRegion(DefaultDragRegionHeight, 0, 0);
        }

        window.RegisterWebMessageReceivedHandler(OnWebMessage);

        // Snap, keyboard shortcuts and the window menu all change the state without
        // going through our buttons, so the glyph follows the window rather than the
        // last thing that was clicked.
        window.RegisterStateChangedHandler((sender, e) =>
            PublishState(sender, e.NewState == PhotinoWindowState.Maximized));
    }

    private static void OnWebMessage(object? sender, WebMessageReceivedEventArgs e)
    {
        if (sender is not PhotinoWindow window)
            return;

        // Every other feature shares this channel, so anything that is not ours is
        // someone else's message rather than an error.
        if (!TryReadType(e.Message, out var type, out var payload) || !type.StartsWith("chrome.", StringComparison.Ordinal))
            return;

        switch (type)
        {
            case "chrome.ready":
                PublishState(window, IsMaximized(window));
                break;

            case "chrome.drag":
                window.BeginWindowDrag();
                break;

            case "chrome.resize":
                if (TryReadEdge(payload, out var edge))
                    window.BeginWindowResize(edge);
                break;

            case "chrome.minimize":
                window.SetMinimized(true);
                break;

            case "chrome.toggle-maximize":
                if (IsMaximized(window))
                    window.Restore();
                else
                    window.Maximize();
                break;

            case "chrome.close":
                // Through Close, not straight to exit: the shutdown gate is on the
                // closing handler, and the button must give the SPA the same chance
                // to save that the OS close would.
                window.Close();
                break;

            case "chrome.drag-region":
                ApplyDragRegion(window, payload);
                break;
        }
    }

    private static void ApplyDragRegion(PhotinoWindow window, JsonElement payload)
    {
        if (!OperatingSystem.IsLinux())
            return;

        var height = ReadInt(payload, "height", DefaultDragRegionHeight);
        var left = ReadInt(payload, "left", 0);
        var right = ReadInt(payload, "right", 0);

        // Right before left: the argument order is the reverse of the name order.
        window.SetLinuxChromelessDragRegion(height, right, left);
    }

    private static bool IsMaximized(PhotinoWindow window) =>
        window.WindowState == PhotinoWindowState.Maximized;

    private static void PublishState(object? sender, bool maximized)
    {
        if (sender is PhotinoWindow window)
            window.SendWebMessage($"{{\"type\":\"chrome.state\",\"maximized\":{(maximized ? "true" : "false")}}}");
    }

    private static bool TryReadType(string? message, out string type, out JsonElement payload)
    {
        type = string.Empty;
        payload = default;

        if (string.IsNullOrEmpty(message) || message[0] != '{')
            return false;

        try
        {
            using var document = JsonDocument.Parse(message);
            if (!document.RootElement.TryGetProperty("type", out var typeElement) || typeElement.ValueKind != JsonValueKind.String)
                return false;

            type = typeElement.GetString() ?? string.Empty;
            // Clone: the document is disposed on the way out of this method, and the
            // payload outlives it.
            payload = document.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool TryReadEdge(JsonElement payload, out PhotinoWindowEdge edge)
    {
        edge = default;
        if (payload.ValueKind != JsonValueKind.Object
            || !payload.TryGetProperty("edge", out var element)
            || element.ValueKind != JsonValueKind.String)
            return false;

        edge = element.GetString() switch
        {
            "top" => PhotinoWindowEdge.Top,
            "bottom" => PhotinoWindowEdge.Bottom,
            "left" => PhotinoWindowEdge.Left,
            "right" => PhotinoWindowEdge.Right,
            "top-left" => PhotinoWindowEdge.TopLeft,
            "top-right" => PhotinoWindowEdge.TopRight,
            "bottom-left" => PhotinoWindowEdge.BottomLeft,
            "bottom-right" => PhotinoWindowEdge.BottomRight,
            _ => (PhotinoWindowEdge)(-1),
        };

        return edge != (PhotinoWindowEdge)(-1);
    }

    private static int ReadInt(JsonElement payload, string name, int fallback) =>
        payload.ValueKind == JsonValueKind.Object
        && payload.TryGetProperty(name, out var element)
        && element.ValueKind == JsonValueKind.Number
        && element.TryGetInt32(out var value)
            ? Math.Max(0, value)
            : fallback;
}
