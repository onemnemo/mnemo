using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Components.Overlays.Transfer;
using Mnemo.UI.Controls;
using Mnemo.UI.Modules.Notes.ViewModels;

namespace Mnemo.UI.Modules.Notes.Views;

public partial class NoteTreeRow : UserControl
{
    private const double DragStartThreshold = 5.0;
    private const string FolderItemClass = "folder-item";
    private const double DoubleClickMaxMs = 400.0;
    private const double DoubleClickMaxPx = 5.0;

    private Point _pressPosition;
    private bool _dragArmed;
    private IPointer? _armedPointer;
    private MnemoTreeViewItem? _treeViewItem;
    private DateTime _lastClickTime = DateTime.MinValue;
    private Point _lastClickPosition;

    public NoteTreeRow()
    {
        InitializeComponent();
    }

    protected override void OnAttachedToVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (RowBorder == null) return;

        AddHandler(PointerPressedEvent, OnPointerPressedTunnel, RoutingStrategies.Tunnel, handledEventsToo: true);
        AddHandler(PointerMovedEvent, OnPointerMoved, RoutingStrategies.Bubble);
        AddHandler(PointerReleasedEvent, OnPointerReleased, RoutingStrategies.Bubble);
        AddHandler(PointerCaptureLostEvent, OnPointerCaptureLost, RoutingStrategies.Bubble);
        // PointerEntered/Exited are direct events; attach them on RowBorder directly
        RowBorder.PointerEntered += OnRowPointerEntered;
        RowBorder.PointerExited += OnRowPointerExited;

        _treeViewItem = this.FindAncestorOfType<MnemoTreeViewItem>();
        if (_treeViewItem != null)
        {
            UpdateSelectedClass(_treeViewItem.IsSelected);
            _treeViewItem.PropertyChanged += OnTreeViewItemPropertyChanged;
            if (DataContext is NoteTreeItemViewModel item && item.IsFolder)
                _treeViewItem.Classes.Add(FolderItemClass);
        }
    }

    protected override void OnDetachedFromVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        if (_treeViewItem != null)
        {
            _treeViewItem.PropertyChanged -= OnTreeViewItemPropertyChanged;
            _treeViewItem.Classes.Remove(FolderItemClass);
            _treeViewItem = null;
        }

        if (RowBorder != null)
        {
            RowBorder.Classes.Remove("selected");
            RowBorder.PointerEntered -= OnRowPointerEntered;
            RowBorder.PointerExited -= OnRowPointerExited;
        }

        RemoveHandler(PointerPressedEvent, OnPointerPressedTunnel);
        RemoveHandler(PointerMovedEvent, OnPointerMoved);
        RemoveHandler(PointerReleasedEvent, OnPointerReleased);
        RemoveHandler(PointerCaptureLostEvent, OnPointerCaptureLost);

        base.OnDetachedFromVisualTree(e);
    }

    private void OnTreeViewItemPropertyChanged(object? sender, AvaloniaPropertyChangedEventArgs e)
    {
        if (e.Property == MnemoTreeViewItem.IsSelectedProperty && _treeViewItem != null)
            UpdateSelectedClass(_treeViewItem.IsSelected);
    }

    private void UpdateSelectedClass(bool isSelected)
    {
        if (RowBorder == null) return;
        if (DataContext is NoteTreeItemViewModel item && item.IsFolder)
        {
            RowBorder.Classes.Remove("selected");
            return;
        }
        if (isSelected)
            RowBorder.Classes.Add("selected");
        else
            RowBorder.Classes.Remove("selected");
    }

    private bool IsPointerOnMoreButton(PointerEventArgs e)
    {
        if (MoreButton == null) return false;
        var pt = e.GetPosition(MoreButton);
        var w = MoreButton.Bounds.Width;
        var h = MoreButton.Bounds.Height;
        return pt.X >= 0 && pt.Y >= 0 && pt.X <= w && pt.Y <= h;
    }

    private void OnRowPointerEntered(object? sender, PointerEventArgs e)
    {
        var coordinator = FindDragCoordinator();
        if (coordinator?.IsDragging == true) return;

        if (MoreButton != null) MoreButton.Opacity = 1.0;
    }

    private void OnRowPointerExited(object? sender, PointerEventArgs e)
    {
        var coordinator = FindDragCoordinator();
        if (coordinator?.IsDragging == true) return;

        if (MoreButton != null) MoreButton.Opacity = 0.0;
    }

    private bool IsEditing => NameTextBox?.IsVisible == true;

    private void OnPointerPressedTunnel(object? sender, PointerPressedEventArgs e)
    {
        if (IsEditing) return;
        if (DataContext is not NoteTreeItemViewModel item) return;
        if (e.GetCurrentPoint(this).Properties.PointerUpdateKind != PointerUpdateKind.LeftButtonPressed) return;
        if (IsPointerOnMoreButton(e)) return;

        var vm = FindNotesViewModel();

        if (!item.IsFolder && vm != null)
            vm.SelectedTreeItem = item;

        var now = DateTime.UtcNow;
        var pos = e.GetPosition(this);
        var elapsed = (now - _lastClickTime).TotalMilliseconds;
        var dist = Math.Sqrt(Math.Pow(pos.X - _lastClickPosition.X, 2) + Math.Pow(pos.Y - _lastClickPosition.Y, 2));

        if (elapsed <= DoubleClickMaxMs && dist <= DoubleClickMaxPx)
        {
            // Double-click: start rename
            _lastClickTime = DateTime.MinValue;
            _dragArmed = false;
            e.Pointer.Capture(null);
            e.Handled = true;
            BeginRename(item);
            return;
        }

        _lastClickTime = now;
        _lastClickPosition = pos;

        // Arm drag: capture pointer so we get move/release even when other controls handle the press
        _pressPosition = pos;
        _dragArmed = true;
        _armedPointer = e.Pointer;

        // Mark handled + capture so drag threshold can run; folder expand uses chevron or release-without-drag.
        e.Handled = true;
        e.Pointer.Capture(this);
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        if (IsEditing) return;
        if (!_dragArmed || DataContext is not NoteTreeItemViewModel item) return;

        var current = e.GetPosition(this);
        var delta = current - _pressPosition;
        if (Math.Abs(delta.X) <= DragStartThreshold && Math.Abs(delta.Y) <= DragStartThreshold)
            return;

        // Threshold exceeded: hand off to DragCoordinator
        _dragArmed = false;
        var pointer = _armedPointer;
        _armedPointer = null;

        // Release our capture first; DragCoordinator will capture _paneRoot
        pointer?.Capture(null);

        var notesView = FindNotesView();
        notesView?.InitiateDrag(item, this, e.Pointer);

        if (MoreButton != null) MoreButton.Opacity = 0.0;
    }

    private void OnPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (IsEditing) { e.Pointer.Capture(null); return; }
        // Folder: toggle only on a true click (never crossed drag threshold). Drag leaves _dragArmed false.
        if (DataContext is NoteTreeItemViewModel folderItem && folderItem.IsFolder && _dragArmed)
            folderItem.IsExpanded = !folderItem.IsExpanded;

        e.Pointer.Capture(null);
        _dragArmed = false;
        _armedPointer = null;
    }

    private void OnPointerCaptureLost(object? sender, PointerCaptureLostEventArgs e)
    {
        _dragArmed = false;
        _armedPointer = null;
    }

    private NotesViewModel? FindNotesViewModel()
    {
        var current = this as Visual;
        while (current != null)
        {
            if (current is Control c && c.DataContext is NotesViewModel vm)
                return vm;
            current = current.GetVisualParent();
        }
        return null;
    }

    private NotesView? FindNotesView()
    {
        var current = this as Visual;
        while (current != null)
        {
            if (current is NotesView nv) return nv;
            current = current.GetVisualParent();
        }
        return null;
    }

    private DragCoordinator? FindDragCoordinator()
    {
        return FindNotesView()?._dragCoordinator;
    }

    private async void OnDeleteClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control c || c.Tag is not NoteTreeItemViewModel item) return;
        var vm = FindNotesViewModel();
        if (vm == null) return;

        var app = Application.Current as App;
        var overlay = app?.Services?.GetService<IOverlayService>();
        var loc = app?.Services?.GetService<ILocalizationService>();
        if (overlay == null || loc == null) return;

        var title = item.IsFolder
            ? loc.T("DeleteFolderConfirmTitle", "Notes")
            : loc.T("DeleteNoteConfirmTitle", "Notes");
        var message = item.IsFolder
            ? string.Format(loc.T("DeleteFolderConfirmMessage", "Notes"), item.Name)
            : string.Format(loc.T("DeleteNoteConfirmMessage", "Notes"), item.Name);

        var deleteLabel = loc.T("Delete", "Notes");
        var cancel = loc.T("Cancel", "Common");
        var result = await overlay.CreateDialogAsync(title, message, deleteLabel, cancel, severity: DialogSeverity.Destructive).ConfigureAwait(true);
        if (result != deleteLabel)
            return;

        if (item.IsFolder)
            await vm.DeleteFolderCommand.ExecuteAsync(item).ConfigureAwait(false);
        else
            await vm.DeleteNoteCommand.ExecuteAsync(item).ConfigureAwait(false);
    }

    private async void OnMoveUpClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control c || c.Tag is not NoteTreeItemViewModel item) return;
        var vm = FindNotesViewModel();
        if (vm == null) return;
        await vm.MoveItemUpCommand.ExecuteAsync(item);
    }

    private async void OnMoveDownClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control c || c.Tag is not NoteTreeItemViewModel item) return;
        var vm = FindNotesViewModel();
        if (vm == null) return;
        await vm.MoveItemDownCommand.ExecuteAsync(item);
    }

    private void OnNewNoteClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control c || c.Tag is not NoteTreeItemViewModel item) return;
        var vm = FindNotesViewModel();
        if (vm == null) return;
        _ = vm.NewNoteCommand.ExecuteAsync(item);
    }

    private void OnDuplicateClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control c || c.Tag is not NoteTreeItemViewModel item) return;
        if (item.Note == null) return;
        var vm = FindNotesViewModel();
        if (vm == null) return;
        _ = vm.DuplicateNoteCommand.ExecuteAsync(item);
    }

    private void OnRenameClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control c || c.Tag is not NoteTreeItemViewModel item) return;
        BeginRename(item);
    }

    private async void OnExportClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control c || c.Tag is not NoteTreeItemViewModel item || item.Note == null)
            return;
        var app = Application.Current as App;
        var services = app?.Services;
        if (services == null)
            return;

        var coordinator = services.GetService<IImportExportCoordinator>();
        var overlayService = services.GetService<IOverlayService>();
        var localization = services.GetService<ILocalizationService>();
        if (coordinator == null || overlayService == null)
            return;

        if (localization == null)
            return;

        var exportFormats = new List<TransferExportFormatOption>();
        foreach (var capability in coordinator.GetCapabilities("notes").Where(x => x.SupportsExport))
        {
            var (nameKey, captionKey) = capability.FormatId switch
            {
                "notes.markdown" => ("TransferFormatMarkdown", "TransferFormatCaptionMarkdown"),
                "notes.mnemo" => ("TransferFormatArchive", "TransferFormatCaptionArchive"),
                _ => ((string?)null, (string?)null)
            };
            exportFormats.Add(new TransferExportFormatOption
            {
                FormatId = capability.FormatId,
                ExtensionLabel = capability.Extensions.FirstOrDefault() ?? ".mnemo",
                DisplayName = nameKey != null ? localization.T(nameKey, "Common") : capability.DisplayName,
                Caption = captionKey != null ? localization.T(captionKey, "Common") : null,
                Extensions = capability.Extensions
            });
        }

        var requestedFormatId = (sender as MenuItem)?.CommandParameter as string;
        TransferDialogResult? choice;
        if (!string.IsNullOrWhiteSpace(requestedFormatId))
        {
            var preferred = exportFormats.FirstOrDefault(x => string.Equals(x.FormatId, requestedFormatId, StringComparison.Ordinal));
            if (preferred == null)
            {
                await overlayService.CreateDialogAsync(
                    localization.T("ExportFormatUnavailableTitle", "Notes"),
                    localization.T("ExportFormatUnavailableMessage", "Notes")).ConfigureAwait(true);
                return;
            }

            choice = new TransferDialogResult { IsImport = false, Format = preferred };
        }
        else
        {
            choice = await TransferDialog.ShowAsync(overlayService, new TransferDialogContext
            {
                ContentType = "notes",
                Direction = TransferDialogDirection.ExportOnly,
                ImportTitle = localization.T("TransferExportNoteTitle", "Notes"),
                ExportTitle = localization.T("TransferExportNoteTitle", "Notes"),
                ExportSubtitle = string.Format(localization.T("TransferFromFormat", "Notes"), item.Name),
                ItemNounSingular = localization.T("TransferNounSingular", "Notes"),
                ItemNounPlural = localization.T("TransferNounPlural", "Notes"),
                ExportFormats = exportFormats,
                Coordinator = coordinator
            }).ConfigureAwait(true);
        }

        if (choice?.Format == null)
            return;

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel?.StorageProvider == null)
            return;
        var ext = choice.Format.Extensions.FirstOrDefault() ?? ".mnemo";
        var save = await topLevel.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = localization.T("TransferExportNoteTitle", "Notes"),
            SuggestedFileName = $"{SanitizeFileName(item.Name)}{ext}",
            DefaultExtension = ext.TrimStart('.'),
            FileTypeChoices = [new FilePickerFileType(choice.Format.DisplayName) { Patterns = choice.Format.Extensions.Select(e => $"*{e}").ToArray() }]
        });
        if (save == null)
            return;

        var result = await coordinator.ExportAsync(new ImportExportRequest
        {
            ContentType = "notes",
            FormatId = choice.Format.FormatId,
            FilePath = save.Path.LocalPath,
            Payload = item.Note
        }).ConfigureAwait(true);
        var succeeded = result.IsSuccess && result.Value is { Success: true };
        await overlayService.CreateDialogAsync(
            succeeded ? localization.T("ExportCompleteTitle", "Common") : localization.T("ExportFailedTitle", "Common"),
            succeeded
                ? localization.T("TransferExportFinished", "Common")
                : result.Value?.ErrorMessage ?? result.ErrorMessage ?? localization.T("TransferExportFailed", "Common")).ConfigureAwait(true);
    }

    private TopLevel? _editTopLevel;

    private void BeginRename(NoteTreeItemViewModel item)
    {
        if (!item.IsRenamableFolder && item.Note == null) return;
        NameTextBlock!.IsVisible = false;
        NameTextBox!.IsVisible = true;
        NameTextBox.Text = item.Name;
        NameTextBox.CaretIndex = NameTextBox.Text?.Length ?? 0;
        NameTextBox.SelectAll();
        Dispatcher.UIThread.Post(() => NameTextBox.Focus(), DispatcherPriority.Loaded);

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
        if (NameTextBox == null || !NameTextBox.IsVisible) { StopGlobalEditListener(); return; }
        // If the press is inside the TextBox, let it through normally.
        var pos = e.GetPosition(NameTextBox);
        if (pos.X >= 0 && pos.Y >= 0 && pos.X <= NameTextBox.Bounds.Width && pos.Y <= NameTextBox.Bounds.Height)
            return;
        // Press is outside — commit and stop listening.
        StopGlobalEditListener();
        CommitRename();
    }

    private void OnNameEditLostFocus(object? sender, RoutedEventArgs e)
    {
        // Only commit on real focus loss (not when we're already committing via global press handler).
        if (IsEditing) CommitRename();
    }

    private void OnNameEditKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) { CommitRename(); e.Handled = true; }
        else if (e.Key == Key.Escape) { CancelRename(); e.Handled = true; }
    }

    private async void CommitRename()
    {
        if (!NameTextBox!.IsVisible || DataContext is not NoteTreeItemViewModel item) return;
        StopGlobalEditListener();
        var newName = (NameTextBox.Text ?? "").Trim();
        var vm = FindNotesViewModel();

        if (item.IsRenamableFolder)
        {
            if (string.IsNullOrEmpty(newName)) newName = item.Name;
            item.SetFolderName(newName);
            if (vm != null)
                await vm.RenameFolderCommand.ExecuteAsync(item);
        }
        else if (item.Note != null)
        {
            if (string.IsNullOrEmpty(newName)) newName = item.Name;
            if (vm != null)
                await vm.SaveNoteWithContentAsync(item.Note, null, newName);
            else
                item.Note.Title = newName;
            item.NotifyNameChanged();
        }

        NameTextBox.IsVisible = false;
        NameTextBlock!.IsVisible = true;
    }

    private void CancelRename()
    {
        if (!NameTextBox!.IsVisible) return;
        StopGlobalEditListener();
        NameTextBox.IsVisible = false;
        NameTextBlock!.IsVisible = true;
    }

    private static string SanitizeFileName(string value)
    {
        var name = string.IsNullOrWhiteSpace(value) ? "note" : value.Trim();
        foreach (var invalid in System.IO.Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');
        return name;
    }
}
