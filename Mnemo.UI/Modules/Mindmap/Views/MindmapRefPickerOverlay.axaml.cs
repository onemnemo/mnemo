using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>One selectable target in the ref picker: the entity id to link and the label shown in the list.</summary>
public sealed record RefPickerEntry(string Id, string Label);

/// <summary>
/// Generic picker for linking a mindmap node to a note or a flashcard deck: a live-filtered search over a
/// list of entries. Returns the chosen entry through <see cref="Completed"/> (null on cancel/close).
/// </summary>
public partial class MindmapRefPickerOverlay : UserControl
{
    private readonly ObservableCollection<RefPickerEntry> _filtered = new();
    private IReadOnlyList<RefPickerEntry> _all = Array.Empty<RefPickerEntry>();
    private ILocalizationService? _loc;
    private bool _completed;

    /// <summary>Invoked once when dismissed: the chosen entry on pick, null on cancel/close.</summary>
    public Action<RefPickerEntry?>? Completed { get; set; }

    public MindmapRefPickerOverlay()
    {
        InitializeComponent();
    }

    /// <summary>Fills the picker with <paramref name="entries"/> under the given <paramref name="title"/>.</summary>
    public void Initialize(string title, IReadOnlyList<RefPickerEntry> entries)
    {
        _all = entries;

        var app = Application.Current as App;
        _loc = app?.Services?.GetService<ILocalizationService>();

        string T(string key, string fallback)
        {
            var value = _loc?.T(key, "Mindmap");
            return string.IsNullOrEmpty(value) || value == key ? fallback : value;
        }

        TitleText.Text = title;
        SearchBox.PlaceholderText = T("RefSearchPlaceholder", "Search");
        EmptyText.Text = T("RefPickerEmpty", "Nothing to link here yet");
        CancelButton.Content = T("Cancel", "Cancel");

        EntryList.ItemsSource = _filtered;
        SearchBox.AddHandler(TextBox.TextChangedEvent, OnSearchChanged);
        SearchBox.KeyDown += OnSearchKeyDown;
        EntryList.DoubleTapped += OnEntryDoubleTapped;
        Filter(string.Empty);
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        Dispatcher.UIThread.Post(() => SearchBox.Focus(), DispatcherPriority.Loaded);
    }

    // Escape or an outside click closes the overlay through the host without touching our buttons; treat any
    // such removal as a cancel so the awaiting caller always resolves.
    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        Complete(null);
    }

    private void Filter(string query)
    {
        _filtered.Clear();
        foreach (var entry in _all)
            if (query.Length == 0 || entry.Label.Contains(query, StringComparison.OrdinalIgnoreCase))
                _filtered.Add(entry);
        EmptyText.IsVisible = _filtered.Count == 0;
        EntryList.IsVisible = _filtered.Count > 0;
    }

    private void OnSearchChanged(object? sender, TextChangedEventArgs e) =>
        Filter(SearchBox.Text?.Trim() ?? string.Empty);

    // Enter commits the current selection, or the first match when nothing is selected yet, so a search can be
    // confirmed without reaching for the mouse.
    private void OnSearchKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter)
            return;
        e.Handled = true;
        var pick = EntryList.SelectedItem as RefPickerEntry ?? (_filtered.Count > 0 ? _filtered[0] : null);
        if (pick is not null)
            Complete(pick);
    }

    private void OnEntryDoubleTapped(object? sender, TappedEventArgs e)
    {
        if (EntryList.SelectedItem is RefPickerEntry entry)
            Complete(entry);
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e) => Complete(null);

    // Fires the result exactly once; later calls (e.g. detach after an explicit button press) are ignored.
    private void Complete(RefPickerEntry? result)
    {
        if (_completed)
            return;
        _completed = true;
        Completed?.Invoke(result);
    }
}
