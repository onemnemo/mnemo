using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Media.TextFormatting;

namespace Mnemo.UI.Components.BlockEditor;

/// <summary>
/// Pure hit-testing helpers for <see cref="RichTextEditor"/>.
/// All methods accept layout objects as parameters; no reference to the control instance.
/// </summary>
internal static class RichTextHitTester
{
    /// <summary>
    /// Finds the visual line index and its accumulated top Y for a given Y coordinate.
    /// Returns (0, 0) for empty line lists or Y ≤ 0.
    /// </summary>
    internal static (int LineIndex, double LineTop) GetLineIndexAtY(IReadOnlyList<TextLine> lines, double y)
    {
        if (lines.Count == 0) return (0, 0);
        if (y <= 0) return (0, 0);

        double top = 0;
        for (int i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            var bottom = top + line.Height;
            if (y <= bottom) return (i, top);
            top = bottom;
        }
        return (lines.Count - 1, Math.Max(0, top - lines[^1].Height));
    }

    /// <summary>Accumulated Y-offset of a line at <paramref name="lineIndex"/> within <paramref name="layout"/>.</summary>
    internal static double GetAccumulatedLineTop(TextLayout layout, int lineIndex)
    {
        double y = 0;
        for (var i = 0; i < lineIndex; i++)
            y += layout.TextLines[i].Height;
        return y;
    }

    /// <summary>Character count on the line excluding the mandatory trailing newline, if any.</summary>
    internal static int LineContentCharCount(TextLine line) =>
        Math.Max(0, line.Length - line.NewLineLength);

    /// <summary>
    /// Clamp-to-same-column fallback when a hit-test returns a result on the wrong visual line.
    /// </summary>
    internal static int FallbackCaretSameColumn(TextLine line, int columnFromLineStart)
    {
        var start = line.FirstTextSourceIndex;
        var content = LineContentCharCount(line);
        var off = Math.Clamp(columnFromLineStart, 0, content);
        return start + off;
    }

    /// <summary>
    /// If the pointer is clearly to the left/right of a visual line, clamp to the line's start/end caret
    /// and return <c>true</c>.  Returns <c>false</c> when the point is within the line's extent.
    /// </summary>
    internal static bool TryClampHitToLineEdge(
        TextLayout layout,
        int[] boundaryMap,
        int layoutTextLength,
        int logicalTextLength,
        Point local,
        out int logicalCaret)
    {
        logicalCaret = 0;
        var lines = layout.TextLines;
        if (lines.Count == 0) return false;

        var (lineIndex, _) = GetLineIndexAtY(lines, local.Y);
        var line = lines[Math.Clamp(lineIndex, 0, lines.Count - 1)];

        int lineStart = line.FirstTextSourceIndex;
        int lineEnd = lineStart + LineContentCharCount(line);
        var (_, lineMaxX) = GetLineHorizontalHitBounds(layout, line, lineStart, layoutTextLength);

        const double edgeSlop = 1.0;
        if (local.X >= -edgeSlop && local.X <= lineMaxX + edgeSlop)
            return false;

        int lb = local.X < 0 ? lineStart : lineEnd;
        lb = Math.Clamp(lb, 0, layoutTextLength);
        logicalCaret = Math.Clamp(RichTextLayoutBuilder.LayoutBoundaryIndexToLogicalCaret(boundaryMap, lb), 0, logicalTextLength);
        return true;
    }

    /// <summary>
    /// Fallback for when <see cref="TextLayout.HitTestPoint"/> throws for out-of-bounds points.
    /// Maps to the nearest caret edge on the nearest visual line.
    /// </summary>
    internal static int HitTestPointFallback(
        TextLayout layout,
        int[] boundaryMap,
        int layoutTextLength,
        int logicalTextLength,
        Point local)
    {
        var lines = layout.TextLines;
        if (lines.Count == 0)
            return Math.Clamp(local.X <= 0 ? 0 : logicalTextLength, 0, logicalTextLength);

        var (lineIndex, _) = GetLineIndexAtY(lines, local.Y);
        var targetLine = lines[lineIndex];
        int lineStart = targetLine.FirstTextSourceIndex;
        int lineEnd = lineStart + LineContentCharCount(targetLine);
        int lb = local.X <= 0 ? lineStart : lineEnd;
        lb = Math.Clamp(lb, 0, layoutTextLength);
        return Math.Clamp(RichTextLayoutBuilder.LayoutBoundaryIndexToLogicalCaret(boundaryMap, lb), 0, logicalTextLength);
    }

    private static (double MinX, double MaxX) GetLineHorizontalHitBounds(TextLayout layout, TextLine line, int lineStart, int layoutTextLength)
    {
        var minX = 0.0;
        var maxX = line.WidthIncludingTrailingWhitespace;
        if (double.IsNaN(maxX) || double.IsInfinity(maxX) || maxX <= 0)
            maxX = Math.Max(line.Width, 0);

        try
        {
            var startRect = layout.HitTestTextPosition(Math.Clamp(lineStart, 0, layoutTextLength));
            minX = startRect.X;
            maxX = minX + Math.Max(maxX, 0);
        }
        catch { }

        return (minX, maxX);
    }
}
