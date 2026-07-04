using System;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Mnemo.UI.Modules.Notes.ViewModels;

namespace Mnemo.UI.Modules.Notes.Views;

public partial class NotesView : UserControl
{
    internal DragCoordinator? _dragCoordinator;

    public NotesView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        _cachedBlockEditor = null;
        if (DataContext is not NotesViewModel vm)
            return;

        vm.PropertyChanged -= OnViewModelPropertyChanged;
        vm.PropertyChanged += OnViewModelPropertyChanged;

        if (vm.SelectedNote != null)
            Dispatcher.UIThread.Post(() => LoadBlocksForCurrentNote(), DispatcherPriority.Loaded);
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(NotesViewModel.EditorMaxWidth))
        {
            _lastEditorDocumentSizeForZoom = default;
            SyncEditorDocumentLayoutWidth();
            ApplyEditorCameraZoom();
            Dispatcher.UIThread.Post(() =>
            {
                SyncEditorDocumentLayoutWidth();
                ApplyEditorCameraZoom();
                ResetEditorHorizontalOffset();
            }, DispatcherPriority.Loaded);
            return;
        }

        if (e.PropertyName != nameof(NotesViewModel.SelectedNote))
            return;

        if (DataContext is NotesViewModel vm)
            vm.ClearHistoryOnNoteSwitch(_previousSelectedNote, vm.SelectedNote);
        _previousSelectedNote = (sender as NotesViewModel)?.SelectedNote;

        CloseIndexPopover();
        ResetEditorView();
        FlushPendingSave();
        Dispatcher.UIThread.Post(() => LoadBlocksForCurrentNote(), DispatcherPriority.Loaded);
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);

        var titleBox = this.FindControl<TextBox>("NoteTitleBox");
        if (titleBox != null)
            titleBox.LostFocus += OnTitleBoxLostFocus;

        SetupDragCoordinator();
        SetupEditorScrollPanAndGutter();
        SetupEditorCameraZoom();
        SetupNoteIndex();
        InitializeShortcutHints();
        WireKeybindHandlers();
    }

    private void SetupDragCoordinator()
    {
        AddHandler(PointerMovedEvent, OnPanePointerMoved, RoutingStrategies.Tunnel);
        AddHandler(PointerReleasedEvent, OnPanePointerReleased, RoutingStrategies.Tunnel);
    }

    private void EnsureDragCoordinator()
    {
        if (_dragCoordinator != null) return;

        var overlayCanvas = this.GetVisualDescendants().OfType<Canvas>().FirstOrDefault(c => c.Name == "DragOverlayCanvas");
        var scrollViewer = this.GetVisualDescendants().OfType<ScrollViewer>().FirstOrDefault(s => s.Name == "SidebarScrollViewer");
        var paneRoot = this.GetVisualDescendants().OfType<Border>().FirstOrDefault(b => b.Name == "SidebarPaneBorder");

        if (overlayCanvas == null || scrollViewer == null || paneRoot == null) return;

        _dragCoordinator = new DragCoordinator(overlayCanvas, scrollViewer, paneRoot);
    }

    private void OnPanePointerMoved(object? sender, PointerEventArgs e) =>
        _dragCoordinator?.OnPointerMoved(e);

    private async void OnPanePointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (_dragCoordinator == null || !_dragCoordinator.IsDragging) return;
        if (DataContext is not NotesViewModel vm) return;

        var source = _dragCoordinator.SourceItem;
        var drop = _dragCoordinator.OnPointerReleased(e);

        if (source == null) return;

        if (drop == null)
        {
            await vm.MoveTreeItemToRootAsync(source);
            return;
        }

        bool insertAfter = drop.Value.Mode == DragCoordinator.DropMode.InsertBelow;
        bool dropOnFolder = drop.Value.Mode == DragCoordinator.DropMode.DropIntoFolder;
        await vm.MoveTreeItemAsync(source, drop.Value.Target, dropOnFolder, insertAfter);
    }

    public void InitiateDrag(NoteTreeItemViewModel item, NoteTreeRow row, IPointer pointer)
    {
        EnsureDragCoordinator();
        _dragCoordinator?.BeginDrag(item, row, pointer);
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        _dragCoordinator?.Dispose();
        _dragCoordinator = null;

        TeardownKeybindHandlers();
        TeardownSave();
        TeardownEditorScrollPanAndGutter();
        TeardownEditorCameraZoom();
        TeardownNoteIndex();

        RemoveHandler(PointerMovedEvent, OnPanePointerMoved);
        RemoveHandler(PointerReleasedEvent, OnPanePointerReleased);

        if (DataContext is NotesViewModel vm)
            vm.PropertyChanged -= OnViewModelPropertyChanged;

        base.OnDetachedFromVisualTree(e);
    }
}
