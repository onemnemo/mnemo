using System;
using System.Collections.Generic;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Mnemo.UI.Components.BlockEditor;

namespace Mnemo.UI.Modules.Notes.Views;

/// <summary>One row in the floating note index popover.</summary>
public sealed class NoteIndexEntry
{
    public required string BlockId { get; init; }
    public required string Number { get; init; }
    public required string Title { get; init; }
    public bool IsCurrent { get; init; }
}

/// <summary>
/// Floating "Index" chip: reading progress from the editor scroll offset, and a chapter
/// popover built from the document's heading outline. Presentation-only view chrome —
/// it reads editor visuals (scroll/realized rows), so it lives beside the zoom/camera partials.
/// </summary>
public partial class NotesView
{
    private bool _indexScrollHooked;

    private void SetupNoteIndex()
    {
        var scroll = this.FindControl<ScrollViewer>("EditorScrollViewer");
        if (scroll != null && !_indexScrollHooked)
        {
            scroll.ScrollChanged += OnEditorScrollChangedForIndex;
            _indexScrollHooked = true;
        }
        UpdateIndexProgress();
    }

    private void TeardownNoteIndex()
    {
        var scroll = this.FindControl<ScrollViewer>("EditorScrollViewer");
        if (scroll != null && _indexScrollHooked)
            scroll.ScrollChanged -= OnEditorScrollChangedForIndex;
        _indexScrollHooked = false;
    }

    private void OnEditorScrollChangedForIndex(object? sender, ScrollChangedEventArgs e) =>
        UpdateIndexProgress();

    private void UpdateIndexProgress()
    {
        var scroll = this.FindControl<ScrollViewer>("EditorScrollViewer");
        var percentText = this.FindControl<TextBlock>("IndexPercentText");
        if (scroll == null || percentText == null)
            return;

        percentText.Text = $"{ComputeReadingPercent(scroll)}%";
    }

    private static int ComputeReadingPercent(ScrollViewer scroll)
    {
        var scrollable = scroll.Extent.Height - scroll.Viewport.Height;
        if (scrollable <= 1)
            return 100;
        var fraction = scroll.Offset.Y / scrollable;
        return Math.Clamp((int)Math.Round(fraction * 100), 0, 100);
    }

    private void OnIndexChipClick(object? sender, RoutedEventArgs e)
    {
        var popover = this.FindControl<Border>("IndexPopover");
        if (popover == null)
            return;

        if (popover.IsVisible)
        {
            popover.IsVisible = false;
            return;
        }

        RefreshIndexEntries();
        popover.IsVisible = true;
    }

    private void CloseIndexPopover()
    {
        var popover = this.FindControl<Border>("IndexPopover");
        if (popover != null)
            popover.IsVisible = false;
    }

    private void RefreshIndexEntries()
    {
        var editor = GetBlockEditor();
        var itemsControl = this.FindControl<ItemsControl>("IndexItemsControl");
        var scroll = this.FindControl<ScrollViewer>("EditorScrollViewer");
        if (editor == null || itemsControl == null)
            return;

        var outline = editor.GetHeadingOutline();
        var currentIndex = DetermineCurrentOutlineIndex(editor, outline, scroll);

        var entries = new List<NoteIndexEntry>(outline.Count);
        for (var i = 0; i < outline.Count; i++)
        {
            entries.Add(new NoteIndexEntry
            {
                BlockId = outline[i].BlockId,
                Number = (i + 1).ToString("00"),
                Title = outline[i].Text,
                IsCurrent = i == currentIndex
            });
        }
        itemsControl.ItemsSource = entries;
    }

    /// <summary>
    /// Approximates the section currently being read: maps the scroll fraction onto the
    /// top-level block list and picks the last heading at or above that point. Exact pixel
    /// positions are unavailable for virtualized rows, so this stays an estimate.
    /// </summary>
    private static int DetermineCurrentOutlineIndex(
        BlockEditor editor, IReadOnlyList<BlockOutlineEntry> outline, ScrollViewer? scroll)
    {
        if (outline.Count == 0)
            return -1;
        if (scroll == null)
            return 0;

        var scrollable = scroll.Extent.Height - scroll.Viewport.Height;
        var fraction = scrollable <= 1 ? 0 : Math.Clamp(scroll.Offset.Y / scrollable, 0, 1);
        var blockCount = Math.Max(1, editor.TopLevelBlockCount);
        var approxBlockIndex = fraction * (blockCount - 1);

        var current = 0;
        for (var i = 0; i < outline.Count; i++)
        {
            var headingIndex = editor.GetTopLevelBlockIndex(outline[i].BlockId);
            if (headingIndex >= 0 && headingIndex <= approxBlockIndex)
                current = i;
        }
        return current;
    }

    private void OnIndexEntryClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: NoteIndexEntry entry })
            return;

        CloseIndexPopover();

        var editor = GetBlockEditor();
        if (editor == null)
            return;

        if (editor.ScrollToBlock(entry.BlockId))
            return;

        // Row is virtualized out: scroll proportionally so it gets realized, then retry.
        var scroll = this.FindControl<ScrollViewer>("EditorScrollViewer");
        if (scroll == null)
            return;

        var blockIndex = editor.GetTopLevelBlockIndex(entry.BlockId);
        if (blockIndex < 0)
            return;

        var scrollable = Math.Max(0, scroll.Extent.Height - scroll.Viewport.Height);
        var fraction = editor.TopLevelBlockCount <= 1 ? 0 : (double)blockIndex / (editor.TopLevelBlockCount - 1);
        scroll.Offset = scroll.Offset.WithY(scrollable * fraction);
        Dispatcher.UIThread.Post(() => editor.ScrollToBlock(entry.BlockId), DispatcherPriority.Loaded);
    }

    /// <summary>
    /// Shortcut hint chips next to search / new note. Display convention matches
    /// MenuItemGestureHint usage elsewhere (⌘ on macOS, Ctrl elsewhere).
    /// </summary>
    private void InitializeShortcutHints()
    {
        var searchHint = this.FindControl<TextBlock>("SearchShortcutHint");
        var newNoteHint = this.FindControl<TextBlock>("NewNoteShortcutHint");
        var isMac = OperatingSystem.IsMacOS();
        if (searchHint != null)
            searchHint.Text = isMac ? "⌘P" : "Ctrl+P";
        if (newNoteHint != null)
            newNoteHint.Text = isMac ? "⌘N" : "Ctrl+N";
    }

    private void FocusNotesSearch()
    {
        if (DataContext is ViewModels.NotesViewModel vm && !vm.IsSidebarOpen)
            vm.IsSidebarOpen = true;

        Dispatcher.UIThread.Post(() =>
        {
            this.FindControl<TextBox>("NotesSearchBox")?.Focus();
        }, DispatcherPriority.Loaded);
    }
}
