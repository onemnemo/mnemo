using System;
using System.Collections.Generic;
using System.Text.Json;
using Photino.NET;

namespace Mnemo.Host.Chrome;

/// <summary>
/// Translates the SPA's <c>chrome.drag-regions</c> payload into the native layout
/// regions Photino applies to the Linux chromeless window.
/// </summary>
/// <remarks>
/// Rectangles arrive in CSS pixels measured from the top left of the WebView, which
/// is the same logical-pixel space the native API measures in. Every rectangle
/// becomes a fixed region anchored through its margin rather than an aligned or
/// stretched one: the SPA re-publishes on every layout change anyway, and one fixed
/// shape keeps the wire format and the native call trivially comparable.
///
/// A malformed payload is refused as a whole, so the window keeps the last set that
/// made sense rather than half of a new one.
/// </remarks>
internal static class DragRegionPayload
{
    /// <summary>
    /// Far above what a titlebar produces. A bound, not a budget: the native side
    /// walks every region on every pointer move.
    /// </summary>
    private const int MaxRegionsPerList = 128;

    public static bool TryParse(
        JsonElement payload,
        out IReadOnlyList<LayoutRegion> drag,
        out IReadOnlyList<LayoutRegion> noDrag)
    {
        drag = [];
        noDrag = [];

        if (payload.ValueKind != JsonValueKind.Object
            || !TryReadList(payload, "drag", out var dragList)
            || !TryReadList(payload, "noDrag", out var noDragList))
        {
            return false;
        }

        drag = dragList;
        noDrag = noDragList;
        return true;
    }

    private static bool TryReadList(JsonElement payload, string name, out List<LayoutRegion> regions)
    {
        regions = [];

        if (!payload.TryGetProperty(name, out var array) || array.ValueKind != JsonValueKind.Array)
            return false;

        foreach (var element in array.EnumerateArray())
        {
            if (!TryReadRegion(element, out var region))
                return false;

            if (region is { } value && regions.Count < MaxRegionsPerList)
                regions.Add(value);
        }

        return true;
    }

    private static bool TryReadRegion(JsonElement element, out LayoutRegion? region)
    {
        region = null;

        if (element.ValueKind != JsonValueKind.Object
            || !TryReadInt(element, "x", out var x)
            || !TryReadInt(element, "y", out var y)
            || !TryReadInt(element, "w", out var width)
            || !TryReadInt(element, "h", out var height)
            || width < 0
            || height < 0)
        {
            return false;
        }

        // A collapsed element is simply absent. It must not become a zero-size hole.
        if (width == 0 || height == 0)
            return true;

        // The SPA clamps to its viewport, so a negative origin is only ever a
        // fractional-pixel artefact of that clamp. Snapping it to the edge beats
        // refusing an otherwise sound payload over half a pixel.
        region = new LayoutRegion(
            width,
            height,
            new Thickness(Math.Max(0, x), Math.Max(0, y), 0, 0),
            HorizontalAlignment.Left,
            VerticalAlignment.Top);
        return true;
    }

    private static bool TryReadInt(JsonElement element, string name, out int value)
    {
        value = 0;
        return element.TryGetProperty(name, out var property)
            && property.ValueKind == JsonValueKind.Number
            && property.TryGetInt32(out value);
    }
}
