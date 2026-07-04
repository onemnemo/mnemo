using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Xml.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Mnemo.UI.Controls;

public sealed class SketchSvgView : Control
{
    public static readonly StyledProperty<string?> SvgProperty =
        AvaloniaProperty.Register<SketchSvgView, string?>(nameof(Svg));

    public static readonly StyledProperty<double> ZoomProperty =
        AvaloniaProperty.Register<SketchSvgView, double>(nameof(Zoom), 1);

    public static readonly StyledProperty<double> PanXProperty =
        AvaloniaProperty.Register<SketchSvgView, double>(nameof(PanX));

    public static readonly StyledProperty<double> PanYProperty =
        AvaloniaProperty.Register<SketchSvgView, double>(nameof(PanY));

    private ParsedSketchSvg? _parsedSvg;
    private string? _loadedSvg;

    static SketchSvgView()
    {
        SvgProperty.Changed.AddClassHandler<SketchSvgView>((view, _) =>
        {
            view.ResetPicture();
            view.InvalidateMeasure();
            view.InvalidateVisual();
        });
        ZoomProperty.Changed.AddClassHandler<SketchSvgView>((view, _) => view.InvalidateVisual());
        PanXProperty.Changed.AddClassHandler<SketchSvgView>((view, _) => view.InvalidateVisual());
        PanYProperty.Changed.AddClassHandler<SketchSvgView>((view, _) => view.InvalidateVisual());
    }

    public string? Svg
    {
        get => GetValue(SvgProperty);
        set => SetValue(SvgProperty, value);
    }

    public double Zoom
    {
        get => GetValue(ZoomProperty);
        set => SetValue(ZoomProperty, Math.Clamp(value, 0.1, 8));
    }

    public double PanX
    {
        get => GetValue(PanXProperty);
        set => SetValue(PanXProperty, value);
    }

    public double PanY
    {
        get => GetValue(PanYProperty);
        set => SetValue(PanYProperty, value);
    }

    public void ZoomAround(double requestedZoom, Point anchor)
    {
        EnsureParsedSvg();
        if (_parsedSvg == null || Bounds.Width <= 0 || Bounds.Height <= 0)
        {
            Zoom = requestedZoom;
            return;
        }

        var previousZoom = Zoom;
        var nextZoom = Math.Clamp(requestedZoom, 0.1, 8);
        if (Math.Abs(previousZoom - nextZoom) < 0.001)
            return;

        var previousMetrics = CalculateRenderMetrics(_parsedSvg, previousZoom);
        var diagramPoint = new Point(
            (anchor.X - previousMetrics.OffsetX) / previousMetrics.Scale,
            (anchor.Y - previousMetrics.OffsetY) / previousMetrics.Scale);

        var nextMetrics = CalculateRenderMetrics(_parsedSvg, nextZoom);
        PanX = anchor.X - diagramPoint.X * nextMetrics.Scale - nextMetrics.BaseOffsetX;
        PanY = anchor.Y - diagramPoint.Y * nextMetrics.Scale - nextMetrics.BaseOffsetY;
        Zoom = nextZoom;
    }

    public override void Render(DrawingContext context)
    {
        if (Bounds.Width <= 0 || Bounds.Height <= 0 || string.IsNullOrWhiteSpace(Svg))
            return;

        EnsureParsedSvg();
        if (_parsedSvg == null)
            return;

        RenderParsedSvg(context, _parsedSvg);
    }

    protected override Size MeasureOverride(Size availableSize)
    {
        EnsureParsedSvg();
        if (_parsedSvg == null)
            return new Size(320, 160);

        return new Size(Math.Max(1, _parsedSvg.Width), Math.Max(1, _parsedSvg.Height));
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        ResetPicture();
        base.OnDetachedFromVisualTree(e);
    }

    private void EnsureParsedSvg()
    {
        if (_loadedSvg == Svg && _parsedSvg != null)
            return;

        ResetPicture();
        if (string.IsNullOrWhiteSpace(Svg))
            return;

        _parsedSvg = ParseSketchSvg(Svg);
        _loadedSvg = Svg;
    }

    private void ResetPicture()
    {
        _parsedSvg = null;
        _loadedSvg = null;
    }

    private void RenderParsedSvg(DrawingContext context, ParsedSketchSvg svg)
    {
        if (svg.Width <= 0 || svg.Height <= 0)
            return;

        var metrics = CalculateRenderMetrics(svg, Zoom);

        // Minimum stroke in drawing-space units that results in 1 physical pixel after scaling.
        // This prevents node borders and edge lines from going sub-pixel and becoming invisible.
        var minStroke = 1.0 / metrics.Scale;

        using var transform = context.PushTransform(
            Matrix.CreateScale(metrics.Scale, metrics.Scale)
            * Matrix.CreateTranslation(metrics.OffsetX, metrics.OffsetY));

        foreach (var line in svg.Lines)
        {
            var pen = new Pen(ParseBrush(line.Stroke), Math.Max(line.StrokeThickness, minStroke));
            var start = new Point(line.X1, line.Y1);
            var end = new Point(line.X2, line.Y2);
            context.DrawLine(pen, start, end);

            if (line.Direction == "bidirectional")
            {
                DrawArrowHead(context, start, end, ParseBrush(line.Stroke));
                DrawArrowHead(context, end, start, ParseBrush(line.Stroke));
            }
            else if (line.Direction != "undirected")
            {
                DrawArrowHead(context, start, end, ParseBrush(line.Stroke));
            }
        }

        foreach (var rect in svg.Rects)
        {
            var fill = ParseBrush(rect.Fill);
            var pen = new Pen(ParseBrush(rect.Stroke), Math.Max(rect.StrokeThickness, minStroke));
            context.DrawRectangle(fill, pen, new Rect(rect.X, rect.Y, rect.Width, rect.Height), rect.Radius, rect.Radius);
        }

        foreach (var circle in svg.Circles)
        {
            var fill = ParseBrush(circle.Fill);
            var pen = new Pen(ParseBrush(circle.Stroke), Math.Max(circle.StrokeThickness, minStroke));
            context.DrawEllipse(fill, pen, new Point(circle.Cx, circle.Cy), circle.Radius, circle.Radius);
        }

        foreach (var polygon in svg.Polygons)
        {
            var fill = ParseBrush(polygon.Fill);
            var pen = new Pen(ParseBrush(polygon.Stroke), Math.Max(polygon.StrokeThickness, minStroke));
            context.DrawGeometry(fill, pen, CreatePolygonGeometry(polygon.Points));
        }

        foreach (var text in svg.Texts)
            DrawSvgText(context, text);
    }

    private RenderMetrics CalculateRenderMetrics(ParsedSketchSvg svg, double zoom)
    {
        var fitScale = Math.Min(Bounds.Width / svg.Width, Bounds.Height / svg.Height);
        var scale = fitScale * Math.Clamp(zoom, 0.1, 8);
        var baseOffsetX = (Bounds.Width - svg.Width * scale) / 2;
        var baseOffsetY = (Bounds.Height - svg.Height * scale) / 2;
        return new RenderMetrics(scale, baseOffsetX, baseOffsetY, baseOffsetX + PanX, baseOffsetY + PanY);
    }

    private static void DrawArrowHead(DrawingContext context, Point start, Point end, IBrush fill)
    {
        var dx = end.X - start.X;
        var dy = end.Y - start.Y;
        var length = Math.Sqrt(dx * dx + dy * dy);
        if (length < 0.1)
            return;

        var ux = dx / length;
        var uy = dy / length;
        var size = 9.0;
        var halfWidth = 4.5;
        var tip = end;
        var baseCenter = new Point(end.X - ux * size, end.Y - uy * size);
        var normal = new Vector(-uy, ux);
        var p1 = baseCenter + normal * halfWidth;
        var p2 = baseCenter - normal * halfWidth;

        var geometry = new StreamGeometry();
        using (var ctx = geometry.Open())
        {
            ctx.BeginFigure(tip, true);
            ctx.LineTo(p1);
            ctx.LineTo(p2);
            ctx.EndFigure(true);
        }

        context.DrawGeometry(fill, null, geometry);
    }

    private static void DrawSvgText(DrawingContext context, SvgText text)
    {
        var typeface = new Typeface(new FontFamily("Inter,Segoe UI,sans-serif"));
        var formatted = new FormattedText(
            text.Text,
            CultureInfo.CurrentCulture,
            FlowDirection.LeftToRight,
            typeface,
            text.FontSize,
            ParseBrush(text.Fill));

        var x = text.Anchor == "middle" ? text.X - formatted.Width / 2 : text.X;
        context.DrawText(formatted, new Point(x, text.Y - formatted.Baseline));
    }

    private static StreamGeometry CreatePolygonGeometry(IReadOnlyList<Point> points)
    {
        var geometry = new StreamGeometry();
        if (points.Count == 0)
            return geometry;

        using var ctx = geometry.Open();
        ctx.BeginFigure(points[0], true);
        for (var i = 1; i < points.Count; i++)
            ctx.LineTo(points[i]);
        ctx.EndFigure(true);
        return geometry;
    }

    private static ParsedSketchSvg ParseSketchSvg(string svg)
    {
        try
        {
            var document = XDocument.Parse(svg);
            var root = document.Root;
            if (root == null)
                return ParsedSketchSvg.Empty;

            var width = ReadDouble(root, "width", 320);
            var height = ReadDouble(root, "height", 160);
            var rects = new List<SvgRect>();
            var lines = new List<SvgLine>();
            var circles = new List<SvgCircle>();
            var polygons = new List<SvgPolygon>();
            var texts = new List<SvgText>();

            foreach (var element in root.Descendants())
            {
                switch (element.Name.LocalName)
                {
                    case "rect":
                        if (ReadAttribute(element, "width") == "100%")
                            break;
                        rects.Add(new SvgRect(
                            ReadDouble(element, "x", 0),
                            ReadDouble(element, "y", 0),
                            ReadDouble(element, "width", 0),
                            ReadDouble(element, "height", 0),
                            ReadDouble(element, "rx", 0),
                            ReadAttribute(element, "fill") ?? "#00000000",
                            ReadAttribute(element, "stroke") ?? "#000000",
                            ReadDouble(element, "stroke-width", 1)));
                        break;
                    case "line":
                        lines.Add(new SvgLine(
                            ReadDouble(element, "x1", 0),
                            ReadDouble(element, "y1", 0),
                            ReadDouble(element, "x2", 0),
                            ReadDouble(element, "y2", 0),
                            ReadAttribute(element, "stroke") ?? "#000000",
                            ReadDouble(element, "stroke-width", 1),
                            ReadAttribute(element, "sketch-edge-direction") ?? "directed"));
                        break;
                    case "circle":
                        circles.Add(new SvgCircle(
                            ReadDouble(element, "cx", 0),
                            ReadDouble(element, "cy", 0),
                            ReadDouble(element, "r", 0),
                            ReadAttribute(element, "fill") ?? "#00000000",
                            ReadAttribute(element, "stroke") ?? "#000000",
                            ReadDouble(element, "stroke-width", 1)));
                        break;
                    case "polygon":
                    {
                        var points = ParsePoints(ReadAttribute(element, "points"));
                        // Arrowheads are drawn from line metadata, so only keep polygons
                        // with four or more points (currently diamond nodes).
                        if (points.Count >= 4)
                        {
                            polygons.Add(new SvgPolygon(
                                points,
                                ReadAttribute(element, "fill") ?? "#00000000",
                                ReadAttribute(element, "stroke") ?? "#000000",
                                ReadDouble(element, "stroke-width", 1)));
                        }
                        break;
                    }
                    case "text":
                        texts.Add(new SvgText(
                            ReadDouble(element, "x", 0),
                            ReadDouble(element, "y", 0),
                            WebUtility.HtmlDecode(element.Value),
                            ReadDouble(element, "font-size", 12),
                            ReadAttribute(element, "fill") ?? "#000000",
                            ReadAttribute(element, "text-anchor") ?? "start"));
                        break;
                }
            }

            return new ParsedSketchSvg(width, height, rects, lines, circles, polygons, texts);
        }
        catch
        {
            return ParsedSketchSvg.Empty;
        }
    }

    private static IReadOnlyList<Point> ParsePoints(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return [];

        var points = new List<Point>();
        var parts = raw
            .Split([' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var part in parts)
        {
            var coords = part.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (coords.Length != 2)
                continue;

            if (double.TryParse(coords[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var x)
                && double.TryParse(coords[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var y))
            {
                points.Add(new Point(x, y));
            }
        }

        return points;
    }

    private static string? ReadAttribute(XElement element, string name) =>
        element.Attribute(name)?.Value;

    private static double ReadDouble(XElement element, string name, double fallback)
    {
        var raw = ReadAttribute(element, name);
        if (string.IsNullOrWhiteSpace(raw))
            return fallback;

        raw = raw.TrimEnd('%');
        return double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;
    }

    private static IBrush ParseBrush(string value)
    {
        if (string.Equals(value, "transparent", StringComparison.OrdinalIgnoreCase))
            return Brushes.Transparent;
        if (TryResolveThemeBrush(value, out var themeBrush))
            return themeBrush;
        if (TryParseRgbBrush(value, out var rgbBrush))
            return rgbBrush;
        return Color.TryParse(value, out var color)
            ? new SolidColorBrush(color)
            : Brushes.Transparent;
    }

    private static bool TryResolveThemeBrush(string value, out IBrush brush)
    {
        brush = Brushes.Transparent;
        if (!TryReadThemeReference(value, out var token))
            return false;

        var app = Application.Current;
        if (app == null)
            return true;

        var key = ResolveThemeResourceKey(token);
        if (app.TryGetResource(key + "Brush", app.ActualThemeVariant, out var brushResource) && brushResource is IBrush resourceBrush)
        {
            brush = resourceBrush;
            return true;
        }

        if (app.TryGetResource(key, app.ActualThemeVariant, out var colorResource) && colorResource is Color resourceColor)
        {
            brush = new SolidColorBrush(resourceColor);
            return true;
        }

        return true;
    }

    private static bool TryReadThemeReference(string value, out string token)
    {
        token = string.Empty;
        if (value.StartsWith("theme.", StringComparison.OrdinalIgnoreCase))
        {
            token = value["theme.".Length..].Trim();
            return token.Length > 0;
        }

        if (value.StartsWith("theme(", StringComparison.OrdinalIgnoreCase) && value.EndsWith(')'))
        {
            token = value["theme(".Length..^1].Trim();
            return token.Length > 0;
        }

        return false;
    }

    private static bool TryParseRgbBrush(string value, out IBrush brush)
    {
        brush = Brushes.Transparent;
        var isRgb = TryReadFunction(value, "rgb", out var rgb);
        var isRgba = TryReadFunction(value, "rgba", out var rgba);
        if (!isRgb && !isRgba)
            return false;

        var parts = (isRgb ? rgb : rgba)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length != (isRgb ? 3 : 4))
            return true;

        if (!byte.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var r)
            || !byte.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var g)
            || !byte.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var b))
            return true;

        var a = (byte)255;
        if (isRgba)
        {
            if (!double.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out var alpha))
                return true;
            a = (byte)Math.Round(Math.Clamp(alpha, 0, 1) * 255);
        }

        brush = new SolidColorBrush(Color.FromArgb(a, r, g, b));
        return true;
    }

    private static bool TryReadFunction(string value, string name, out string argument)
    {
        argument = string.Empty;
        var prefix = name + "(";
        if (!value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !value.EndsWith(')'))
            return false;

        argument = value[prefix.Length..^1];
        return true;
    }

    private static string ResolveThemeResourceKey(string token)
    {
        return token.ToLowerInvariant() switch
        {
            "swatch1" => "WidgetIconBackground1",
            "swatch2" => "WidgetIconBackground2",
            "swatch3" => "WidgetIconBackground3",
            "swatch4" => "WidgetIconBackground4",
            "swatch5" => "WidgetIconBackground5",
            "accent" => "Accent",
            "background" => "WorkspaceBackground",
            "surface" => "CardBackgroundSecondary",
            "text" or "text.primary" => "TextPrimary",
            "text.secondary" => "TextSecondary",
            _ => string.Concat(token
                .Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(Capitalize))
        };
    }

    private static string Capitalize(string value) =>
        value.Length == 0
            ? string.Empty
            : char.ToUpperInvariant(value[0]) + value[1..];

    private sealed record ParsedSketchSvg(
        double Width,
        double Height,
        IReadOnlyList<SvgRect> Rects,
        IReadOnlyList<SvgLine> Lines,
        IReadOnlyList<SvgCircle> Circles,
        IReadOnlyList<SvgPolygon> Polygons,
        IReadOnlyList<SvgText> Texts)
    {
        public static readonly ParsedSketchSvg Empty = new(320, 160, [], [], [], [], []);
    }

    private sealed record SvgRect(
        double X,
        double Y,
        double Width,
        double Height,
        double Radius,
        string Fill,
        string Stroke,
        double StrokeThickness);

    private sealed record SvgLine(
        double X1,
        double Y1,
        double X2,
        double Y2,
        string Stroke,
        double StrokeThickness,
        string Direction);

    private sealed record SvgCircle(
        double Cx,
        double Cy,
        double Radius,
        string Fill,
        string Stroke,
        double StrokeThickness);

    private sealed record SvgPolygon(
        IReadOnlyList<Point> Points,
        string Fill,
        string Stroke,
        double StrokeThickness);

    private sealed record SvgText(
        double X,
        double Y,
        string Text,
        double FontSize,
        string Fill,
        string Anchor);

    private readonly record struct RenderMetrics(
        double Scale,
        double BaseOffsetX,
        double BaseOffsetY,
        double OffsetX,
        double OffsetY);
}
