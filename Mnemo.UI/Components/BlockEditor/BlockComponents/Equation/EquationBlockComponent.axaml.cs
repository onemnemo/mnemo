using System;
using System.ComponentModel;
using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.UI.Controls;

namespace Mnemo.UI.Components.BlockEditor.BlockComponents.Equation;

public partial class EquationBlockComponent : BlockComponentBase
{
    private const double ViewportBufferPx = 200;

    private readonly ILaTeXEngine? _latexEngine;
    private readonly ILocalizationService? _loc;
    private BlockViewModel? _subscribedVm;
    private string? _lastRenderedLatex;
    private Flyout? _editorFlyout;
    private TextBox? _flyoutTextBox;
    private Button? _flyoutDoneButton;

    private ScrollViewer? _scrollParent;
    private DispatcherTimer? _viewportDebounceTimer;

    public EquationBlockComponent()
    {
        var services = (Application.Current as App)?.Services;
        _latexEngine = services?.GetService<ILaTeXEngine>();
        _loc = services?.GetService<ILocalizationService>();

        InitializeComponent();

        DataContextChanged += OnDataContextChanged;
        EquationHost.PointerPressed += OnHostPointerPressed;
        EquationHost.KeyDown += OnHostKeyDown;
    }

    private string T(string key) => _loc?.T(key, "NotesEditor") ?? key;

    public override Control? GetInputControl() => null;

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        // TabItem / collapsed panels typically flip IsVisible on content; when we become visible again, match scroll path.
        if (change.Property == IsVisibleProperty && change.GetNewValue<bool>())
            ScheduleViewportRender();
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        TrySubscribeViewport();
        ScheduleViewportRender();
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_subscribedVm != null)
        {
            _subscribedVm.PropertyChanged -= OnVmPropertyChanged;
            _subscribedVm = null;
        }

        if (DataContext is BlockViewModel vm)
        {
            _subscribedVm = vm;
            vm.PropertyChanged += OnVmPropertyChanged;
        }

        TrySubscribeViewport();
        ScheduleViewportRender();
    }

    private void OnVmPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(BlockViewModel.Meta) or nameof(BlockViewModel.Content)
            or nameof(BlockViewModel.EquationLatex))
            ScheduleViewportRender();
    }

    private void TrySubscribeViewport()
    {
        var scroll = this.FindAncestorOfType<ScrollViewer>();
        if (scroll == _scrollParent) return;

        if (_scrollParent != null)
            _scrollParent.ScrollChanged -= OnParentScrollChanged;

        _scrollParent = scroll;
        if (_scrollParent != null)
            _scrollParent.ScrollChanged += OnParentScrollChanged;
    }

    private void OnParentScrollChanged(object? sender, ScrollChangedEventArgs e)
    {
        // Only re-evaluate when the scroll offset actually moved (user scrolled).
        // Extent-only changes come from our own content layout updates (e.g. swapping
        // the LaTeXRenderer in/out) and must not trigger a new render cycle.
        if (e.OffsetDelta.Y == 0 && e.OffsetDelta.X == 0)
            return;
        ScheduleViewportRender();
    }

    private void ScheduleViewportRender()
    {
        _viewportDebounceTimer ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(80) };
        _viewportDebounceTimer.Tick -= OnViewportDebounceTick;
        _viewportDebounceTimer.Tick += OnViewportDebounceTick;
        _viewportDebounceTimer.Stop();
        _viewportDebounceTimer.Start();
    }

    private void OnViewportDebounceTick(object? sender, EventArgs e)
    {
        _viewportDebounceTimer?.Stop();
        ApplyViewportEquationRender();
    }

    /// <summary>
    /// True when this control intersects the scroll viewport (with buffer), or when no scroll ancestor exists.
    /// Caller must ensure <see cref="Visual.IsEffectivelyVisible"/> is true before using this to evict the heavy renderer.
    /// </summary>
    private bool IsNearViewportScroll()
    {
        var scroll = _scrollParent ?? this.FindAncestorOfType<ScrollViewer>();
        if (scroll == null) return true;

        // TranslatePoint to a ScrollViewer returns viewport-relative coordinates:
        // 0 = top of the visible area, scroll.Viewport.Height = bottom.
        // Do NOT add scroll.Offset.Y here; that would mix document-absolute and
        // viewport-relative spaces and cause visible items to appear "off-screen".
        var tl = this.TranslatePoint(new Point(0, 0), scroll);
        if (!tl.HasValue) return true;

        double top = tl.Value.Y;
        double h = Bounds.Height;
        if (double.IsNaN(h) || h <= 0) h = 60; // safe fallback: assume a normal block height
        double bottom = top + h;

        double vy0 = -ViewportBufferPx;
        double vy1 = scroll.Viewport.Height + ViewportBufferPx;
        return bottom >= vy0 && top <= vy1;
    }

    private void ApplyViewportEquationRender()
    {
        var latex = GetLatexSource();
        if (string.IsNullOrWhiteSpace(latex))
        {
            RenderedContent.Content = null;
            RenderedContent.IsVisible = false;
            ErrorDisplay.IsVisible = false;
            EmptyPlaceholder.Text = T("EquationPlaceholder");
            EmptyPlaceholder.IsVisible = true;
            _lastRenderedLatex = null;
            return;
        }

        // Hidden tab / collapsed chrome: do not swap a live render for the off-scroll ellipsis.
        if (!IsEffectivelyVisible)
            return;

        TrySubscribeViewport();
        if (!IsNearViewportScroll())
        {
            ClearHeavyOffScreen();
            return;
        }

        RenderEquationCore();
    }

    /// <summary>Drop expensive LaTeX layout while off-screen; re-run <see cref="RenderEquationCore"/> when scrolled back.</summary>
    private void ClearHeavyOffScreen()
    {
        RenderedContent.Content = null;
        RenderedContent.IsVisible = false;
        ErrorDisplay.IsVisible = false;
        EmptyPlaceholder.Text = "\u2026";
        EmptyPlaceholder.IsVisible = true;
        _lastRenderedLatex = null;
    }

    private string GetLatexSource() => _subscribedVm?.EquationLatex ?? string.Empty;

    private void SetLatexSource(string latex)
    {
        if (_subscribedVm == null) return;
        _subscribedVm.EquationLatex = latex;
        ApplyViewportEquationRender();
    }

    private async void RenderEquationCore()
    {
        var latex = GetLatexSource();
#if DEBUG
        var prev = latex.Length > 80 ? latex[..80] + "…" : latex;
        Debug.WriteLine($"RenderEquationCore: len={latex.Length} preview='{prev}'");
#endif

        if (string.IsNullOrWhiteSpace(latex))
        {
            RenderedContent.Content = null;
            RenderedContent.IsVisible = false;
            ErrorDisplay.IsVisible = false;
            EmptyPlaceholder.Text = T("EquationPlaceholder");
            EmptyPlaceholder.IsVisible = true;
            _lastRenderedLatex = null;
            return;
        }

        if (latex == _lastRenderedLatex) return;
        _lastRenderedLatex = latex;

        EmptyPlaceholder.IsVisible = false;

        if (_latexEngine == null)
        {
            ErrorDisplay.Text = "LaTeX engine unavailable";
            ErrorDisplay.IsVisible = true;
            RenderedContent.IsVisible = false;
            return;
        }

        try
        {
            var result = await _latexEngine.BuildLayoutAsync(latex, 16);
            if (result is LaTeXRenderer renderer)
            {
                if (this.TryFindResource("TextPrimaryBrush", out var res) && res is IBrush brush)
                    renderer.Foreground = brush;

                RenderedContent.Content = renderer;
                RenderedContent.IsVisible = true;
                ErrorDisplay.IsVisible = false;
            }
            else
            {
                ErrorDisplay.Text = T("EquationRenderError");
                ErrorDisplay.IsVisible = true;
                RenderedContent.IsVisible = false;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Equation render error: {ex.Message}");
            ErrorDisplay.Text = T("EquationRenderError");
            ErrorDisplay.IsVisible = true;
            RenderedContent.IsVisible = false;
        }
    }

    private void OnHostPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        e.Handled = true;
        OpenFlyout();
    }

    private void OnHostKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key is Key.Enter or Key.Space)
        {
            e.Handled = true;
            OpenFlyout();
        }
    }

    private void OpenFlyout()
    {
        if (_editorFlyout != null)
        {
            _flyoutDoneButton!.Content = $"{T("Done")} \u21B5";
            _editorFlyout.ShowAt(EquationHost);
            return;
        }

        _flyoutTextBox = new TextBox
        {
            MinWidth = 220,
            MaxWidth = 360,
            AcceptsReturn = false,
            PlaceholderText = T("EquationFlyoutPlaceholder"),
            Text = GetLatexSource(),
            FontFamily = new FontFamily("Cascadia Code, Consolas, Courier New, monospace"),
            FontSize = 14
        };

        _flyoutTextBox.TextChanged += OnFlyoutTextChanged;
        _flyoutTextBox.KeyDown += OnFlyoutKeyDown;

        _flyoutDoneButton = new Button
        {
            Classes = { "accent" },
            VerticalAlignment = VerticalAlignment.Stretch,
            MinWidth = 80,
            Padding = new Thickness(12, 6),
            Content = $"{T("Done")} \u21B5"
        };
        _flyoutDoneButton.Click += OnFlyoutDoneClick;

        var grid = new Grid
        {
            ColumnDefinitions = new ColumnDefinitions("*,Auto"),
            MinWidth = 280,
            MaxWidth = 440
        };
        Grid.SetColumn(_flyoutTextBox, 0);
        Grid.SetColumn(_flyoutDoneButton, 1);
        _flyoutTextBox.Margin = new Thickness(0, 0, 10, 0);
        grid.Children.Add(_flyoutTextBox);
        grid.Children.Add(_flyoutDoneButton);

        var shell = new Border
        {
            Padding = new Thickness(12, 10),
            CornerRadius = new CornerRadius(8),
            Child = grid
        };
        shell.AttachedToVisualTree += (_, _) =>
        {
            if (shell.TryFindResource("MenuFlyoutPresenterBackground", out var bg) && bg is IBrush bgb)
                shell.Background = bgb;
            if (shell.TryFindResource("MenuFlyoutPresenterBorderBrush", out var bd) && bd is IBrush bdb)
                shell.BorderBrush = bdb;
            shell.BorderThickness = new Thickness(1);
        };

        _editorFlyout = new Flyout
        {
            Content = shell,
            Placement = PlacementMode.BottomEdgeAlignedLeft,
            ShowMode = FlyoutShowMode.Standard
        };

        _editorFlyout.Opened += (_, _) =>
        {
            _flyoutTextBox!.Text = GetLatexSource();
            Dispatcher.UIThread.Post(() =>
            {
                _flyoutTextBox.Focus();
                _flyoutTextBox.SelectAll();
            }, DispatcherPriority.Input);
        };

        _editorFlyout.ShowAt(EquationHost);
    }

    private void OnFlyoutTextChanged(object? sender, TextChangedEventArgs e)
    {
        if (_flyoutTextBox == null) return;
        SetLatexSource(_flyoutTextBox.Text ?? string.Empty);
    }

    private void OnFlyoutKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            _editorFlyout?.Hide();
            e.Handled = true;
        }
        else if (e.Key == Key.Enter)
        {
            _editorFlyout?.Hide();
            e.Handled = true;
        }
    }

    private void OnFlyoutDoneClick(object? sender, RoutedEventArgs e) => _editorFlyout?.Hide();

    private void UnsubscribeViewport()
    {
        if (_scrollParent != null)
            _scrollParent.ScrollChanged -= OnParentScrollChanged;
        _scrollParent = null;
        _viewportDebounceTimer?.Stop();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        UnsubscribeViewport();

        if (_subscribedVm != null)
        {
            _subscribedVm.PropertyChanged -= OnVmPropertyChanged;
            _subscribedVm = null;
        }

        if (_flyoutTextBox != null)
        {
            _flyoutTextBox.TextChanged -= OnFlyoutTextChanged;
            _flyoutTextBox.KeyDown -= OnFlyoutKeyDown;
        }

        if (_flyoutDoneButton != null)
            _flyoutDoneButton.Click -= OnFlyoutDoneClick;

        EquationHost.PointerPressed -= OnHostPointerPressed;
        EquationHost.KeyDown -= OnHostKeyDown;
        DataContextChanged -= OnDataContextChanged;
        base.OnDetachedFromVisualTree(e);
    }
}
