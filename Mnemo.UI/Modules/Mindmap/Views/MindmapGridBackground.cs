using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>
/// A camera-aware dot grid drawn behind the mindmap canvas. It reads the same world <see cref="Transform"/>
/// the canvas uses (top-left origin: <c>screen = content*scale + offset</c>) so the dots pan and scale with
/// the content, giving a sense of place on the otherwise featureless infinite canvas. The dot field is
/// coarsened when zoomed out and refined when zoomed in so it never becomes a dense smear or a sparse void.
/// </summary>
public sealed class MindmapGridBackground : Control
{
    private const double BaseSpacing = 32;
    private const double DotRadius = 1;
    private const double MinSpacing = 14;
    private const double MaxSpacing = 96;

    public static readonly StyledProperty<Matrix> TransformProperty =
        AvaloniaProperty.Register<MindmapGridBackground, Matrix>(nameof(Transform), Matrix.Identity);

    public static readonly StyledProperty<IBrush?> DotBrushProperty =
        AvaloniaProperty.Register<MindmapGridBackground, IBrush?>(nameof(DotBrush));

    static MindmapGridBackground()
    {
        AffectsRender<MindmapGridBackground>(TransformProperty, DotBrushProperty);
    }

    public Matrix Transform
    {
        get => GetValue(TransformProperty);
        set => SetValue(TransformProperty, value);
    }

    public IBrush? DotBrush
    {
        get => GetValue(DotBrushProperty);
        set => SetValue(DotBrushProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        var brush = DotBrush;
        if (brush is null)
            return;

        var scale = MindmapCameraScale(Transform);
        if (scale <= 0)
            return;

        var spacing = BaseSpacing * scale;
        while (spacing < MinSpacing)
            spacing *= 2;
        while (spacing > MaxSpacing)
            spacing /= 2;

        var bounds = Bounds;
        // Screen position of the content origin, wrapped into the first visible grid cell.
        var startX = Mod(Transform.M31, spacing);
        var startY = Mod(Transform.M32, spacing);

        for (var x = startX; x < bounds.Width; x += spacing)
            for (var y = startY; y < bounds.Height; y += spacing)
                context.DrawEllipse(brush, null, new Point(x, y), DotRadius, DotRadius);
    }

    private static double MindmapCameraScale(Matrix m) => Math.Sqrt(m.M11 * m.M11 + m.M12 * m.M12);

    private static double Mod(double value, double modulus)
    {
        var r = value % modulus;
        return r < 0 ? r + modulus : r;
    }
}
