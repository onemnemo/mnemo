using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.Views;

public partial class FlashcardDeckRow : UserControl
{
    private const double DragStartThreshold = 5.0;

    private Point _pressPosition;
    private bool _dragArmed;
    private IPointer? _armedPointer;

    public FlashcardDeckRow()
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
        base.OnDetachedFromVisualTree(e);
    }

    private void OnPointerPressedTunnel(object? sender, PointerPressedEventArgs e)
    {
        if (DataContext is not FlashcardDeckRowViewModel)
            return;
        if (e.GetCurrentPoint(this).Properties.PointerUpdateKind != PointerUpdateKind.LeftButtonPressed)
            return;
        if (e.Source is StyledElement source && IsEventFromButton(source))
            return;

        _pressPosition = e.GetPosition(this);
        _dragArmed = true;
        _armedPointer = e.Pointer;
        e.Pointer.Capture(this);
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        if (!_dragArmed || DataContext is not FlashcardDeckRowViewModel row || string.IsNullOrWhiteSpace(row.Id))
            return;

        var delta = e.GetPosition(this) - _pressPosition;
        if (Math.Abs(delta.X) <= DragStartThreshold && Math.Abs(delta.Y) <= DragStartThreshold)
            return;

        _dragArmed = false;
        var pointer = _armedPointer;
        _armedPointer = null;
        pointer?.Capture(null);

        FindFlashcardsView()?.InitiateDeckDrag(row, this, e.Pointer);
    }

    private void OnPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        var wasArmed = _dragArmed;
        _dragArmed = false;
        _armedPointer = null;
        e.Pointer.Capture(null);

        if (!wasArmed || DataContext is not FlashcardDeckRowViewModel row)
            return;
        if (e.Source is StyledElement source && IsEventFromButton(source))
            return;

        var vm = FindViewModel();
        if (vm != null && vm.OpenDeckCommand.CanExecute(row))
            vm.OpenDeckCommand.Execute(row);
    }

    private void OnPointerCaptureLost(object? sender, PointerCaptureLostEventArgs e)
    {
        _dragArmed = false;
        _armedPointer = null;
    }

    private static bool IsEventFromButton(StyledElement source)
    {
        StyledElement? current = source;
        while (current is not null)
        {
            if (current is Button)
                return true;
            current = current.Parent as StyledElement;
        }

        return false;
    }

    // --- Actions -----------------------------------------------------------

    private void OnOpenClick(object? sender, RoutedEventArgs e) => Execute(vm => vm.OpenDeckCommand);

    private void OnSettingsClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is FlashcardDeckRowViewModel row && FindFlashcardsView() is { } view)
            view.OpenDeckSettings(row);
    }

    private void OnDeleteClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is FlashcardDeckRowViewModel row && FindViewModel() is { } vm && vm.DeleteDeckCommand.CanExecute(row))
            vm.DeleteDeckCommand.Execute(row);
    }

    private async void OnRenameClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is FlashcardDeckRowViewModel row && FindFlashcardsView() is { } view)
            await view.RenameDeckAsync(row);
    }

    private async void OnExportClick(object? sender, RoutedEventArgs e)
    {
        if (DataContext is FlashcardDeckRowViewModel row && FindFlashcardsView() is { } view)
            await view.ExportDeckAsync(row, (sender as MenuItem)?.CommandParameter as string);
    }

    private void Execute(Func<FlashcardsViewModel, CommunityToolkit.Mvvm.Input.IRelayCommand<FlashcardDeckRowViewModel?>> selector)
    {
        if (DataContext is not FlashcardDeckRowViewModel row || FindViewModel() is not { } vm)
            return;
        var command = selector(vm);
        if (command.CanExecute(row))
            command.Execute(row);
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
