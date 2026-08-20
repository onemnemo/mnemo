using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using Avalonia;
using Mnemo.Core.Models.Mindmap;
using Mnemo.UI.Modules.Mindmap.ViewModels;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>
/// A theme-resolved snapshot of a mindmap ready to serialize to SVG. Colors are already hex (resolved
/// against the active theme by the canvas), so the emitter has no Avalonia visual dependency beyond the
/// geometry types it carries, which keeps it pure and unit-testable.
/// </summary>
public sealed record MindmapSvgScene
{
    /// <summary>Content extent (union of all elements) plus a margin; also the SVG viewBox.</summary>
    public Rect Bounds { get; init; }

    public string BackgroundColor { get; init; } = "#FFFFFF";

    // Theme colors used by chrome (task checks, chips, missing-state labels), resolved once for the map.
    public string AccentColor { get; init; } = "#C64F33";
    public string OnAccentColor { get; init; } = "#FFFFFF";
    public string MutedColor { get; init; } = "#808080";
    public string SurfaceColor { get; init; } = "#FFFFFF";
    public string DefaultEdgeColor { get; init; } = "#808080";

    public string MissingImageLabel { get; init; } = string.Empty;
    public string MissingRefLabel { get; init; } = string.Empty;

    // Edges are listed before nodes, matching the canvas draw order (edges sit beneath nodes).
    public IReadOnlyList<MindmapSvgEdge> Edges { get; init; } = Array.Empty<MindmapSvgEdge>();
    public IReadOnlyList<MindmapSvgNode> Nodes { get; init; } = Array.Empty<MindmapSvgNode>();
}

/// <summary>A single element snapshot for the SVG emitter. Colors are hex; a null fill means "no fill".</summary>
public sealed record MindmapSvgNode
{
    public ElementKind Kind { get; init; } = ElementKind.Node;
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public string ContentType { get; init; } = ElementContentDiscriminators.Text;
    public NodeShape Shape { get; init; } = NodeShape.Card;
    public ShapeType? FreeShape { get; init; }
    public FontScale FontScale { get; init; } = FontScale.M;
    public bool IsRoot { get; init; }
    public string Text { get; init; } = string.Empty;
    public string? FillColor { get; init; }
    public string? StrokeColor { get; init; }
    public string? TextColor { get; init; }
    public bool IsTaskDone { get; init; }
    public string? CodeLanguage { get; init; }
    public bool IsRefMissing { get; init; }
    public string? RefBadge { get; init; }
    public string? AssetPath { get; init; }
}

/// <summary>A single edge snapshot. Hierarchy edges carry the four cubic control points; links carry the
/// routed polyline vertices (a curve is pre-sampled).</summary>
public sealed record MindmapSvgEdge
{
    public bool IsHierarchy { get; init; }
    public IReadOnlyList<Point> Points { get; init; } = Array.Empty<Point>();
    public string? Color { get; init; }
    public double Thickness { get; init; } = 1.5;
    public LineStyle LineStyle { get; init; } = LineStyle.Solid;
    public ArrowCap StartCap { get; init; } = ArrowCap.None;
    public ArrowCap EndCap { get; init; } = ArrowCap.None;
    public Point StartDirection { get; init; }
    public Point EndDirection { get; init; }
    public Point Midpoint { get; init; }
    public string? Label { get; init; }
}

/// <summary>
/// Serializes a <see cref="MindmapSvgScene"/> to a standalone SVG string. Pure and deterministic: geometry
/// mirrors the canvas draw path, sizes come from the same <c>FontSizeFor</c> the canvas uses, and selection
/// state is never emitted (a flat export is clean). Math nodes fall back to italic raw LaTeX text: the one
/// fidelity gap versus the on-screen render.
/// </summary>
public static class MindmapSvgExporter
{
    private const double CornerRadius = 10;
    private const double TextPadding = 12;
    private const string SansFont = "Geist, sans-serif";
    private const string MonoFont = "'Geist Mono', monospace";

    public static string Emit(MindmapSvgScene scene)
    {
        var b = scene.Bounds;
        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.Append("<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" ");
        sb.Append($"width=\"{N(b.Width)}\" height=\"{N(b.Height)}\" ");
        sb.Append($"viewBox=\"{N(b.X)} {N(b.Y)} {N(b.Width)} {N(b.Height)}\">\n");
        sb.Append($"<rect x=\"{N(b.X)}\" y=\"{N(b.Y)}\" width=\"{N(b.Width)}\" height=\"{N(b.Height)}\" fill=\"{scene.BackgroundColor}\"/>\n");

        foreach (var edge in scene.Edges)
            EmitEdge(sb, scene, edge);
        foreach (var node in scene.Nodes)
            EmitNode(sb, scene, node);

        sb.Append("</svg>\n");
        return sb.ToString();
    }

    // --- Edges -------------------------------------------------------------

    private static void EmitEdge(StringBuilder sb, MindmapSvgScene scene, MindmapSvgEdge edge)
    {
        var points = edge.Points;
        if (points.Count == 0)
            return;

        var color = edge.Color ?? scene.DefaultEdgeColor;
        var thickness = N(edge.Thickness);

        if (edge.IsHierarchy)
        {
            if (points.Count < 4)
                return;
            sb.Append($"<path d=\"M {N(points[0].X)} {N(points[0].Y)} C {N(points[1].X)} {N(points[1].Y)} {N(points[2].X)} {N(points[2].Y)} {N(points[3].X)} {N(points[3].Y)}\" ");
            sb.Append($"fill=\"none\" stroke=\"{color}\" stroke-width=\"{thickness}\" stroke-linecap=\"round\"/>\n");
            return;
        }

        if (edge.LineStyle == LineStyle.Double)
        {
            // Two strokes straddling the centerline; the caps below still sit on the true path.
            var gap = edge.Thickness / 2 + 0.9;
            EmitStrokedPath(sb, OffsetPolyline(points, gap), color, thickness, null);
            EmitStrokedPath(sb, OffsetPolyline(points, -gap), color, thickness, null);
        }
        else
        {
            EmitStrokedPath(sb, points, color, thickness, DashArray(edge.LineStyle, edge.Thickness));
        }

        if (edge.EndCap != ArrowCap.None)
            EmitCap(sb, points[^1], edge.EndDirection, edge.EndCap, color, edge.Thickness);
        if (edge.StartCap != ArrowCap.None)
            EmitCap(sb, points[0], edge.StartDirection, edge.StartCap, color, edge.Thickness);

        if (!string.IsNullOrEmpty(edge.Label))
            EmitEdgeLabel(sb, scene, edge, color);
    }

    private static void EmitStrokedPath(StringBuilder sb, IReadOnlyList<Point> points, string color, string thickness, string? dashArray)
    {
        if (points.Count < 2)
            return;
        sb.Append("<path d=\"M ").Append(N(points[0].X)).Append(' ').Append(N(points[0].Y));
        for (var i = 1; i < points.Count; i++)
            sb.Append(" L ").Append(N(points[i].X)).Append(' ').Append(N(points[i].Y));
        sb.Append($"\" fill=\"none\" stroke=\"{color}\" stroke-width=\"{thickness}\" stroke-linecap=\"round\" stroke-linejoin=\"round\"");
        if (dashArray is not null)
            sb.Append($" stroke-dasharray=\"{dashArray}\"");
        sb.Append("/>\n");
    }

    // Canvas dashes are relative to pen thickness; SVG dashes are absolute, so scale by thickness to match.
    private static string? DashArray(LineStyle style, double thickness) => style switch
    {
        LineStyle.Dashed => $"{N(4 * thickness)} {N(3 * thickness)}",
        LineStyle.Dotted => $"{N(1 * thickness)} {N(2 * thickness)}",
        _ => null,
    };

    private static void EmitCap(StringBuilder sb, Point tip, Point dir, ArrowCap cap, string color, double thickness)
    {
        if (cap == ArrowCap.Dot)
        {
            sb.Append($"<circle cx=\"{N(tip.X)}\" cy=\"{N(tip.Y)}\" r=\"3.5\" fill=\"{color}\"/>\n");
            return;
        }

        const double length = 9;
        const double spread = 0.45; // radians off the shaft
        var bx = -dir.X;
        var by = -dir.Y;
        var cos = Math.Cos(spread);
        var sin = Math.Sin(spread);
        var wing1 = new Point(tip.X + (bx * cos - by * sin) * length, tip.Y + (bx * sin + by * cos) * length);
        var wing2 = new Point(tip.X + (bx * cos + by * sin) * length, tip.Y + (-bx * sin + by * cos) * length);
        sb.Append($"<path d=\"M {N(wing1.X)} {N(wing1.Y)} L {N(tip.X)} {N(tip.Y)} L {N(wing2.X)} {N(wing2.Y)}\" ");
        sb.Append($"fill=\"none\" stroke=\"{color}\" stroke-width=\"{N(thickness)}\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n");
    }

    private static void EmitEdgeLabel(StringBuilder sb, MindmapSvgScene scene, MindmapSvgEdge edge, string color)
    {
        const double fontSize = 11;
        var label = edge.Label!;
        // No text metrics in a pure emitter; approximate the chip from character count so it still masks the line.
        var width = label.Length * fontSize * 0.6 + 6;
        var height = fontSize + 6;
        var mx = edge.Midpoint.X;
        var my = edge.Midpoint.Y;
        sb.Append($"<rect x=\"{N(mx - width / 2)}\" y=\"{N(my - height / 2)}\" width=\"{N(width)}\" height=\"{N(height)}\" rx=\"3\" fill=\"{scene.SurfaceColor}\"/>\n");
        sb.Append($"<text x=\"{N(mx)}\" y=\"{N(my)}\" font-family=\"{SansFont}\" font-size=\"{N(fontSize)}\" fill=\"{color}\" text-anchor=\"middle\" dominant-baseline=\"central\">{Escape(label)}</text>\n");
    }

    // --- Nodes -------------------------------------------------------------

    private static void EmitNode(StringBuilder sb, MindmapSvgScene scene, MindmapSvgNode node)
    {
        switch (node.Kind)
        {
            case ElementKind.Text:
                EmitFreeText(sb, node);
                return;
            case ElementKind.Shape:
                EmitShape(sb, node);
                return;
            case ElementKind.Frame:
                EmitFrame(sb, node);
                return;
            case ElementKind.Image:
                EmitImage(sb, scene, node);
                return;
        }

        EmitTreeNode(sb, scene, node);
    }

    private static void EmitTreeNode(StringBuilder sb, MindmapSvgScene scene, MindmapSvgNode node)
    {
        // Card/Pill have a fill; Outline draws a border only; Plain draws neither (selection is excluded).
        if (node.Shape is NodeShape.Card or NodeShape.Pill)
        {
            var radius = node.Shape == NodeShape.Pill ? node.Height / 2 : CornerRadius;
            EmitRect(sb, node.X, node.Y, node.Width, node.Height, radius, node.FillColor, node.StrokeColor, 1.5);
        }
        else if (node.Shape == NodeShape.Outline)
        {
            EmitRect(sb, node.X, node.Y, node.Width, node.Height, CornerRadius, null, node.StrokeColor, 1.5);
        }

        var isTask = node.ContentType == ElementContentDiscriminators.Task;
        if (isTask)
            EmitTaskCheckbox(sb, scene, node);

        if (node.ContentType == ElementContentDiscriminators.Math)
            EmitMath(sb, node);
        else if (node.ContentType == ElementContentDiscriminators.Code)
            EmitCode(sb, scene, node);
        else if (IsRef(node.ContentType))
            EmitRef(sb, scene, node);
        else
            EmitNodeLabel(sb, node, isTask);
    }

    private static void EmitNodeLabel(StringBuilder sb, MindmapSvgNode node, bool isTask)
    {
        if (string.IsNullOrEmpty(node.Text))
            return;

        var fontSize = FontSize(node.FontScale);
        var centerY = node.Y + node.Height / 2;
        if (isTask)
        {
            var left = node.X + MindmapNodeItem.TaskCheckboxInset + MindmapNodeItem.TaskCheckboxSize + MindmapNodeItem.TaskTextGap;
            EmitText(sb, left, centerY, node.Text, SansFont, fontSize, node.TextColor, "start", node.IsRoot, node.IsTaskDone);
        }
        else
        {
            EmitText(sb, node.X + node.Width / 2, centerY, node.Text, SansFont, fontSize, node.TextColor, "middle", node.IsRoot, false);
        }
    }

    // Math has no vector renderer here; fall back to italic raw LaTeX, mirroring the canvas's own fallback.
    private static void EmitMath(StringBuilder sb, MindmapSvgNode node)
    {
        if (string.IsNullOrEmpty(node.Text))
            return;
        var fontSize = FontSize(node.FontScale);
        sb.Append($"<text x=\"{N(node.X + node.Width / 2)}\" y=\"{N(node.Y + node.Height / 2)}\" font-family=\"{SansFont}\" ");
        sb.Append($"font-size=\"{N(fontSize)}\" fill=\"{Color(node.TextColor)}\" text-anchor=\"middle\" dominant-baseline=\"central\" font-style=\"italic\">{Escape(node.Text)}</text>\n");
    }

    private static void EmitCode(StringBuilder sb, MindmapSvgScene scene, MindmapSvgNode node)
    {
        var fontSize = FontSize(node.FontScale);
        var pad = MindmapNodeItem.CodePadding;
        var innerX = node.X + pad;

        if (!string.IsNullOrEmpty(node.Text))
        {
            var lines = node.Text.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
            var lineHeight = fontSize * 1.3;
            var firstBaseline = node.Y + pad + fontSize;
            sb.Append($"<text font-family=\"{MonoFont}\" font-size=\"{N(fontSize)}\" fill=\"{Color(node.TextColor)}\" xml:space=\"preserve\">");
            for (var i = 0; i < lines.Length; i++)
            {
                var y = firstBaseline + i * lineHeight;
                sb.Append($"<tspan x=\"{N(innerX)}\" y=\"{N(y)}\">{Escape(lines[i])}</tspan>");
            }
            sb.Append("</text>\n");
        }

        if (!string.IsNullOrEmpty(node.CodeLanguage))
        {
            const double chipSize = 9.5;
            var rightX = node.X + node.Width - pad;
            var chipY = node.Y + pad + chipSize * 0.8;
            sb.Append($"<text x=\"{N(rightX)}\" y=\"{N(chipY)}\" font-family=\"{MonoFont}\" font-size=\"{N(chipSize)}\" fill=\"{scene.MutedColor}\" text-anchor=\"end\">{Escape(node.CodeLanguage!)}</text>\n");
        }
    }

    private static void EmitRef(StringBuilder sb, MindmapSvgScene scene, MindmapSvgNode node)
    {
        EmitRefGlyph(sb, node);

        var textLeft = node.X + MindmapNodeItem.RefGlyphInset + MindmapNodeItem.RefGlyphSize + MindmapNodeItem.RefTextGap;
        var centerY = node.Y + node.Height / 2;
        var fontSize = FontSize(node.FontScale);

        if (node.IsRefMissing)
        {
            if (!string.IsNullOrEmpty(scene.MissingRefLabel))
                sb.Append($"<text x=\"{N(textLeft)}\" y=\"{N(centerY)}\" font-family=\"{SansFont}\" font-size=\"{N(fontSize)}\" fill=\"{scene.MutedColor}\" text-anchor=\"start\" dominant-baseline=\"central\" font-style=\"italic\">{Escape(scene.MissingRefLabel)}</text>\n");
            return;
        }

        if (!string.IsNullOrEmpty(node.Text))
            EmitText(sb, textLeft, centerY, node.Text, SansFont, fontSize, node.TextColor, "start", false, false);

        if (!string.IsNullOrEmpty(node.RefBadge))
        {
            var rightX = node.X + node.Width - MindmapNodeItem.TaskCheckboxInset;
            sb.Append($"<text x=\"{N(rightX)}\" y=\"{N(centerY)}\" font-family=\"{SansFont}\" font-size=\"9.5\" fill=\"{scene.MutedColor}\" text-anchor=\"end\" dominant-baseline=\"central\">{Escape(node.RefBadge!)}</text>\n");
        }
    }

    // The kind glyph, mirroring the canvas: an external-link arrow, a document, or stacked cards.
    private static void EmitRefGlyph(StringBuilder sb, MindmapSvgNode node)
    {
        var size = MindmapNodeItem.RefGlyphSize;
        var x = node.X + MindmapNodeItem.RefGlyphInset;
        var y = node.Y + (node.Height - size) / 2;
        var color = Color(node.TextColor);

        switch (node.ContentType)
        {
            case ElementContentDiscriminators.Link:
                EmitLine(sb, x + size * 0.22, y + size * 0.78, x + size * 0.80, y + size * 0.20, color, 1.4);
                EmitLine(sb, x + size * 0.80, y + size * 0.20, x + size * 0.46, y + size * 0.20, color, 1.4);
                EmitLine(sb, x + size * 0.80, y + size * 0.20, x + size * 0.80, y + size * 0.54, color, 1.4);
                break;
            case ElementContentDiscriminators.Note:
                EmitRect(sb, x + size * 0.20, y + size * 0.10, size * 0.60, size * 0.80, 2, null, color, 1.4);
                EmitLine(sb, x + size * 0.32, y + size * 0.40, x + size * 0.68, y + size * 0.40, color, 1.4);
                EmitLine(sb, x + size * 0.32, y + size * 0.58, x + size * 0.68, y + size * 0.58, color, 1.4);
                break;
            case ElementContentDiscriminators.Flashcard:
                EmitRect(sb, x + size * 0.30, y + size * 0.14, size * 0.52, size * 0.52, 2, null, color, 1.4);
                EmitRect(sb, x + size * 0.12, y + size * 0.34, size * 0.52, size * 0.52, 2, node.FillColor, color, 1.4);
                break;
        }
    }

    private static void EmitTaskCheckbox(StringBuilder sb, MindmapSvgScene scene, MindmapSvgNode node)
    {
        var size = MindmapNodeItem.TaskCheckboxSize;
        var x = node.X + MindmapNodeItem.TaskCheckboxInset;
        var y = node.Y + (node.Height - size) / 2;

        if (node.IsTaskDone)
        {
            EmitRect(sb, x, y, size, size, 3, scene.AccentColor, null, 0);
            sb.Append($"<path d=\"M {N(x + size * 0.24)} {N(y + size * 0.52)} L {N(x + size * 0.43)} {N(y + size * 0.72)} L {N(x + size * 0.76)} {N(y + size * 0.30)}\" ");
            sb.Append($"fill=\"none\" stroke=\"{scene.OnAccentColor}\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n");
        }
        else
        {
            EmitRect(sb, x, y, size, size, 3, null, Color(node.TextColor), 1.4);
        }
    }

    private static void EmitFreeText(StringBuilder sb, MindmapSvgNode node)
    {
        if (string.IsNullOrEmpty(node.Text))
            return;
        var fontSize = FontSize(node.FontScale);
        EmitText(sb, node.X + TextPadding / 2, node.Y + node.Height / 2, node.Text, SansFont, fontSize, node.TextColor, "start", node.IsRoot, false);
    }

    private static void EmitShape(StringBuilder sb, MindmapSvgNode node)
    {
        var shape = node.FreeShape ?? ShapeType.Rectangle;
        var stroke = Color(node.StrokeColor);
        var centerX = node.X + node.Width / 2;
        var centerY = node.Y + node.Height / 2;

        switch (shape)
        {
            case ShapeType.Ellipse:
                sb.Append($"<ellipse cx=\"{N(centerX)}\" cy=\"{N(centerY)}\" rx=\"{N(node.Width / 2)}\" ry=\"{N(node.Height / 2)}\" fill=\"{node.FillColor ?? "none"}\" stroke=\"{stroke}\" stroke-width=\"1.5\"/>\n");
                break;
            case ShapeType.Line:
                EmitLine(sb, node.X, centerY, node.X + node.Width, centerY, stroke, 1.5);
                return;
            case ShapeType.Arrow:
                EmitArrow(sb, node, stroke);
                return;
            case ShapeType.Rectangle:
                EmitRect(sb, node.X, node.Y, node.Width, node.Height, CornerRadius, node.FillColor, node.StrokeColor, 1.5);
                break;
            case ShapeType.Blob:
                EmitBlob(sb, node);
                break;
            default:
                EmitPolygon(sb, node, shape);
                break;
        }

        if (!string.IsNullOrEmpty(node.Text))
            EmitText(sb, centerX, centerY, node.Text, SansFont, FontSize(node.FontScale), node.TextColor, "middle", node.IsRoot, false);
    }

    private static void EmitArrow(StringBuilder sb, MindmapSvgNode node, string color)
    {
        var centerY = node.Y + node.Height / 2;
        var endX = node.X + node.Width;
        EmitLine(sb, node.X, centerY, endX, centerY, color, 1.5);
        var head = Math.Min(12, node.Width * 0.3);
        EmitLine(sb, endX, centerY, endX - head, centerY - head * 0.6, color, 1.5);
        EmitLine(sb, endX, centerY, endX - head, centerY + head * 0.6, color, 1.5);
    }

    // The same four cubics the canvas draws, so an exported map and the one on screen agree about what
    // a blob is. Anchors on the four edges, controls on them too, which is what holds the curve inside
    // the element box.
    private static void EmitBlob(StringBuilder sb, MindmapSvgNode node)
    {
        const double Top = 0.38, Right = 0.34, Bottom = 0.62, Left = 0.66;
        const double TopRight = 0.86, RightBottom = 0.54, BottomLeft = 0.9, LeftTop = 0.62;

        double left = node.X, top = node.Y;
        double right = left + node.Width, bottom = top + node.Height;
        var tx = left + node.Width * Top;
        var ry = top + node.Height * Right;
        var bx = left + node.Width * Bottom;
        var ly = top + node.Height * Left;

        var d =
            $"M{N(tx)},{N(top)} " +
            $"C{N(tx + TopRight * (right - tx))},{N(top)} {N(right)},{N(top + (ry - top) * (1 - TopRight))} {N(right)},{N(ry)} " +
            $"C{N(right)},{N(ry + RightBottom * (bottom - ry))} {N(bx + RightBottom * (right - bx))},{N(bottom)} {N(bx)},{N(bottom)} " +
            $"C{N(left + (bx - left) * (1 - BottomLeft))},{N(bottom)} {N(left)},{N(ly + BottomLeft * (bottom - ly))} {N(left)},{N(ly)} " +
            $"C{N(left)},{N(top + (ly - top) * (1 - LeftTop))} {N(left + (tx - left) * (1 - LeftTop))},{N(top)} {N(tx)},{N(top)} Z";

        sb.Append($"<path d=\"{d}\" fill=\"{node.FillColor ?? "none"}\" stroke=\"{Color(node.StrokeColor)}\" stroke-width=\"1.5\"/>\n");
    }

    private static void EmitPolygon(StringBuilder sb, MindmapSvgNode node, ShapeType shape)
    {
        var points = PolygonPoints(node, shape);
        sb.Append("<polygon points=\"");
        for (var i = 0; i < points.Length; i++)
        {
            if (i > 0)
                sb.Append(' ');
            sb.Append(N(points[i].X)).Append(',').Append(N(points[i].Y));
        }
        sb.Append($"\" fill=\"{node.FillColor ?? "none"}\" stroke=\"{Color(node.StrokeColor)}\" stroke-width=\"1.5\"/>\n");
    }

    private static Point[] PolygonPoints(MindmapSvgNode node, ShapeType shape)
    {
        double left = node.X, top = node.Y, w = node.Width, h = node.Height;
        double right = left + w, bottom = top + h, centerX = left + w / 2, centerY = top + h / 2;
        return shape switch
        {
            ShapeType.Diamond => new[]
            {
                new Point(centerX, top), new Point(right, centerY),
                new Point(centerX, bottom), new Point(left, centerY),
            },
            ShapeType.Hexagon => new[]
            {
                new Point(left + w * 0.25, top), new Point(left + w * 0.75, top),
                new Point(right, centerY),
                new Point(left + w * 0.75, bottom), new Point(left + w * 0.25, bottom),
                new Point(left, centerY),
            },
            _ => new[] // Parallelogram
            {
                new Point(left + w * 0.18, top), new Point(right, top),
                new Point(right - w * 0.18, bottom), new Point(left, bottom),
            },
        };
    }

    private static void EmitFrame(StringBuilder sb, MindmapSvgNode node)
    {
        if (node.FillColor is not null)
            sb.Append($"<rect x=\"{N(node.X)}\" y=\"{N(node.Y)}\" width=\"{N(node.Width)}\" height=\"{N(node.Height)}\" rx=\"{N(CornerRadius)}\" ry=\"{N(CornerRadius)}\" fill=\"{node.FillColor}\" fill-opacity=\"0.3\"/>\n");
        EmitRect(sb, node.X, node.Y, node.Width, node.Height, CornerRadius, null, node.StrokeColor, 1.5);

        if (!string.IsNullOrEmpty(node.Text))
        {
            var titleCenterY = node.Y + MindmapNodeItem.FrameTitleHeight / 2;
            EmitText(sb, node.X + TextPadding / 2, titleCenterY, node.Text, SansFont, FontSize(node.FontScale), node.TextColor, "start", node.IsRoot, false);
        }
    }

    private static void EmitImage(StringBuilder sb, MindmapSvgScene scene, MindmapSvgNode node)
    {
        var dataUri = TryReadImageDataUri(node.AssetPath);
        if (dataUri is null)
        {
            EmitRect(sb, node.X, node.Y, node.Width, node.Height, 0, scene.SurfaceColor, scene.MutedColor, 1.5);
            if (!string.IsNullOrEmpty(scene.MissingImageLabel))
                sb.Append($"<text x=\"{N(node.X + node.Width / 2)}\" y=\"{N(node.Y + node.Height / 2)}\" font-family=\"{SansFont}\" font-size=\"12\" fill=\"{scene.MutedColor}\" text-anchor=\"middle\" dominant-baseline=\"central\">{Escape(scene.MissingImageLabel)}</text>\n");
            return;
        }

        sb.Append($"<image x=\"{N(node.X)}\" y=\"{N(node.Y)}\" width=\"{N(node.Width)}\" height=\"{N(node.Height)}\" preserveAspectRatio=\"none\" xlink:href=\"{dataUri}\"/>\n");
        EmitRect(sb, node.X, node.Y, node.Width, node.Height, 0, null, node.StrokeColor, 1.5);
    }

    private static string? TryReadImageDataUri(string? path)
    {
        if (string.IsNullOrEmpty(path))
            return null;
        try
        {
            if (!File.Exists(path))
                return null;
            var bytes = File.ReadAllBytes(path);
            if (bytes.Length == 0)
                return null;
            return $"data:{MimeFor(path)};base64,{Convert.ToBase64String(bytes)}";
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string MimeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".bmp" => "image/bmp",
        ".webp" => "image/webp",
        ".tif" or ".tiff" => "image/tiff",
        ".svg" => "image/svg+xml",
        _ => "image/png",
    };

    // --- Primitives --------------------------------------------------------

    private static void EmitRect(StringBuilder sb, double x, double y, double w, double h, double radius, string? fill, string? stroke, double strokeWidth)
    {
        sb.Append($"<rect x=\"{N(x)}\" y=\"{N(y)}\" width=\"{N(w)}\" height=\"{N(h)}\"");
        if (radius > 0)
            sb.Append($" rx=\"{N(radius)}\" ry=\"{N(radius)}\"");
        sb.Append($" fill=\"{fill ?? "none"}\"");
        if (stroke is not null)
            sb.Append($" stroke=\"{stroke}\" stroke-width=\"{N(strokeWidth)}\"");
        sb.Append("/>\n");
    }

    private static void EmitLine(StringBuilder sb, double x1, double y1, double x2, double y2, string color, double width)
    {
        sb.Append($"<line x1=\"{N(x1)}\" y1=\"{N(y1)}\" x2=\"{N(x2)}\" y2=\"{N(y2)}\" stroke=\"{color}\" stroke-width=\"{N(width)}\" stroke-linecap=\"round\"/>\n");
    }

    private static void EmitText(StringBuilder sb, double x, double y, string text, string font, double fontSize, string? color, string anchor, bool bold, bool strike)
    {
        sb.Append($"<text x=\"{N(x)}\" y=\"{N(y)}\" font-family=\"{font}\" font-size=\"{N(fontSize)}\" fill=\"{Color(color)}\" text-anchor=\"{anchor}\" dominant-baseline=\"central\"");
        if (bold)
            sb.Append(" font-weight=\"600\"");
        if (strike)
            sb.Append(" text-decoration=\"line-through\"");
        sb.Append('>').Append(Escape(text)).Append("</text>\n");
    }

    // Offsets a polyline sideways by shifting each vertex along the (averaged, at corners) segment normal;
    // the same construction the canvas uses for the double line style.
    private static IReadOnlyList<Point> OffsetPolyline(IReadOnlyList<Point> points, double offset)
    {
        const double epsilon = 1e-6;
        var result = new Point[points.Count];
        for (var i = 0; i < points.Count; i++)
        {
            Point n;
            if (i == 0)
                n = Normal(points[0], points[1]);
            else if (i == points.Count - 1)
                n = Normal(points[^2], points[^1]);
            else
            {
                var a = Normal(points[i - 1], points[i]);
                var b = Normal(points[i], points[i + 1]);
                var sx = a.X + b.X;
                var sy = a.Y + b.Y;
                var len = Math.Sqrt(sx * sx + sy * sy);
                n = len < epsilon ? a : new Point(sx / len, sy / len);
            }
            result[i] = new Point(points[i].X + n.X * offset, points[i].Y + n.Y * offset);
        }
        return result;
    }

    private static Point Normal(Point a, Point b)
    {
        var dx = b.X - a.X;
        var dy = b.Y - a.Y;
        var len = Math.Sqrt(dx * dx + dy * dy);
        return len < 1e-6 ? default : new Point(-dy / len, dx / len);
    }

    private static bool IsRef(string contentType) =>
        contentType is ElementContentDiscriminators.Link
            or ElementContentDiscriminators.Note
            or ElementContentDiscriminators.Flashcard;

    private static double FontSize(FontScale scale) => MindmapCanvasControl.FontSizeFor(scale);

    private static string Color(string? hex) => hex ?? "#000000";

    private static string N(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);

    private static string Escape(string text) => text
        .Replace("&", "&amp;")
        .Replace("<", "&lt;")
        .Replace(">", "&gt;")
        .Replace("\"", "&quot;");
}
