using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Avalonia.Input;
using Avalonia.VisualTree;
using Mnemo.Core.Formatting;
using Mnemo.Core.Services;
using System;

namespace Mnemo.UI.Components.BlockEditor.FormattingToolbar;

public partial class InlineFormattingToolbar : UserControl
{
    private Border? _colorPreviewBackground;
    private TextBlock? _colorPreviewForeground;
    private string? _colorOverlayId;
    private string? _hostingToolbarOverlayId;
    private IOverlayService? _overlayService;
    private ColorSwatchPopup? _currentColorPopup;
    private DateTime _lastInteractionUtc = DateTime.MinValue;
    private string? _currentForegroundColor;
    private string? _currentBackgroundColor;

    /// <summary>Raised when a formatting action (Bold, Italic, etc.) is requested.</summary>
    public event Action<InlineFormatKind>? FormatRequested;

    /// <summary>Raised when a text (foreground) color is selected from the color dropdown.</summary>
    public event Action<string>? ForegroundColorRequested;

    /// <summary>Raised when a background color is selected from the color dropdown.</summary>
    public event Action<string>? BackgroundColorRequested;

    /// <summary>Raised when the equation button is clicked (converts selection to inline equation).</summary>
    public event Action? EquationRequested;

    private const string ActiveClass = "FormattingToolbarIconActive";

    /// <summary>Headings use forced bold; the Bold control is non-interactive while this is false.</summary>
    public void SetBoldButtonEnabled(bool enabled)
    {
        if (this.FindControl<Button>("BoldButton") is { } btn)
            btn.IsEnabled = enabled;
    }

    /// <summary>Updates toggle state of format buttons from the current selection.</summary>
    public void UpdateFormatState(
        bool bold, bool italic, bool underline, bool strikethrough, bool highlight,
        string? foregroundColor, string? backgroundColor, bool hasLink,
        bool subscript = false, bool superscript = false)
    {
        SetButtonActive("BoldButton", bold);
        SetButtonActive("ItalicButton", italic);
        SetButtonActive("UnderlineButton", underline);
        SetButtonActive("UnlinkButton", hasLink);
        SetButtonActive("StrikethroughButton", strikethrough);
        SetButtonActive("HighlightButton", highlight);
        SetButtonActive("SubscriptButton", subscript);
        SetButtonActive("SuperscriptButton", superscript);
        _currentForegroundColor = foregroundColor;
        _currentBackgroundColor = backgroundColor;
        UpdateColorPreview(foregroundColor, backgroundColor);
    }

    private void UpdateColorPreview(string? foregroundColor, string? backgroundColor)
    {
        if (_colorPreviewForeground != null)
        {
            var fg = FormattingColorResolver.ToForegroundBrush(foregroundColor)
                     ?? (Application.Current?.TryFindResource("TextPrimaryBrush", out var fgRes) == true && fgRes is IBrush fgBrush
                         ? fgBrush
                         : Brushes.Black);
            _colorPreviewForeground.Foreground = fg;
        }

        if (_colorPreviewBackground != null)
        {
            var bg = FormattingColorResolver.ToBackgroundBrush(backgroundColor)
                     ?? (Application.Current?.TryFindResource("WorkspaceBackgroundBrush", out var bgRes) == true && bgRes is IBrush bgBrush
                         ? bgBrush
                         : Brushes.Transparent);
            _colorPreviewBackground.Background = bg;
        }
    }

    private void SetButtonActive(string name, bool active)
    {
        if (this.FindControl<Button>(name) is not { } btn) return;
        var hasClass = btn.Classes.Contains(ActiveClass);
        if (active && !hasClass)
            btn.Classes.Add(ActiveClass);
        else if (!active && hasClass)
            btn.Classes.Remove(ActiveClass);
    }

    public bool IsInteractingWithToolbar
    {
        get
        {
            var recentInteraction = (DateTime.UtcNow - _lastInteractionUtc).TotalMilliseconds < 400;
            return recentInteraction || IsPointerOver || (_currentColorPopup?.IsPointerOver ?? false);
        }
    }

    public bool IsEventFromToolbarOverlay(object? source)
    {
        if (source is not Visual sourceVisual)
            return false;

        if (IsDescendantOf(sourceVisual, this))
            return true;

        if (_currentColorPopup != null && IsDescendantOf(sourceVisual, _currentColorPopup))
            return true;

        return false;
    }

    /// <summary>Overlay instance id for this toolbar from <see cref="IOverlayService"/>; required so hosted popups close when the toolbar overlay closes.</summary>
    public void SetHostingToolbarOverlayId(string overlayId)
    {
        _hostingToolbarOverlayId = overlayId;
    }

    public InlineFormattingToolbar()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        AddHandler(InputElement.PointerPressedEvent, OnToolbarPointerPressed, RoutingStrategies.Tunnel);
    }

    private void InitializeComponent()
    {
        AvaloniaXamlLoader.Load(this);
    }

    private void OnLoaded(object? sender, RoutedEventArgs e)
    {
        _colorPreviewBackground = this.FindControl<Border>("ColorPreviewBackground");
        _colorPreviewForeground = this.FindControl<TextBlock>("ColorPreviewForeground");
        _overlayService = (Application.Current as App)?.Services?.GetService(typeof(IOverlayService)) as IOverlayService;

        var loc = (Application.Current as App)?.Services?.GetService(typeof(ILocalizationService)) as ILocalizationService;
        string T(string key, string ns = "NotesEditor") => loc?.T(key, ns) ?? key;

        var assistLabel = this.FindControl<TextBlock>("AssistLabel");
        if (assistLabel != null) assistLabel.Text = T("Assist");

        var colorLabel = this.FindControl<TextBlock>("ColorLabel");
        if (colorLabel != null) colorLabel.Text = T("Color");

        SetLocalizedTooltip("ColorButton", T("Color"));
        SetLocalizedTooltip("BoldButton", T("BoldTooltip"));
        SetLocalizedTooltip("ItalicButton", T("ItalicTooltip"));
        SetLocalizedTooltip("UnderlineButton", T("UnderlineTooltip"));
        SetLocalizedTooltip("StrikethroughButton", T("StrikethroughTooltip"));
        SetLocalizedTooltip("UnlinkButton", T("LinkTooltip"));
        SetLocalizedTooltip("HighlightButton", T("HighlightTooltip"));
        SetLocalizedTooltip("SubscriptButton", T("SubscriptTooltip"));
        SetLocalizedTooltip("SuperscriptButton", T("SuperscriptTooltip"));
        SetLocalizedTooltip("EquationButton", T("EquationTooltip"));

        Loaded -= OnLoaded;
    }

    private void SetLocalizedTooltip(string buttonName, string tip)
    {
        if (this.FindControl<Button>(buttonName) is { } btn)
            ToolTip.SetTip(btn, tip);
    }

    private void OnAssistClick(object? sender, RoutedEventArgs e) { }

    private void OnColorClick(object? sender, RoutedEventArgs e)
    {
        _lastInteractionUtc = DateTime.UtcNow;
        if (_overlayService == null) return;

        CloseColorPopup();

        var popup = new ColorSwatchPopup();
        popup.TextColorSelected += OnTextColorSelected;
        popup.BackgroundColorSelected += OnBackgroundColorSelected;
        popup.SetInitialSelection(_currentForegroundColor, _currentBackgroundColor);
        _currentColorPopup = popup;

        var colorButton = this.FindControl<Button>("ColorButton");
        var options = new OverlayOptions
        {
            ShowBackdrop = true,
            CloseOnOutsideClick = true,
            BackdropOpacity = 0,
            AnchorControl = colorButton ?? (object)this,
            AnchorPosition = AnchorPosition.BottomLeft,
            AnchorOffset = new Thickness(0, 4, 0, 0),
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Left,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Top,
            ParentOverlayId = _hostingToolbarOverlayId
        };

        _colorOverlayId = _overlayService.CreateOverlay(popup, options, "ColorSwatchPopup");
    }

    private void OnTextColorSelected(string colorOrSwatch)
    {
        _lastInteractionUtc = DateTime.UtcNow;
        CloseColorPopup();
        if (_colorPreviewForeground != null)
        {
            _colorPreviewForeground.Foreground = FormattingColorResolver.ToForegroundBrush(colorOrSwatch)
                ?? (Application.Current?.TryFindResource("TextPrimaryBrush", out var fgRes) == true && fgRes is IBrush fgBrush
                    ? fgBrush
                    : Brushes.Black);
        }
        ForegroundColorRequested?.Invoke(colorOrSwatch);
    }

    private void OnBackgroundColorSelected(string colorOrSwatch)
    {
        _lastInteractionUtc = DateTime.UtcNow;
        CloseColorPopup();
        if (_colorPreviewBackground != null)
        {
            _colorPreviewBackground.Background = FormattingColorResolver.ToBackgroundBrush(colorOrSwatch)
                ?? (Application.Current?.TryFindResource("WorkspaceBackgroundBrush", out var bgRes) == true && bgRes is IBrush bgBrush
                    ? bgBrush
                    : Brushes.Transparent);
        }
        BackgroundColorRequested?.Invoke(colorOrSwatch);
    }

    private void CloseColorPopup()
    {
        if (_currentColorPopup != null)
        {
            _currentColorPopup.TextColorSelected -= OnTextColorSelected;
            _currentColorPopup.BackgroundColorSelected -= OnBackgroundColorSelected;
            _currentColorPopup = null;
        }

        if (!string.IsNullOrEmpty(_colorOverlayId) && _overlayService != null)
        {
            _overlayService.CloseOverlay(_colorOverlayId);
            _colorOverlayId = null;
        }
    }

    private void OnBoldClick(object? sender, RoutedEventArgs e) => FormatRequested?.Invoke(InlineFormatKind.Bold);
    private void OnItalicClick(object? sender, RoutedEventArgs e) => FormatRequested?.Invoke(InlineFormatKind.Italic);
    private void OnUnderlineClick(object? sender, RoutedEventArgs e) => FormatRequested?.Invoke(InlineFormatKind.Underline);
    private void OnUnlinkClick(object? sender, RoutedEventArgs e) => FormatRequested?.Invoke(InlineFormatKind.Link);
    private void OnStrikethroughClick(object? sender, RoutedEventArgs e) => FormatRequested?.Invoke(InlineFormatKind.Strikethrough);
    private void OnHighlightClick(object? sender, RoutedEventArgs e) => FormatRequested?.Invoke(InlineFormatKind.Highlight);
    private void OnEquationClick(object? sender, RoutedEventArgs e) => EquationRequested?.Invoke();
    private void OnSubscriptClick(object? sender, RoutedEventArgs e) => FormatRequested?.Invoke(InlineFormatKind.Subscript);
    private void OnSuperscriptClick(object? sender, RoutedEventArgs e) => FormatRequested?.Invoke(InlineFormatKind.Superscript);

    private void OnToolbarPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        _lastInteractionUtc = DateTime.UtcNow;
    }

    private static bool IsDescendantOf(Visual source, Visual ancestor)
    {
        Visual? current = source;
        while (current != null)
        {
            if (ReferenceEquals(current, ancestor))
                return true;
            current = current.GetVisualParent();
        }
        return false;
    }
}
