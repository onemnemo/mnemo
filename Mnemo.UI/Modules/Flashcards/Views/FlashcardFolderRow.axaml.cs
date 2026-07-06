using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.Views;

public partial class FlashcardFolderRow : UserControl
{
    private const double DragStartThreshold = 5.0;
    private const double DoubleClickMaxMs = 400.0;
    private const double DoubleClickMaxPx = 5.0;

    private Point _pressPosition;
    private bool _dragArmed;
    private IPointer? _armedPointer;
    private DateTime _lastClickTime = DateTime.MinValue;
    private Point _lastClickPosition;
    private TopLevel? _editTopLevel;

    public FlashcardFolderRow()
    {
        InitializeComponent();
    }

    public Rect GetBoundsInVisual(Visual targetVisual)
    {
        var transform = this.TransformToVisual(targetVisual);
        if (transform == null)
            return new Rect();

        return new Rect(transform.Value.Transform(new Point(0, 0)), Bounds.Size);
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        AddHandler(PointerPressedEvent, OnPointerPressedTunnel, RoutingStrategies.Tunnel, handledEventsToo: true);
        AddHandler(PointerMovedEvent, OnPointerMoved, RoutingStrategies.Bubble);
        AddHandler(PointerReleasedEvent, OnPointerReleased, RoutingStrategies.Bubble);
        AddHandler(PointerCaptureLostEvent, OnPointerCaptureLost, RoutingStrategies.Bubble);
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        RemoveHandler(PointerPressedEvent, OnPointerPressedTunnel);
        RemoveHandler(PointerMovedEvent, OnPointerMoved);
        RemoveHandler(PointerReleasedEvent, OnPointerReleased);
        RemoveHandler(PointerCaptureLostEvent, OnPointerCaptureLost);

        StopGlobalEditListener();
        base.OnDetachedFromVisualTree(e);
    }

    private void OnPointerPressedTunnel(object? sender, PointerPressedEventArgs e)
    {
        if (IsEditing || DataContext is not FlashcardFolderItemViewModel item)
            return;
        if (e.GetCurrentPoint(this).Properties.PointerUpdateKind != PointerUpdateKind.LeftButtonPressed)
            return;
        if (IsPointerOnMoreButton(e))
            return;

        var now = DateTime.UtcNow;
        var pos = e.GetPosition(this);
        var elapsed = (now - _lastClickTime).TotalMilliseconds;
        var dist = Math.Sqrt(Math.Pow(pos.X - _lastClickPosition.X, 2) + Math.Pow(pos.Y - _lastClickPosition.Y, 2));
        if (elapsed <= DoubleClickMaxMs && dist <= DoubleClickMaxPx)
        {
            _lastClickTime = DateTime.MinValue;
            _dragArmed = false;
            e.Pointer.Capture(null);
            e.Handled = true;
            BeginRename(item);
            return;
        }

        _lastClickTime = now;
        _lastClickPosition = pos;

        _pressPosition = pos;
        _dragArmed = true;
        _armedPointer = e.Pointer;
        e.Handled = true;
        e.Pointer.Capture(this);
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        if (IsEditing || !_dragArmed || DataContext is not FlashcardFolderItemViewModel item)
            return;

        var current = e.GetPosition(this);
        var delta = current - _pressPosition;
        if (Math.Abs(delta.X) <= DragStartThreshold && Math.Abs(delta.Y) <= DragStartThreshold)
            return;

        _dragArmed = false;
        var pointer = _armedPointer;
        _armedPointer = null;
        pointer?.Capture(null);

        var flashcardsView = FindFlashcardsView();
        flashcardsView?.InitiateFolderDrag(item, this, e.Pointer);
    }

    private void OnPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (IsEditing)
        {
            e.Pointer.Capture(null);
            return;
        }

        if (DataContext is FlashcardFolderItemViewModel item && _dragArmed)
        {
            var viewModel = FindViewModel();
            viewModel?.ToggleFolderExpanded(item);
        }

        e.Pointer.Capture(null);
        _dragArmed = false;
        _armedPointer = null;
    }

    private void OnPointerCaptureLost(object? sender, PointerCaptureLostEventArgs e)
    {
        _dragArmed = false;
        _armedPointer = null;
    }

    private bool IsPointerOnMoreButton(PointerEventArgs e)
    {
        var point = e.GetPosition(MoreButton);
        return point.X >= 0 && point.Y >= 0 && point.X <= MoreButton.Bounds.Width && point.Y <= MoreButton.Bounds.Height;
    }

    private bool IsEditing => FolderNameTextBox.IsVisible;

    private void OnRenameClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is FlashcardFolderItemViewModel item)
            BeginRename(item);
    }

    private async void OnDeleteClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not FlashcardFolderItemViewModel item)
            return;

        var viewModel = FindViewModel();
        if (viewModel == null)
            return;

        var app = Application.Current as App;
        var overlay = app?.Services?.GetService<IOverlayService>();
        var localization = app?.Services?.GetService<ILocalizationService>();
        if (overlay == null || localization == null)
            return;

        var title = localization.T("DeleteFolder", "Flashcards");
        var message = string.Format(localization.T("DeleteFolderConfirm", "Flashcards"), item.Name);
        var deleteLabel = localization.T("DeleteFolder", "Flashcards");
        var cancelLabel = localization.T("Cancel", "Common");
        var result = await overlay.CreateDialogAsync(title, message, deleteLabel, cancelLabel, severity: DialogSeverity.Destructive).ConfigureAwait(true);
        if (!string.Equals(result, deleteLabel, StringComparison.Ordinal))
            return;

        await viewModel.DeleteFolderCommand.ExecuteAsync(item);
    }

    private void BeginRename(FlashcardFolderItemViewModel item)
    {
        FolderNameTextBlock.IsVisible = false;
        FolderNameTextBox.IsVisible = true;
        FolderNameTextBox.Text = item.Name;
        FolderNameTextBox.CaretIndex = FolderNameTextBox.Text?.Length ?? 0;
        FolderNameTextBox.SelectAll();
        Dispatcher.UIThread.Post(() => FolderNameTextBox.Focus(), DispatcherPriority.Loaded);

        _editTopLevel = TopLevel.GetTopLevel(this);
        _editTopLevel?.AddHandler(PointerPressedEvent, OnGlobalPointerPressedDuringEdit, RoutingStrategies.Tunnel);
    }

    private void StopGlobalEditListener()
    {
        _editTopLevel?.RemoveHandler(PointerPressedEvent, OnGlobalPointerPressedDuringEdit);
        _editTopLevel = null;
    }

    private void OnGlobalPointerPressedDuringEdit(object? sender, PointerPressedEventArgs e)
    {
        if (!FolderNameTextBox.IsVisible)
        {
            StopGlobalEditListener();
            return;
        }

        var pos = e.GetPosition(FolderNameTextBox);
        if (pos.X >= 0 && pos.Y >= 0 && pos.X <= FolderNameTextBox.Bounds.Width && pos.Y <= FolderNameTextBox.Bounds.Height)
            return;

        StopGlobalEditListener();
        CommitRename();
    }

    private void OnNameEditLostFocus(object? sender, RoutedEventArgs e)
    {
        if (IsEditing)
            CommitRename();
    }

    private void OnNameEditKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            CommitRename();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.Escape)
        {
            CancelRename();
            e.Handled = true;
        }
    }

    private async void CommitRename()
    {
        if (!FolderNameTextBox.IsVisible || DataContext is not FlashcardFolderItemViewModel item)
            return;

        StopGlobalEditListener();
        var viewModel = FindViewModel();
        if (viewModel != null)
            await viewModel.RenameFolderCommand.ExecuteAsync(item);

        FolderNameTextBox.IsVisible = false;
        FolderNameTextBlock.IsVisible = true;
    }

    private void CancelRename()
    {
        if (!FolderNameTextBox.IsVisible)
            return;

        StopGlobalEditListener();
        FolderNameTextBox.IsVisible = false;
        FolderNameTextBlock.IsVisible = true;
    }

    private FlashcardsView? FindFlashcardsView()
    {
        var current = this as Visual;
        while (current != null)
        {
            if (current is FlashcardsView view)
                return view;

            current = current.GetVisualParent();
        }

        return null;
    }

    private FlashcardsViewModel? FindViewModel()
    {
        var current = this as Visual;
        while (current != null)
        {
            if (current is Control control && control.DataContext is FlashcardsViewModel vm)
                return vm;

            current = current.GetVisualParent();
        }

        return null;
    }
}
