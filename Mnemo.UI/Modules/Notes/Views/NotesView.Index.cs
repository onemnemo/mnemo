using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Linq;
using Avalonia;
using Avalonia.Animation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
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
/// popover (hosted via <see cref="IOverlayService"/>) built from the document's heading
/// outline. The chip itself idles at low opacity and brightens on hover/scroll/while-open
/// so it stays informative without competing with the page for attention.
/// </summary>
public partial class NotesView
{
    private const double ChipIdleOpacity = 0.28;
    private const double ChipActiveOpacity = 1.0;
    private static readonly TimeSpan ChipFadeInDuration = TimeSpan.FromMilliseconds(150);
    private static readonly TimeSpan ChipFadeOutDuration = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan ScrollIdleDelay = TimeSpan.FromMilliseconds(1300);

    private bool _indexScrollHooked;
    private bool _isIndexChipHovered;
    private bool _isIndexScrollActive;
    private DispatcherTimer? _scrollIdleTimer;

    private IOverlayService? _indexOverlayService;
    private string? _indexOverlayId;
    private NoteIndexPopover? _currentIndexPopover;

    private void SetupNoteIndex()
    {
        if (_indexOverlayService == null)
        {
            _indexOverlayService = ((App)Application.Current!).Services?.GetService<IOverlayService>();
            if (_indexOverlayService != null)
                _indexOverlayService.Overlays.CollectionChanged += OnOverlaysCollectionChanged;
        }

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

        if (_scrollIdleTimer != null)
        {
            _scrollIdleTimer.Stop();
            _scrollIdleTimer.Tick -= OnScrollIdleTimerTick;
            _scrollIdleTimer = null;
        }

        CloseIndexPopover();

        if (_indexOverlayService != null)
        {
            _indexOverlayService.Overlays.CollectionChanged -= OnOverlaysCollectionChanged;
            _indexOverlayService = null;
        }
    }

    /// <summary>
    /// The popover can also close via outside-click or Escape (handled entirely inside
    /// OverlayPopupHost), bypassing <see cref="CloseIndexPopover"/>. Watch the overlay
    /// collection so the chip's open/closed toggle state never goes stale.
    /// </summary>
    private void OnOverlaysCollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        if (_indexOverlayId == null) return;
        if (_indexOverlayService!.Overlays.Any(o => o.Id == _indexOverlayId)) return;

        if (_currentIndexPopover != null)
        {
            _currentIndexPopover.EntrySelected -= OnIndexEntrySelected;
            _currentIndexPopover = null;
        }
        _indexOverlayId = null;
        UpdateIndexChipOpacity();
    }

    private void OnEditorScrollChangedForIndex(object? sender, ScrollChangedEventArgs e)
    {
        UpdateIndexProgress();

        _isIndexScrollActive = true;
        UpdateIndexChipOpacity();

        _scrollIdleTimer ??= new DispatcherTimer { Interval = ScrollIdleDelay };
        _scrollIdleTimer.Tick -= OnScrollIdleTimerTick;
        _scrollIdleTimer.Tick += OnScrollIdleTimerTick;
        _scrollIdleTimer.Stop();
        _scrollIdleTimer.Start();
    }

    private void OnScrollIdleTimerTick(object? sender, EventArgs e)
    {
        _scrollIdleTimer?.Stop();
        _isIndexScrollActive = false;
        UpdateIndexChipOpacity();
    }

    private void OnIndexChipPointerEntered(object? sender, PointerEventArgs e)
    {
        _isIndexChipHovered = true;
        UpdateIndexChipOpacity();
    }

    private void OnIndexChipPointerExited(object? sender, PointerEventArgs e)
    {
        _isIndexChipHovered = false;
        UpdateIndexChipOpacity();
    }

    private void UpdateIndexChipOpacity()
    {
        var chip = this.FindControl<Button>("IndexChipButton");
        if (chip == null) return;

        var active = _isIndexChipHovered || _isIndexScrollActive || _indexOverlayId != null;
        var target = active ? ChipActiveOpacity : ChipIdleOpacity;
        if (chip.Opacity == target) return;

        var duration = active ? ChipFadeInDuration : ChipFadeOutDuration;
        chip.Transitions = new Transitions { new DoubleTransition { Property = Visual.OpacityProperty, Duration = duration } };
        chip.Opacity = target;
    }

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
        if (_indexOverlayId != null)
        {
            CloseIndexPopover();
            return;
        }

        OpenIndexPopover();
    }

    private void OpenIndexPopover()
    {
        var chip = this.FindControl<Button>("IndexChipButton");
        if (_indexOverlayService == null || chip == null)
            return;

        var popover = new NoteIndexPopover();
        popover.SetEntries(BuildIndexEntries());
        popover.EntrySelected += OnIndexEntrySelected;
        _currentIndexPopover = popover;

        _indexOverlayId = _indexOverlayService.CreateOverlay(popover, new OverlayOptions
        {
            ShowBackdrop = true,
            BackdropOpacity = 0,
            CloseOnOutsideClick = true,
            CloseOnEscape = true,
            AnchorControl = chip,
            AnchorPosition = AnchorPosition.TopLeft,
            AnchorOffset = new Thickness(0, -8, 0, 0),
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Left,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Top
        }, "NoteIndexPopover");

        UpdateIndexChipOpacity();
    }

    private void CloseIndexPopover()
    {
        if (_currentIndexPopover != null)
        {
            _currentIndexPopover.EntrySelected -= OnIndexEntrySelected;
            _currentIndexPopover = null;
        }

        if (_indexOverlayId != null && _indexOverlayService != null)
        {
            _indexOverlayService.CloseOverlay(_indexOverlayId);
            _indexOverlayId = null;
        }

        UpdateIndexChipOpacity();
    }

    private List<NoteIndexEntry> BuildIndexEntries()
    {
        var editor = GetBlockEditor();
        if (editor == null)
            return new List<NoteIndexEntry>();

        var scroll = this.FindControl<ScrollViewer>("EditorScrollViewer");
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
        return entries;
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

    private void OnIndexEntrySelected(NoteIndexEntry entry)
    {
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
