using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.VisualTree;
using Mnemo.UI.Modules.Overview.Controls;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview.Views;

/// <summary>
/// Overview page. The code-behind is the drag controller for widget tiles: pointer capture
/// must live here — on an element that survives reordering — because reordering the board
/// recreates item containers, and hiding the dragged card would otherwise kill a capture
/// held by the tile itself. All board mutations happen in <see cref="OverviewViewModel"/>.
/// </summary>
public partial class OverviewView : UserControl
{
    private const double DragThreshold = 4;
    private const double GhostPointerOffset = 14;

    private WidgetHostViewModel? _pressedHost;
    private IPointer? _pointer;
    private Point _pressPanelPosition;
    private bool _isDragging;

    public OverviewView()
    {
        InitializeComponent();

        // The items panel only exists after the ItemsControl applies its template, so the
        // hint layer is wired on the first layout pass that has one.
        BoardItems.LayoutUpdated += OnBoardLayoutUpdated;
    }

    private void OnBoardLayoutUpdated(object? sender, EventArgs e)
    {
        if (BoardPanel is not { } panel)
            return;

        BoardHints.Attach(panel);
        BoardItems.LayoutUpdated -= OnBoardLayoutUpdated;
    }

    private OverviewViewModel? ViewModel => DataContext as OverviewViewModel;

    private WidgetBoardPanel? BoardPanel => BoardItems.ItemsPanelRoot as WidgetBoardPanel;

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);

        if (ViewModel is not { IsEditMode: true } || BoardPanel is null)
            return;
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            return;
        if (FindDraggedHost(e.Source) is not { } host)
            return;

        _pressedHost = host;
        _pointer = e.Pointer;
        _pressPanelPosition = e.GetPosition(BoardPanel);
        _isDragging = false;

        e.Pointer.Capture(this);
        e.Handled = true;
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);

        if (_pressedHost is not { } host || ViewModel is not { } vm || BoardPanel is not { } panel)
            return;
        if (!ReferenceEquals(e.Pointer, _pointer))
            return;

        var panelPosition = e.GetPosition(panel);
        if (!_isDragging)
        {
            var delta = panelPosition - _pressPanelPosition;
            if (Math.Abs(delta.X) <= DragThreshold && Math.Abs(delta.Y) <= DragThreshold)
                return;

            _isDragging = true;
            vm.BeginDrag(host);
        }

        var ghostPosition = e.GetPosition(BoardArea);
        vm.UpdateGhostPosition(ghostPosition.X + GhostPointerOffset, ghostPosition.Y + GhostPointerOffset);
        var (column, row) = panel.GetTargetCell(panelPosition);
        vm.UpdateDragTarget(column, row);
        e.Handled = true;
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);

        if (_pressedHost is null || !ReferenceEquals(e.Pointer, _pointer))
            return;

        var wasDragging = _isDragging;
        ResetDragState();

        if (wasDragging)
        {
            ViewModel?.CompleteDrag();
            e.Handled = true;
        }

        e.Pointer.Capture(null);
    }

    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e)
    {
        base.OnPointerCaptureLost(e);

        var wasDragging = _isDragging;
        ResetDragState();

        if (wasDragging)
            ViewModel?.CancelDrag();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.Key == Key.Escape && ViewModel is { IsEditMode: true } vm)
        {
            if (_isDragging)
            {
                var pointer = _pointer;
                ResetDragState();
                vm.CancelDrag();
                pointer?.Capture(null);
            }
            else
            {
                vm.CancelEditCommand.Execute(null);
            }

            e.Handled = true;
            return;
        }

        base.OnKeyDown(e);
    }

    private void ResetDragState()
    {
        _pressedHost = null;
        _pointer = null;
        _isDragging = false;
    }

    /// <summary>
    /// Resolves a pointer-press source to the widget tile whose drag handle was pressed,
    /// or null when the press landed anywhere else.
    /// </summary>
    private WidgetHostViewModel? FindDraggedHost(object? source)
    {
        var visual = source as Visual;
        var withinHandle = false;

        while (visual != null && visual != this)
        {
            if (visual is Border { Name: WidgetHostView.DragHandleName })
                withinHandle = true;

            if (visual is WidgetHostView tile)
                return withinHandle ? tile.DataContext as WidgetHostViewModel : null;

            visual = visual.GetVisualParent();
        }

        return null;
    }
}
