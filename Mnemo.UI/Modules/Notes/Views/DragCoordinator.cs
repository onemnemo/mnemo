using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Controls.Shapes;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Mnemo.UI.Controls;
using Mnemo.UI.Modules.Notes.ViewModels;

namespace Mnemo.UI.Modules.Notes.Views;

/// <summary>
/// Owns the full custom pointer-tracked drag state machine for the notes sidebar.
/// Hosted by <see cref="NotesView"/>; rows call <see cref="BeginDrag"/> once the movement threshold is crossed.
/// </summary>
public sealed class DragCoordinator : IDisposable
{
    private enum DragState { Idle, Dragging }

    public enum DropMode { InsertAbove, InsertBelow, DropIntoFolder }

    public readonly record struct DropInfo(NoteTreeItemViewModel Target, DropMode Mode);

    private const double AutoScrollZone = 40.0;
    private const double AutoScrollStep = 6.0;
    private const int AutoScrollIntervalMs = 50;
    private const int AutoExpandDelayMs = 600;

    private readonly Canvas _overlay;
    private readonly ScrollViewer _sidebarScrollViewer;
    private readonly Control _paneRoot;

    private DragState _state = DragState.Idle;
    private NoteTreeItemViewModel? _sourceItem;
    private NoteTreeRow? _sourceRow;
    private Border? _ghost;
    private Rectangle? _insertLine;
    private Border? _folderHighlight;
    private DispatcherTimer? _autoScrollTimer;
    private DispatcherTimer? _autoExpandTimer;
    private NoteTreeItemViewModel? _autoExpandTarget;
    private DropInfo? _currentDropInfo;
    private double _autoScrollDirection;

    public DragCoordinator(Canvas overlay, ScrollViewer sidebarScrollViewer, Control paneRoot)
    {
        _overlay = overlay;
        _sidebarScrollViewer = sidebarScrollViewer;
        _paneRoot = paneRoot;
    }

    public bool IsDragging => _state == DragState.Dragging;

    /// <summary>
    /// Called by a <see cref="NoteTreeRow"/> once the drag threshold is exceeded.
    /// </summary>
    public void BeginDrag(NoteTreeItemViewModel item, NoteTreeRow sourceRow, IPointer pointer)
    {
        if (_state == DragState.Dragging) return;

        _sourceItem = item;
        _sourceRow = sourceRow;
        _state = DragState.Dragging;

        // Fade source row
        sourceRow.Opacity = 0.35;

        // Create ghost
        _ghost = CreateGhost(item, sourceRow);
        _overlay.Children.Add(_ghost);

        // Create insert line (hidden until positioned)
        _insertLine = new Rectangle
        {
            Height = 2,
            Fill = ResolveBrush("AccentBrush"),
            IsVisible = false,
            IsHitTestVisible = false,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top
        };
        _overlay.Children.Add(_insertLine);

        // Create folder highlight border (hidden until needed)
        var accent = TryResolveAccentColor();
        _folderHighlight = new Border
        {
            BorderThickness = new Thickness(1),
            BorderBrush = ResolveBrush("AccentBrush"),
            Background = new SolidColorBrush(Color.FromArgb(40, accent.R, accent.G, accent.B)),
            IsVisible = false,
            IsHitTestVisible = false
        };
        _overlay.Children.Add(_folderHighlight);

        // Capture pointer on pane root so we get moves and releases even outside the row
        pointer.Capture(_paneRoot);
    }

    /// <summary>
    /// Called from <see cref="NotesView"/> on every PointerMoved while dragging.
    /// </summary>
    public void OnPointerMoved(PointerEventArgs e)
    {
        if (_state != DragState.Dragging || _ghost == null) return;

        var pos = e.GetPosition(_overlay);
        PositionGhost(pos);

        UpdateDropTarget(e);
        HandleAutoScroll(e);
    }

    /// <summary>
    /// Called from <see cref="NotesView"/> on PointerReleased. Executes the drop and cleans up.
    /// Returns the resolved drop info (null if no valid target), so the caller can call the VM method.
    /// </summary>
    public DropInfo? OnPointerReleased(PointerReleasedEventArgs e)
    {
        if (_state != DragState.Dragging) return null;

        var result = _currentDropInfo;
        Cleanup(e.Pointer);
        return result;
    }

    /// <summary>
    /// Cancels the drag without executing a drop.
    /// </summary>
    public void CancelDrag(IPointer? pointer = null)
    {
        if (_state != DragState.Dragging) return;
        Cleanup(pointer);
    }

    private void Cleanup(IPointer? pointer)
    {
        _state = DragState.Idle;

        if (_sourceRow != null)
        {
            _sourceRow.Opacity = 1.0;
            _sourceRow = null;
        }

        _sourceItem = null;
        _currentDropInfo = null;

        StopAutoScroll();
        StopAutoExpand();

        _overlay.Children.Remove(_ghost!);
        _overlay.Children.Remove(_insertLine!);
        _overlay.Children.Remove(_folderHighlight!);
        _ghost = null;
        _insertLine = null;
        _folderHighlight = null;

        pointer?.Capture(null);
    }

    private void PositionGhost(Point pointerOnOverlay)
    {
        if (_ghost == null) return;
        Canvas.SetLeft(_ghost, 0);
        Canvas.SetTop(_ghost, pointerOnOverlay.Y - (_ghost.Bounds.Height / 2));
    }

    private void UpdateDropTarget(PointerEventArgs e)
    {
        var rows = CollectVisibleRows();
        NoteTreeRow? hitRow = null;
        double hitRelativeY = 0;

        var pointerOnOverlay = e.GetPosition(_overlay);

        foreach (var row in rows)
        {
            if (ReferenceEquals(row, _sourceRow)) continue;
            if (row.DataContext is not NoteTreeItemViewModel) continue;

            var transform = row.TransformToVisual(_overlay);
            if (transform == null) continue;
            var rowBoundsInOverlay = new Rect(transform.Value.Transform(new Point(0, 0)), row.Bounds.Size);

            if (rowBoundsInOverlay.Contains(pointerOnOverlay))
            {
                hitRow = row;
                hitRelativeY = pointerOnOverlay.Y - rowBoundsInOverlay.Top;
                break;
            }
        }

        if (hitRow?.DataContext is not NoteTreeItemViewModel target)
        {
            HideDropIndicators();
            _currentDropInfo = null;
            return;
        }

        var transform2 = hitRow.TransformToVisual(_overlay);
        if (transform2 == null) { HideDropIndicators(); _currentDropInfo = null; return; }
        var rowBounds = new Rect(transform2.Value.Transform(new Point(0, 0)), hitRow.Bounds.Size);
        var rowHeight = Math.Max(rowBounds.Height, 1.0);
        var relY = hitRelativeY / rowHeight;

        DropMode mode;
        if (target.IsFolder && target.FolderId != null)
        {
            // Dead-zone: top 20% = InsertAbove, bottom 20% = InsertBelow, middle = DropIntoFolder
            if (relY < 0.2)
                mode = DropMode.InsertAbove;
            else if (relY > 0.8)
                mode = DropMode.InsertBelow;
            else
                mode = DropMode.DropIntoFolder;
        }
        else
        {
            mode = relY < 0.5 ? DropMode.InsertAbove : DropMode.InsertBelow;
        }

        _currentDropInfo = new DropInfo(target, mode);

        if (mode == DropMode.DropIntoFolder)
        {
            ShowFolderHighlight(rowBounds);
            HideInsertLine();
            HandleAutoExpand(target);
        }
        else
        {
            HideFolderHighlight();
            StopAutoExpand();

            var lineY = mode == DropMode.InsertAbove ? rowBounds.Top : rowBounds.Bottom;
            ShowInsertLine(lineY, rowBounds.Left, rowBounds.Width);
        }
    }

    private void ShowInsertLine(double y, double x, double width)
    {
        if (_insertLine == null) return;
        Canvas.SetTop(_insertLine, y - 1);
        Canvas.SetLeft(_insertLine, x);
        _insertLine.Width = Math.Max(width, 20);
        _insertLine.IsVisible = true;
    }

    private void HideInsertLine()
    {
        if (_insertLine != null) _insertLine.IsVisible = false;
    }

    private void ShowFolderHighlight(Rect rowBounds)
    {
        if (_folderHighlight == null) return;
        Canvas.SetLeft(_folderHighlight, rowBounds.Left);
        Canvas.SetTop(_folderHighlight, rowBounds.Top);
        _folderHighlight.Width = Math.Max(rowBounds.Width, 20);
        _folderHighlight.Height = Math.Max(rowBounds.Height, 4);
        _folderHighlight.IsVisible = true;
    }

    private void HideFolderHighlight()
    {
        if (_folderHighlight != null) _folderHighlight.IsVisible = false;
    }

    private void HideDropIndicators()
    {
        HideInsertLine();
        HideFolderHighlight();
    }

    private void HandleAutoExpand(NoteTreeItemViewModel folderTarget)
    {
        if (ReferenceEquals(_autoExpandTarget, folderTarget)) return;

        StopAutoExpand();
        _autoExpandTarget = folderTarget;

        if (folderTarget.IsExpanded) return;

        _autoExpandTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(AutoExpandDelayMs) };
        _autoExpandTimer.Tick += (_, _) =>
        {
            StopAutoExpand();
            if (_autoExpandTarget != null && !_autoExpandTarget.IsExpanded)
                _autoExpandTarget.IsExpanded = true;
        };
        _autoExpandTimer.Start();
    }

    private void StopAutoExpand()
    {
        _autoExpandTimer?.Stop();
        _autoExpandTimer = null;
        _autoExpandTarget = null;
    }

    private void HandleAutoScroll(PointerEventArgs e)
    {
        var pointerInScroll = e.GetPosition(_sidebarScrollViewer);
        var scrollHeight = _sidebarScrollViewer.Bounds.Height;

        if (pointerInScroll.Y < AutoScrollZone)
        {
            var intensity = 1.0 - (pointerInScroll.Y / AutoScrollZone);
            _autoScrollDirection = -AutoScrollStep * (1 + intensity);
            EnsureAutoScrollRunning();
        }
        else if (pointerInScroll.Y > scrollHeight - AutoScrollZone)
        {
            var intensity = 1.0 - ((scrollHeight - pointerInScroll.Y) / AutoScrollZone);
            _autoScrollDirection = AutoScrollStep * (1 + intensity);
            EnsureAutoScrollRunning();
        }
        else
        {
            StopAutoScroll();
        }
    }

    private void EnsureAutoScrollRunning()
    {
        if (_autoScrollTimer != null) return;
        _autoScrollTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(AutoScrollIntervalMs) };
        _autoScrollTimer.Tick += (_, _) =>
        {
            var current = _sidebarScrollViewer.Offset;
            _sidebarScrollViewer.Offset = new Vector(current.X, Math.Max(0, current.Y + _autoScrollDirection));
        };
        _autoScrollTimer.Start();
    }

    private void StopAutoScroll()
    {
        _autoScrollTimer?.Stop();
        _autoScrollTimer = null;
        _autoScrollDirection = 0;
    }

    private Border CreateGhost(NoteTreeItemViewModel item, NoteTreeRow sourceRow)
    {
        var ghostRow = new NoteTreeRow { DataContext = item };

        var bg = ResolveBrushAny("TreeViewItemBackgroundPointerOver", "TreeViewItemBackgroundSelected", "NotesPaneBackgroundBrush");
        var border = ResolveBrushAny("NotesPaneDividerBrush", "TreeViewItemBorderBrushSelected");

        var ghost = new Border
        {
            Child = ghostRow,
            Background = bg,
            BorderThickness = new Thickness(1),
            BorderBrush = border,
            BoxShadow = BoxShadows.Parse("0 4 16 0 #40000000"),
            CornerRadius = new CornerRadius(6),
            IsHitTestVisible = false,
            Opacity = 0.95,
            Width = sourceRow.Bounds.Width > 0 ? sourceRow.Bounds.Width : 240,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top
        };

        return ghost;
    }

    private ThemeVariant Theme => _overlay.ActualThemeVariant;

    private IBrush ResolveBrush(string key)
    {
        if (_overlay.TryGetResource(key, Theme, out var v) && v is IBrush b)
            return b;
        if (Application.Current?.TryGetResource(key, Theme, out v) == true && v is IBrush b2)
            return b2;
        return Brushes.DodgerBlue;
    }

    private IBrush ResolveBrushAny(params string[] keys)
    {
        foreach (var key in keys)
        {
            if (_overlay.TryGetResource(key, Theme, out var v) && v is IBrush b)
                return b;
            if (Application.Current?.TryGetResource(key, Theme, out v) == true && v is IBrush b2)
                return b2;
        }
        return Brushes.Gray;
    }

    private Color TryResolveAccentColor()
    {
        if (_overlay.TryGetResource("Accent", Theme, out var v))
        {
            if (v is Color c) return c;
            if (v is SolidColorBrush sc) return sc.Color;
        }
        if (Application.Current?.TryGetResource("Accent", Theme, out v) == true)
        {
            if (v is Color c) return c;
            if (v is SolidColorBrush sc) return sc.Color;
        }
        return Color.FromRgb(0x4C, 0x8B, 0xF5);
    }

    private List<NoteTreeRow> CollectVisibleRows()
    {
        var result = new List<NoteTreeRow>();
        CollectRowsRecursive(_paneRoot, result);
        return result;
    }

    private static void CollectRowsRecursive(Visual visual, List<NoteTreeRow> result)
    {
        if (visual is NoteTreeRow row)
        {
            result.Add(row);
            return;
        }

        foreach (var child in visual.GetVisualChildren())
            CollectRowsRecursive(child, result);
    }

    public NoteTreeItemViewModel? SourceItem => _sourceItem;

    public void Dispose()
    {
        StopAutoScroll();
        StopAutoExpand();
    }
}
