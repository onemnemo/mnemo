using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Mnemo.Core.Services;
using Mnemo.UI.Controls;
using System;

namespace Mnemo.UI.Components.BlockEditor.FormattingToolbar;

public partial class ColorSwatchPopup : UserControl
{
    private const int SwatchCount = 10;
    private const double SwatchSize = 24;
    private const string CheckIconPath = "avares://Mnemo.UI/Icons/States/done-check.svg";

    private enum ColorMode { Text, Highlight }

    private ColorMode _mode = ColorMode.Text;
    private string? _selectedTextSwatch;
    private string? _selectedBackgroundSwatch;
    private WrapPanel? _swatchPanel;
    private Button? _textModeButton;
    private Button? _highlightModeButton;

    public event Action<string>? TextColorSelected;
    public event Action<string>? BackgroundColorSelected;

    public void SetInitialSelection(string? foregroundColor, string? backgroundColor)
    {
        _selectedTextSwatch = foregroundColor;
        _selectedBackgroundSwatch = backgroundColor;
        if (_swatchPanel != null)
            RebuildSwatches();
    }

    public ColorSwatchPopup()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private void InitializeComponent()
    {
        AvaloniaXamlLoader.Load(this);
    }

    private void OnLoaded(object? sender, RoutedEventArgs e)
    {
        var loc = (Application.Current as App)?.Services?.GetService(typeof(ILocalizationService)) as ILocalizationService;
        string T(string key, string fallback) => loc?.T(key, "NotesEditor") ?? fallback;

        if (this.FindControl<TextBlock>("TitleLabel") is { } title)
            title.Text = T("Color", "Color");
        if (this.FindControl<TextBlock>("TextModeLabel") is { } textMode)
            textMode.Text = T("Text", "Text");
        if (this.FindControl<TextBlock>("HighlightModeLabel") is { } highlightMode)
            highlightMode.Text = T("ColorModeHighlight", "Highlight");
        if (this.FindControl<TextBlock>("PaletteHeaderLabel") is { } palette)
            palette.Text = T("ColorPalette", "PALETTE");

        _swatchPanel = this.FindControl<WrapPanel>("SwatchPanel");
        _textModeButton = this.FindControl<Button>("TextModeButton");
        _highlightModeButton = this.FindControl<Button>("HighlightModeButton");

        if (Application.Current is { } app)
            app.ActualThemeVariantChanged += OnThemeVariantChanged;

        RebuildSwatches();
        Loaded -= OnLoaded;
    }

    private void OnUnloaded(object? sender, RoutedEventArgs e)
    {
        if (Application.Current is { } app)
            app.ActualThemeVariantChanged -= OnThemeVariantChanged;
        Unloaded -= OnUnloaded;
    }

    private void OnThemeVariantChanged(object? sender, EventArgs e) => RebuildSwatches();

    private void OnTextModeClick(object? sender, RoutedEventArgs e)
    {
        if (_mode == ColorMode.Text) return;
        _mode = ColorMode.Text;
        UpdateModeToggle();
        RebuildSwatches();
    }

    private void OnHighlightModeClick(object? sender, RoutedEventArgs e)
    {
        if (_mode == ColorMode.Highlight) return;
        _mode = ColorMode.Highlight;
        UpdateModeToggle();
        RebuildSwatches();
    }

    private void UpdateModeToggle()
    {
        const string selectedClass = "selected";
        if (_textModeButton != null)
        {
            if (_mode == ColorMode.Text && !_textModeButton.Classes.Contains(selectedClass))
                _textModeButton.Classes.Add(selectedClass);
            else if (_mode != ColorMode.Text && _textModeButton.Classes.Contains(selectedClass))
                _textModeButton.Classes.Remove(selectedClass);
        }

        if (_highlightModeButton != null)
        {
            if (_mode == ColorMode.Highlight && !_highlightModeButton.Classes.Contains(selectedClass))
                _highlightModeButton.Classes.Add(selectedClass);
            else if (_mode != ColorMode.Highlight && _highlightModeButton.Classes.Contains(selectedClass))
                _highlightModeButton.Classes.Remove(selectedClass);
        }
    }

    private void RebuildSwatches()
    {
        if (_swatchPanel == null) return;
        _swatchPanel.Children.Clear();

        var resourcePrefix = _mode == ColorMode.Text ? "TextColorSwatch" : "ColorSwatch";
        var selected = _mode == ColorMode.Text ? _selectedTextSwatch : _selectedBackgroundSwatch;

        for (int i = 1; i <= SwatchCount; i++)
        {
            if (!TryResolveThemeColor(resourcePrefix + i, out var color))
                continue;

            var swatchName = "swatch" + i;
            var isSelected = string.Equals(selected, swatchName, StringComparison.OrdinalIgnoreCase);
            _swatchPanel.Children.Add(CreateSwatch(color, swatchName, isSelected));
        }
    }

    private Control CreateSwatch(Color color, string swatchName, bool isSelected)
    {
        var defaultBorder = ResolveThemeBrush("ButtonBorderBrush");
        var selectedBorder = ResolveThemeBrush("AccentBrush");

        var shell = new Border
        {
            Width = SwatchSize,
            Height = SwatchSize,
            CornerRadius = new CornerRadius(5),
            Background = new SolidColorBrush(color),
            BorderBrush = isSelected ? selectedBorder : defaultBorder,
            BorderThickness = isSelected ? new Thickness(2) : new Thickness(1),
            Margin = new Thickness(2),
            Cursor = new Cursor(StandardCursorType.Hand)
        };

        if (isSelected)
        {
            shell.Child = new SvgIcon
            {
                Width = 18,
                Height = 18,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                SvgPath = CheckIconPath,
                Color = GetCheckmarkBrush(color)
            };
        }

        shell.PointerPressed += (_, args) =>
        {
            if (_mode == ColorMode.Text)
            {
                _selectedTextSwatch = swatchName;
                TextColorSelected?.Invoke(swatchName);
            }
            else
            {
                _selectedBackgroundSwatch = swatchName;
                BackgroundColorSelected?.Invoke(swatchName);
            }

            RebuildSwatches();
            args.Handled = true;
        };

        return shell;
    }

    private static IBrush GetCheckmarkBrush(Color swatch)
    {
        double luminance = (0.299 * swatch.R + 0.587 * swatch.G + 0.114 * swatch.B) / 255.0;
        if (luminance > 0.55)
            return ResolveThemeBrush("TextPrimaryBrush");
        return ResolveThemeBrush("InstallButtonTextColorBrush")
               ?? ResolveThemeBrush("TextPrimaryBrush");
    }

    private static bool TryResolveThemeColor(string resourceKey, out Color color)
    {
        color = default;
        var app = Application.Current;
        if (app == null)
            return false;

        if (app.TryFindResource(resourceKey, app.ActualThemeVariant, out var res) && res is Color c)
        {
            color = c;
            return true;
        }

        if (app.TryFindResource(resourceKey, out res) && res is Color fallback)
        {
            color = fallback;
            return true;
        }

        return false;
    }

    private static IBrush ResolveThemeBrush(string resourceKey)
    {
        var app = Application.Current;
        if (app == null)
            return Brushes.Transparent;

        if (app.TryFindResource(resourceKey, app.ActualThemeVariant, out var res))
        {
            if (res is IBrush brush)
                return brush;
            if (res is Color color)
                return new SolidColorBrush(color);
        }

        if (app.TryFindResource(resourceKey, out res))
        {
            if (res is IBrush brush)
                return brush;
            if (res is Color color)
                return new SolidColorBrush(color);
        }

        return Brushes.Transparent;
    }
}
