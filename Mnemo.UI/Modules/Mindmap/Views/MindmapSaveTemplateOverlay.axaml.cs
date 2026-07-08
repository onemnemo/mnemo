using System;
using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>The name plus the number of depth levels the user chose to capture into a template.</summary>
public sealed record MindmapSaveTemplateResult(string Name, int Levels);

/// <summary>
/// Save-as-template dialog for a styled subtree: a name field and a segmented picker for how many depth
/// levels of the selection to capture. Returns the choice through <see cref="Completed"/> (null on cancel).
/// </summary>
public partial class MindmapSaveTemplateOverlay : UserControl
{
    private ILocalizationService? _loc;
    private int _selectedLevels = 1;
    private string _levelsCountOne = "{0} level";
    private string _levelsCountMany = "{0} levels";
    private bool _completed;

    /// <summary>Invoked once when dismissed: the entered name and level count on save, null on cancel/close.</summary>
    public Action<MindmapSaveTemplateResult?>? Completed { get; set; }

    public MindmapSaveTemplateOverlay()
    {
        InitializeComponent();
    }

    // Escape or an outside click closes the overlay through the host without touching our buttons; treat any
    // such removal as a cancel so the awaiting caller always resolves.
    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        Complete(null);
    }

    // Fires the result exactly once; later calls (e.g. detach after an explicit button press) are ignored.
    private void Complete(MindmapSaveTemplateResult? result)
    {
        if (_completed)
            return;
        _completed = true;
        Completed?.Invoke(result);
    }

    /// <summary>Populates the dialog for a selection whose subtree carries <paramref name="availableLevels"/>
    /// styled depths, preselecting <paramref name="defaultLevels"/>.</summary>
    public void Initialize(int availableLevels, int defaultLevels)
    {
        availableLevels = Math.Max(1, availableLevels);
        _selectedLevels = Math.Clamp(defaultLevels, 1, availableLevels);

        var app = Application.Current as App;
        _loc = app?.Services?.GetService<ILocalizationService>();

        string T(string key, string fallback)
        {
            var value = _loc?.T(key, "Mindmap");
            return string.IsNullOrEmpty(value) || value == key ? fallback : value;
        }

        TitleText.Text = T("SaveTemplateTitle", "Save style as template");
        DescriptionText.Text = T("SaveTemplateDescription", "Reuse this styling on other maps.");
        NameBox.PlaceholderText = T("TemplateNamePlaceholder", "Template name");
        LevelsLabel.Text = T("LevelsToCapture", "Levels to capture");
        SaveButton.Content = T("Save", "Save");
        CancelButton.Content = T("Cancel", "Cancel");
        _levelsCountOne = T("LevelsCountOne", "{0} level");
        _levelsCountMany = T("LevelsCountMany", "{0} levels");

        BuildLevelButtons(availableLevels);
        UpdateLevelsCaption();
        SaveButton.IsEnabled = false;

        NameBox.AddHandler(TextBox.TextChangedEvent, OnNameChanged);
        NameBox.KeyDown += OnNameKeyDown;
        NameBox.AttachedToVisualTree += (_, _) =>
            Dispatcher.UIThread.Post(() => NameBox.Focus(), DispatcherPriority.Loaded);
    }

    private void BuildLevelButtons(int availableLevels)
    {
        LevelsPanel.Children.Clear();
        for (var level = 1; level <= availableLevels; level++)
        {
            var button = new Button
            {
                Classes = { "segment" },
                Content = level.ToString(CultureInfo.CurrentCulture),
                Width = 42,
                Tag = level,
            };
            button.Click += OnLevelClick;
            if (level == _selectedLevels)
                button.Classes.Add("selected");
            LevelsPanel.Children.Add(button);
        }
    }

    private void OnLevelClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: int level })
            return;
        _selectedLevels = level;
        foreach (var child in LevelsPanel.Children)
        {
            if (child is Button button)
                button.Classes.Set("selected", ReferenceEquals(button, sender));
        }
        UpdateLevelsCaption();
    }

    private void UpdateLevelsCaption()
    {
        var format = _selectedLevels == 1 ? _levelsCountOne : _levelsCountMany;
        LevelsCaption.Text = string.Format(CultureInfo.CurrentCulture, format, _selectedLevels);
    }

    private void OnNameChanged(object? sender, TextChangedEventArgs e) =>
        SaveButton.IsEnabled = !string.IsNullOrWhiteSpace(NameBox.Text);

    private void OnNameKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            OnSaveClick(sender, e);
        }
    }

    private void OnSaveClick(object? sender, RoutedEventArgs e)
    {
        var name = NameBox.Text?.Trim();
        if (string.IsNullOrEmpty(name))
            return;
        Complete(new MindmapSaveTemplateResult(name, _selectedLevels));
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e) => Complete(null);
}
