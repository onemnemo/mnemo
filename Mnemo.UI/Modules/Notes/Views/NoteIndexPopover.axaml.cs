using System;
using System.Collections.Generic;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;

namespace Mnemo.UI.Modules.Notes.Views;

/// <summary>Dark floating-chrome popover listing the note's heading outline. Hosted via IOverlayService.</summary>
public partial class NoteIndexPopover : UserControl
{
    private ItemsControl? _itemsControl;

    public event Action<NoteIndexEntry>? EntrySelected;

    public NoteIndexPopover()
    {
        InitializeComponent();
    }

    private void InitializeComponent()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public void SetEntries(IReadOnlyList<NoteIndexEntry> entries)
    {
        _itemsControl ??= this.FindControl<ItemsControl>("EntriesItemsControl");
        if (_itemsControl != null)
            _itemsControl.ItemsSource = entries;
    }

    private void OnEntryClick(object? sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: NoteIndexEntry entry })
            EntrySelected?.Invoke(entry);
    }
}
