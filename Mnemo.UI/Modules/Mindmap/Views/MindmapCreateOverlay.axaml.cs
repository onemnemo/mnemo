using System;
using System.Collections.Generic;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>The map name and the style template the user chose to start a new map with.</summary>
public sealed record MindmapCreateResult(string Name, string TemplateId);

/// <summary>
/// New-map dialog: a name field plus a gallery of style templates (built-ins and the user's own) to pick
/// the starting look. Returns the choice through <see cref="Completed"/> (null on cancel).
/// </summary>
public partial class MindmapCreateOverlay : UserControl
{
    private ILocalizationService? _loc;
    private IReadOnlyList<StyleTemplate> _templates = Array.Empty<StyleTemplate>();
    private string _selectedTemplateId = string.Empty;
    private bool _completed;
    private bool _built;

    /// <summary>Invoked once when dismissed: the name and template id on create, null on cancel/close.</summary>
    public Action<MindmapCreateResult?>? Completed { get; set; }

    public MindmapCreateOverlay()
    {
        InitializeComponent();
    }

    /// <summary>Fills the dialog with the available <paramref name="templates"/>, a default name and the
    /// initially selected template.</summary>
    public void Initialize(IReadOnlyList<StyleTemplate> templates, string defaultName, string defaultTemplateId)
    {
        _templates = templates.Count > 0 ? templates : Array.Empty<StyleTemplate>();
        _selectedTemplateId = defaultTemplateId;

        var app = Application.Current as App;
        _loc = app?.Services?.GetService<ILocalizationService>();

        string T(string key, string fallback)
        {
            var value = _loc?.T(key, "Mindmap");
            return string.IsNullOrEmpty(value) || value == key ? fallback : value;
        }

        TitleText.Text = T("CreateMapTitle", "New mindmap");
        DescriptionText.Text = T("CreateMapDescription", "Name it and pick a starting style.");
        NameBox.PlaceholderText = T("CreateMapNamePlaceholder", "Map name");
        NameBox.Text = defaultName;
        GalleryLabel.Text = T("StartingTemplate", "Starting template");
        CreateButton.Content = T("Create", "Create");
        CancelButton.Content = T("Cancel", "Cancel");

        CreateButton.IsEnabled = !string.IsNullOrWhiteSpace(defaultName);
        NameBox.AddHandler(TextBox.TextChangedEvent, OnNameChanged);
        NameBox.KeyDown += OnNameKeyDown;
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (!_built)
        {
            _built = true;
            // Built here rather than in Initialize so the swatch brushes resolve against the live theme.
            BuildGallery();
        }
        Dispatcher.UIThread.Post(() =>
        {
            NameBox.Focus();
            NameBox.SelectAll();
        }, DispatcherPriority.Loaded);
    }

    // Escape or an outside click closes the overlay through the host without touching our buttons; treat any
    // such removal as a cancel so the awaiting caller always resolves.
    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        Complete(null);
    }

    private void BuildGallery()
    {
        GalleryPanel.Children.Clear();
        foreach (var template in _templates)
        {
            var dots = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5, HorizontalAlignment = HorizontalAlignment.Center };
            foreach (var token in PreviewTokens(template))
                dots.Children.Add(new Ellipse
                {
                    Width = 14,
                    Height = 14,
                    Fill = DotBrush(token),
                    Stroke = this.TryFindResource("DividerSubtleBrush", out var d) && d is IBrush db ? db : null,
                    StrokeThickness = 1,
                });

            var name = new TextBlock
            {
                Text = template.Name,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                FontSize = 12,
                Foreground = this.TryFindResource("TextPrimaryBrush", out var t) && t is IBrush tb ? tb : Brushes.Gray,
            };

            var card = new Button
            {
                Classes = { "tplCard" },
                Tag = template.Id,
                Content = new StackPanel { Spacing = 9, Children = { dots, name } },
            };
            card.Click += OnTemplateClick;
            if (template.Id == _selectedTemplateId)
                card.Classes.Add("selected");
            GalleryPanel.Children.Add(card);
        }
    }

    // A four-swatch summary of a template: its root fill, then the branch palette when it colors by branch,
    // otherwise its first depth-band fill plus neutral text/stroke tones.
    private static IReadOnlyList<string> PreviewTokens(StyleTemplate template)
    {
        var root = template.RootStyle?.Fill ?? MindmapStyleTokens.Accent;
        if (template.BranchColors == BranchColorMode.ByBranch)
            return new[] { root, MindmapStyleTokens.Palette(2), MindmapStyleTokens.Palette(3), MindmapStyleTokens.Palette(4) };

        var depthFill = template.DepthRules.Count > 0 ? template.DepthRules[0].Style.Fill : null;
        return new[] { root, depthFill ?? MindmapStyleTokens.SurfaceAlt, MindmapStyleTokens.TextMuted, MindmapStyleTokens.Stroke };
    }

    private IBrush DotBrush(string token)
    {
        if (token.StartsWith('#') && Color.TryParse(token, out var color))
            return new SolidColorBrush(color);
        var key = MindmapStyleBrushes.ResourceKey(token);
        if (key is not null && this.TryFindResource(key, out var value) && value is IBrush brush)
            return brush;
        return Brushes.Transparent;
    }

    private void OnTemplateClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string id })
            return;
        _selectedTemplateId = id;
        foreach (var child in GalleryPanel.Children)
        {
            if (child is Button button)
                button.Classes.Set("selected", ReferenceEquals(button, sender));
        }
    }

    private void OnNameChanged(object? sender, TextChangedEventArgs e) =>
        CreateButton.IsEnabled = !string.IsNullOrWhiteSpace(NameBox.Text);

    private void OnNameKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            OnCreateClick(sender, e);
        }
    }

    private void OnCreateClick(object? sender, RoutedEventArgs e)
    {
        var name = NameBox.Text?.Trim();
        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(_selectedTemplateId))
            return;
        Complete(new MindmapCreateResult(name, _selectedTemplateId));
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e) => Complete(null);

    // Fires the result exactly once; later calls (e.g. detach after an explicit button press) are ignored.
    private void Complete(MindmapCreateResult? result)
    {
        if (_completed)
            return;
        _completed = true;
        Completed?.Invoke(result);
    }
}
