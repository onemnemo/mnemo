using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;
using Mnemo.Core.Services;

namespace Mnemo.UI.Components.BlockEditor.FormattingToolbar;

/// <summary>
/// Dark floating-chrome color picker for the inline formatting toolbar: a "Text color"
/// row (default + five swatches) and a "Background" row (none + five swatches) on one
/// screen. Selecting the default/none cell raises the event with <c>null</c> to clear.
/// </summary>
public partial class ColorSwatchPopup : UserControl
{
    private const string SelectedClass = "selected";

    private StackPanel? _textSwatchPanel;
    private StackPanel? _backgroundSwatchPanel;
    private string? _selectedTextSwatch;
    private string? _selectedBackgroundSwatch;

    /// <summary>Raised with the chosen swatch name, or null when the default (no color) cell is picked.</summary>
    public event Action<string?>? TextColorSelected;

    /// <summary>Raised with the chosen swatch name, or null when the none cell is picked.</summary>
    public event Action<string?>? BackgroundColorSelected;

    public ColorSwatchPopup()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private void InitializeComponent()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public void SetInitialSelection(string? foregroundColor, string? backgroundColor)
    {
        _selectedTextSwatch = foregroundColor;
        _selectedBackgroundSwatch = backgroundColor;
        UpdateSelectionVisuals();
    }

    private void OnLoaded(object? sender, RoutedEventArgs e)
    {
        var loc = (Application.Current as App)?.Services?.GetService(typeof(ILocalizationService)) as ILocalizationService;
        string T(string key, string fallback) => loc?.T(key, "NotesEditor") ?? fallback;

        if (this.FindControl<TextBlock>("TextColorHeader") is { } textHeader)
            textHeader.Text = T("TextColor", "TEXT COLOR");
        if (this.FindControl<TextBlock>("BackgroundHeader") is { } backgroundHeader)
            backgroundHeader.Text = T("BackgroundColor", "BACKGROUND");
        if (this.FindControl<Button>("TextDefaultButton") is { } defaultButton)
            ToolTip.SetTip(defaultButton, T("ColorDefault", "Default"));
        if (this.FindControl<Button>("BackgroundNoneButton") is { } noneButton)
            ToolTip.SetTip(noneButton, T("ColorNone", "None"));

        _textSwatchPanel = this.FindControl<StackPanel>("TextSwatchPanel");
        _backgroundSwatchPanel = this.FindControl<StackPanel>("BackgroundSwatchPanel");
        UpdateSelectionVisuals();
        Loaded -= OnLoaded;
    }

    private void OnTextSwatchClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Button button) return;
        _selectedTextSwatch = button.Tag as string;
        UpdateSelectionVisuals();
        TextColorSelected?.Invoke(_selectedTextSwatch);
    }

    private void OnBackgroundSwatchClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Button button) return;
        _selectedBackgroundSwatch = button.Tag as string;
        UpdateSelectionVisuals();
        BackgroundColorSelected?.Invoke(_selectedBackgroundSwatch);
    }

    private void UpdateSelectionVisuals()
    {
        MarkSelectedCell(_textSwatchPanel, _selectedTextSwatch);
        MarkSelectedCell(_backgroundSwatchPanel, _selectedBackgroundSwatch);
    }

    /// <summary>
    /// Highlights the cell whose Tag matches the selection; a null selection matches the
    /// tagless default/none cell. Raw hex selections (pre-rehaul documents) match nothing.
    /// </summary>
    private static void MarkSelectedCell(StackPanel? panel, string? selectedSwatch)
    {
        if (panel == null) return;

        foreach (var child in panel.Children)
        {
            if (child is not Button button) continue;
            var swatchName = button.Tag as string;
            var isSelected = string.Equals(swatchName, selectedSwatch, StringComparison.OrdinalIgnoreCase);
            button.Classes.Set(SelectedClass, isSelected);
        }
    }
}
