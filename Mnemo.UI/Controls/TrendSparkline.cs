using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Mnemo.UI.Controls;

/// <summary>
/// A tiny dependency-free trend sparkline: plots a list of 0..100 values as a single polyline
/// with a dot on the latest (rightmost) point. Projects values onto its own bounds and redraws
/// when <see cref="ValuesProperty"/> or the theme brushes change.
/// </summary>
/// <remarks>
/// Promoted from <c>Mnemo.UI.Modules.Flashcards.Views.FlashcardTestSparkline</c> (test score
/// screen) now that a second call site (Overview's Memory/Test widgets) needs the same rendering.
/// The Flashcards module's copy is left as-is — it can adopt this shared control later.
/// </remarks>
public sealed class TrendSparkline : Control
{
    public static readonly StyledProperty<IReadOnlyList<double>?> ValuesProperty =
        AvaloniaProperty.Register<TrendSparkline, IReadOnlyList<double>?>(nameof(Values));

    public static readonly StyledProperty<IBrush?> LineBrushProperty =
        AvaloniaProperty.Register<TrendSparkline, IBrush?>(nameof(LineBrush));

    public static readonly StyledProperty<IBrush?> DotBrushProperty =
        AvaloniaProperty.Register<TrendSparkline, IBrush?>(nameof(DotBrush));

    public static readonly StyledProperty<double> LineThicknessProperty =
        AvaloniaProperty.Register<TrendSparkline, double>(nameof(LineThickness), 2d);

    static TrendSparkline()
    {
        AffectsRender<TrendSparkline>(ValuesProperty, LineBrushProperty, DotBrushProperty, LineThicknessProperty);
    }

    /// <summary>Values to plot, 0..100. Fewer than 2 points renders nothing.</summary>
    public IReadOnlyList<double>? Values
    {
        get => GetValue(ValuesProperty);
        set => SetValue(ValuesProperty, value);
    }

    public IBrush? LineBrush
    {
        get => GetValue(LineBrushProperty);
        set => SetValue(LineBrushProperty, value);
    }

    public IBrush? DotBrush
    {
        get => GetValue(DotBrushProperty);
        set => SetValue(DotBrushProperty, value);
    }

    public double LineThickness
    {
        get => GetValue(LineThicknessProperty);
        set => SetValue(LineThicknessProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        var values = Values;
        if (values is null || values.Count < 2)
            return;

        var w = Bounds.Width;
        var h = Bounds.Height;
        if (w <= 0 || h <= 0)
            return;

        // Inset so the stroke and end dot aren't clipped.
        const double pad = 4d;
        var innerW = Math.Max(1d, w - pad * 2);
        var innerH = Math.Max(1d, h - pad * 2);

        // Values are 0..100; map linearly with 100 at the top.
        Point Project(int i, double value)
        {
            var x = pad + innerW * i / (values.Count - 1);
            var clamped = Math.Clamp(value, 0d, 100d);
            var y = pad + innerH * (1d - clamped / 100d);
            return new Point(x, y);
        }

        var pen = new Pen(LineBrush ?? Brushes.Gray, LineThickness)
        {
            LineJoin = PenLineJoin.Round,
            LineCap = PenLineCap.Round
        };

        var geometry = new StreamGeometry();
        using (var ctx = geometry.Open())
        {
            var first = Project(0, values[0]);
            ctx.BeginFigure(first, isFilled: false);
            for (var i = 1; i < values.Count; i++)
                ctx.LineTo(Project(i, values[i]));
            ctx.EndFigure(false);
        }
        context.DrawGeometry(null, pen, geometry);

        // Emphasise the latest point (rightmost) with a filled dot.
        var last = Project(values.Count - 1, values[^1]);
        var dot = DotBrush ?? LineBrush ?? Brushes.Gray;
        context.DrawEllipse(dot, null, last, 3d, 3d);
    }
}
