using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Mnemo.UI.Modules.Overview.Controls;

/// <summary>
/// Overlay that draws the edit-mode grid hints (dashed free cells with a mono size label)
/// computed by <see cref="WidgetBoardPanel"/>. A separate control because <c>Panel.Render</c>
/// is sealed; it sits behind the board's ItemsControl at the same origin.
/// </summary>
public sealed class WidgetBoardHintLayer : Control
{
    /// <summary>Stroke of the dashed cell outline; bind a theme brush.</summary>
    public static readonly StyledProperty<IBrush?> StrokeProperty =
        AvaloniaProperty.Register<WidgetBoardHintLayer, IBrush?>(nameof(Stroke));

    /// <summary>Foreground of the "1×1" size hint; bind a theme brush.</summary>
    public static readonly StyledProperty<IBrush?> ForegroundProperty =
        AvaloniaProperty.Register<WidgetBoardHintLayer, IBrush?>(nameof(Foreground));

    private const double CellCornerRadius = 12;
    private const string CellLabel = "1×1";

    private WidgetBoardPanel? _panel;

    static WidgetBoardHintLayer()
    {
        AffectsRender<WidgetBoardHintLayer>(StrokeProperty, ForegroundProperty);
    }

    public IBrush? Stroke
    {
        get => GetValue(StrokeProperty);
        set => SetValue(StrokeProperty, value);
    }

    public IBrush? Foreground
    {
        get => GetValue(ForegroundProperty);
        set => SetValue(ForegroundProperty, value);
    }

    /// <summary>Connects this layer to the board panel whose hint cells it draws.</summary>
    public void Attach(WidgetBoardPanel panel)
    {
        if (ReferenceEquals(_panel, panel))
            return;

        Detach();
        _panel = panel;
        _panel.HintCellsChanged += OnHintCellsChanged;
        InvalidateVisual();
    }

    public void Detach()
    {
        if (_panel == null)
            return;

        _panel.HintCellsChanged -= OnHintCellsChanged;
        _panel = null;
        InvalidateVisual();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        Detach();
    }

    private void OnHintCellsChanged(object? sender, EventArgs e) => InvalidateVisual();

    public override void Render(DrawingContext context)
    {
        base.Render(context);

        if (_panel is not { } panel || panel.HintCells.Count == 0 || Stroke is not { } stroke)
            return;

        var pen = new Pen(stroke, 1.5, new DashStyle([4, 4], 0));
        var foreground = Foreground;
        var typeface = new Typeface(ResolveMonospaceFont());

        foreach (var cell in panel.HintCells)
        {
            context.DrawRectangle(null, pen, new RoundedRect(cell, CellCornerRadius));

            if (foreground == null)
                continue;

            var label = new FormattedText(
                CellLabel,
                System.Globalization.CultureInfo.CurrentCulture,
                FlowDirection.LeftToRight,
                typeface,
                11,
                foreground);
            var origin = new Point(
                cell.X + (cell.Width - label.Width) / 2,
                cell.Y + (cell.Height - label.Height) / 2);
            context.DrawText(label, origin);
        }
    }

    private FontFamily ResolveMonospaceFont()
        => this.TryFindResource("Font.Monospace", out var value) && value is FontFamily family
            ? family
            : FontFamily.Default;
}
