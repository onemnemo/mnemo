using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Media.Immutable;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>
/// A camera-aware backdrop drawn behind the mindmap canvas. It reads the same world <see cref="Transform"/>
/// the canvas uses (top-left origin: <c>screen = content*scale + offset</c>) so the pattern pans and scales
/// with the content, giving a sense of place on the otherwise featureless infinite canvas. The pattern is
/// coarsened when zoomed out and refined when zoomed in so it never becomes a dense smear or a sparse void.
/// Dots render as a single tiled-brush fill from a cached one-cell bitmap — drawing each dot individually
/// cost thousands of draw calls per pan/zoom frame and made the whole editor feel sluggish.
/// </summary>
public sealed class MindmapGridBackground : Control
{
    private const double MinScreenSpacing = 14;
    private const double MaxScreenSpacing = 96;

    public static readonly StyledProperty<Matrix> TransformProperty =
        AvaloniaProperty.Register<MindmapGridBackground, Matrix>(nameof(Transform), Matrix.Identity);

    public static readonly StyledProperty<IBrush?> GridBrushProperty =
        AvaloniaProperty.Register<MindmapGridBackground, IBrush?>(nameof(GridBrush));

    public static readonly StyledProperty<MindmapBackgroundMode> ModeProperty =
        AvaloniaProperty.Register<MindmapGridBackground, MindmapBackgroundMode>(nameof(Mode), MindmapBackgroundMode.Dots);

    /// <summary>Grid cell size in content units at 100% zoom (the "Mindmap.GridSize" setting).</summary>
    public static readonly StyledProperty<double> BaseSpacingProperty =
        AvaloniaProperty.Register<MindmapGridBackground, double>(nameof(BaseSpacing), 40);

    /// <summary>Dot radius in screen pixels (the "Mindmap.GridDotSize" setting; dots mode only).</summary>
    public static readonly StyledProperty<double> DotRadiusProperty =
        AvaloniaProperty.Register<MindmapGridBackground, double>(nameof(DotRadius), 1.5);

    /// <summary>Opacity applied to the whole pattern (the "Mindmap.GridOpacity" setting).</summary>
    public static readonly StyledProperty<double> GridOpacityProperty =
        AvaloniaProperty.Register<MindmapGridBackground, double>(nameof(GridOpacity), 0.2);

    // The cached one-cell dot tile and the inputs it was built for; rebuilt only when one of them changes
    // (zoom step, theme color, DPI, dot-size setting), not per frame.
    private RenderTargetBitmap? _tile;
    private double _tileSpacing;
    private double _tileRadius;
    private double _tileScaling;
    private Color _tileColor;

    static MindmapGridBackground()
    {
        AffectsRender<MindmapGridBackground>(
            TransformProperty, GridBrushProperty, ModeProperty, BaseSpacingProperty, DotRadiusProperty, GridOpacityProperty);
    }

    public MindmapGridBackground()
    {
        // Purely decorative; pointer events belong to the canvas host.
        IsHitTestVisible = false;
    }

    public Matrix Transform { get => GetValue(TransformProperty); set => SetValue(TransformProperty, value); }
    public IBrush? GridBrush { get => GetValue(GridBrushProperty); set => SetValue(GridBrushProperty, value); }
    public MindmapBackgroundMode Mode { get => GetValue(ModeProperty); set => SetValue(ModeProperty, value); }
    public double BaseSpacing { get => GetValue(BaseSpacingProperty); set => SetValue(BaseSpacingProperty, value); }
    public double DotRadius { get => GetValue(DotRadiusProperty); set => SetValue(DotRadiusProperty, value); }
    public double GridOpacity { get => GetValue(GridOpacityProperty); set => SetValue(GridOpacityProperty, value); }

    public override void Render(DrawingContext context)
    {
        if (Mode == MindmapBackgroundMode.None || GridBrush is not ISolidColorBrush brush)
            return;

        var scale = CameraScale(Transform);
        var baseSpacing = BaseSpacing;
        if (scale <= 0 || baseSpacing <= 0)
            return;

        // Keep the on-screen cell size in a readable band: halve/double the content spacing as zoom changes.
        var spacing = baseSpacing * scale;
        while (spacing < MinScreenSpacing)
            spacing *= 2;
        while (spacing > MaxScreenSpacing)
            spacing /= 2;

        // Snap the cell to whole device pixels so the dot tile repeats seamlessly.
        var scaling = TopLevel.GetTopLevel(this)?.RenderScaling ?? 1.0;
        var cellPixels = Math.Max(1, (int)Math.Round(spacing * scaling));
        spacing = cellPixels / scaling;

        var opacity = Math.Clamp(GridOpacity, 0, 1);
        if (opacity <= 0)
            return;

        var baseColor = brush.Color;

        // Screen position of the content origin, wrapped into the first visible grid cell.
        var startX = Mod(Transform.M31, spacing);
        var startY = Mod(Transform.M32, spacing);

        if (Mode == MindmapBackgroundMode.Lines)
        {
            // Opacity is a layer over the whole grid rather than alpha in the stroke color so
            // crossings don't composite twice as dark.
            using (context.PushOpacity(opacity))
                DrawLines(context, baseColor, spacing, startX, startY);
        }
        else
        {
            DrawDots(context, baseColor, opacity, spacing, startX, startY, cellPixels, scaling);
        }
    }

    // ~100–200 strokes per frame at worst; cheap enough to draw directly.
    private void DrawLines(DrawingContext context, Color color, double spacing, double startX, double startY)
    {
        var bounds = Bounds;
        var pen = new Pen(new ImmutableSolidColorBrush(color), 1);
        for (var x = startX; x < bounds.Width; x += spacing)
            context.DrawLine(pen, new Point(x, 0), new Point(x, bounds.Height));
        for (var y = startY; y < bounds.Height; y += spacing)
            context.DrawLine(pen, new Point(0, y), new Point(bounds.Width, y));
    }

    // One fill of the viewport with a tiled single-cell bitmap, phase-shifted so the dots track the camera.
    // The tile holds an opaque dot; opacity is applied to the whole brush (an alpha baked into the tile color
    // was being lost through the render-target bitmap, so the setting appeared to do nothing).
    private void DrawDots(DrawingContext context, Color baseColor, double opacity, double spacing, double startX, double startY, int cellPixels, double scaling)
    {
        EnsureTile(spacing, DotRadius, baseColor, cellPixels, scaling);
        if (_tile is null)
            return;

        // The dot sits at the tile center, so shift the tile origin back by half a cell to keep the dot
        // lattice anchored on the content origin (matching where individually drawn dots used to land).
        var half = spacing / 2;
        var tileBrush = new ImageBrush(_tile)
        {
            TileMode = TileMode.Tile,
            Stretch = Stretch.Fill,
            DestinationRect = new RelativeRect(startX - half, startY - half, spacing, spacing, RelativeUnit.Absolute),
            Opacity = opacity,
        };
        context.DrawRectangle(tileBrush, null, new Rect(Bounds.Size));
    }

    private void EnsureTile(double spacing, double radius, Color color, int cellPixels, double scaling)
    {
        if (_tile is not null
            && Math.Abs(_tileSpacing - spacing) < 1e-9
            && Math.Abs(_tileRadius - radius) < 1e-9
            && Math.Abs(_tileScaling - scaling) < 1e-9
            && _tileColor == color)
            return;

        _tile?.Dispose();
        _tile = new RenderTargetBitmap(new PixelSize(cellPixels, cellPixels), new Vector(96 * scaling, 96 * scaling));
        using (var tileContext = _tile.CreateDrawingContext())
        {
            var dotBrush = new ImmutableSolidColorBrush(color);
            tileContext.DrawEllipse(dotBrush, null, new Point(spacing / 2, spacing / 2), radius, radius);
        }

        _tileSpacing = spacing;
        _tileRadius = radius;
        _tileScaling = scaling;
        _tileColor = color;
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        _tile?.Dispose();
        _tile = null;
    }

    private static double CameraScale(Matrix m) => Math.Sqrt(m.M11 * m.M11 + m.M12 * m.M12);

    private static double Mod(double value, double modulus)
    {
        var r = value % modulus;
        return r < 0 ? r + modulus : r;
    }
}
