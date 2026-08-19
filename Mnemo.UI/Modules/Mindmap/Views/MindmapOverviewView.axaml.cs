using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Components.Overlays.Transfer;
using Mnemo.UI.Modules.Mindmap.ViewModels;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Mnemo.UI.Modules.Mindmap.Views;

public partial class MindmapOverviewView : UserControl
{
    private static readonly DataFormat<string> MapIdFormat =
        DataFormat.CreateStringApplicationFormat("mnemo-mindmap-id");
    private const double DragThreshold = 6;
    private Point _pressOrigin;
    private MindmapItemViewModel? _dragCandidate;
    private PointerPressedEventArgs? _pressArgs;

    public MindmapOverviewView()
    {
        InitializeComponent();
    }

    // --- Drag a map card onto a folder to nest it -------------------------

    private void OnMapCardPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (sender is Control { DataContext: MindmapItemViewModel item } control &&
            e.GetCurrentPoint(control).Properties.IsLeftButtonPressed)
        {
            _dragCandidate = item;
            _pressOrigin = e.GetPosition(this);
            _pressArgs = e;
        }
    }

    private async void OnMapCardPointerMoved(object? sender, PointerEventArgs e)
    {
        if (_dragCandidate is null || _pressArgs is null || !e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            return;

        var delta = e.GetPosition(this) - _pressOrigin;
        if (System.Math.Abs(delta.X) < DragThreshold && System.Math.Abs(delta.Y) < DragThreshold)
            return;

        var transfer = new DataTransfer();
        transfer.Add(DataTransferItem.Create(MapIdFormat, _dragCandidate.Id));
        var pressArgs = _pressArgs;
        _dragCandidate = null;
        _pressArgs = null;
        await DragDrop.DoDragDropAsync(pressArgs, transfer, DragDropEffects.Move);
    }

    private void OnMapCardPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        _dragCandidate = null;
        _pressArgs = null;
    }

    private void OnFolderDragOver(object? sender, DragEventArgs e)
    {
        e.DragEffects = e.DataTransfer.Contains(MapIdFormat) ? DragDropEffects.Move : DragDropEffects.None;
        e.Handled = true;
    }

    private async void OnFolderDrop(object? sender, DragEventArgs e)
    {
        if (DataContext is not MindmapOverviewViewModel vm ||
            sender is not Control { DataContext: MindmapFolderItemViewModel folder })
            return;
        var mapId = e.DataTransfer.TryGetValue(MapIdFormat);
        if (!string.IsNullOrEmpty(mapId))
            await vm.MoveMapToFolderAsync(mapId, folder.Id);
        e.Handled = true;
    }

    private async void OnCrumbDrop(object? sender, DragEventArgs e)
    {
        if (DataContext is not MindmapOverviewViewModel vm ||
            sender is not Control { DataContext: MindmapBreadcrumbSegment segment })
            return;
        var mapId = e.DataTransfer.TryGetValue(MapIdFormat);
        if (!string.IsNullOrEmpty(mapId))
            await vm.MoveMapToFolderAsync(mapId, segment.Id);
        e.Handled = true;
    }

    private async void OnTransferClick(object? sender, RoutedEventArgs e)
    {
        var app = Application.Current as App;
        var services = app?.Services;
        if (services == null || DataContext is not MindmapOverviewViewModel vm)
            return;

        var coordinator = services.GetService<IImportExportCoordinator>();
        var overlayService = services.GetService<IOverlayService>();
        var localization = services.GetService<ILocalizationService>();
        if (coordinator == null || overlayService == null || localization == null)
            return;

        var button = sender as Button;
        var startTransfer = string.Equals(button?.Tag?.ToString(), "transfer", StringComparison.OrdinalIgnoreCase);
        var context = new TransferDialogContext
        {
            ContentType = "mindmaps",
            Direction = TransferDialogDirection.Both,
            StartWithImport = startTransfer,
            ImportTitle = localization.T("TransferImportTitle", "Mindmap"),
            ExportTitle = localization.T("TransferExportTitle", "Mindmap"),
            ItemNounSingular = localization.T("TransferNounSingular", "Mindmap"),
            ItemNounPlural = localization.T("TransferNounPlural", "Mindmap"),
            ConflictQuestion = localization.T("TransferConflictQuestion", "Mindmap"),
            ImportCapabilities = coordinator.GetCapabilities("mindmaps").Where(c => c.SupportsImport).ToArray(),
            ExportFormats = BuildMindmapExportFormats(coordinator, localization),
            ExportScopes =
            [
                new TransferExportScopeOption
                {
                    ScopeId = "all",
                    Label = localization.T("TransferScopeAllMindmaps", "Mindmap"),
                    Count = vm.AllItems.Count
                }
            ],
            Coordinator = coordinator
        };

        var choice = await TransferDialog.ShowAsync(overlayService, context).ConfigureAwait(true);
        if (choice == null)
            return;

        if (choice.IsImport)
        {
            var summary = await TransferImportRunner.RunAsync(coordinator, "mindmaps", choice).ConfigureAwait(true);
            await TransferImportRunner.ShowSummaryAsync(overlayService, localization, context, summary).ConfigureAwait(true);
            if (summary.AnySucceeded)
                await vm.RefreshAsync().ConfigureAwait(true);
            return;
        }

        await ExportMindmapsAsync(overlayService, localization, coordinator, choice, payload: null, suggestedName: "mindmaps").ConfigureAwait(true);
    }

    private static IReadOnlyList<TransferExportFormatOption> BuildMindmapExportFormats(IImportExportCoordinator coordinator, ILocalizationService localization)
    {
        return coordinator.GetCapabilities("mindmaps")
            .Where(c => c.SupportsExport)
            .Select(c => new TransferExportFormatOption
            {
                FormatId = c.FormatId,
                ExtensionLabel = c.Extensions.FirstOrDefault() ?? ".mnemo",
                DisplayName = c.FormatId == "mindmaps.mnemo" ? localization.T("TransferFormatArchive", "Common") : c.DisplayName,
                Caption = c.FormatId == "mindmaps.mnemo" ? localization.T("TransferFormatCaptionArchive", "Common") : null,
                Extensions = c.Extensions
            })
            .ToArray();
    }

    private async Task ExportMindmapsAsync(
        IOverlayService overlayService,
        ILocalizationService localization,
        IImportExportCoordinator coordinator,
        TransferDialogResult choice,
        object? payload,
        string suggestedName)
    {
        if (choice.Format == null)
            return;
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel?.StorageProvider == null)
            return;

        var extension = choice.Format.Extensions.FirstOrDefault() ?? ".mnemo";
        var saveFile = await topLevel.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = localization.T("TransferExportTitle", "Mindmap"),
            SuggestedFileName = $"{suggestedName}{extension}",
            DefaultExtension = extension.TrimStart('.'),
            FileTypeChoices = [new FilePickerFileType(choice.Format.DisplayName) { Patterns = choice.Format.Extensions.Select(ext => $"*{ext}").ToArray() }]
        });
        if (saveFile == null)
            return;

        var export = await coordinator.ExportAsync(new ImportExportRequest
        {
            ContentType = "mindmaps",
            FormatId = choice.Format.FormatId,
            FilePath = saveFile.Path.LocalPath,
            Payload = payload
        }).ConfigureAwait(true);
        var exportSucceeded = export.IsSuccess && export.Value is { Success: true };
        await overlayService.CreateDialogAsync(
            exportSucceeded ? localization.T("ExportCompleteTitle", "Common") : localization.T("ExportFailedTitle", "Common"),
            exportSucceeded
                ? localization.T("TransferExportFinished", "Common")
                : export.Value?.ErrorMessage ?? export.ErrorMessage ?? localization.T("TransferExportFailed", "Common")).ConfigureAwait(true);
    }

    private async void OnMindmapDeleteClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: MindmapItemViewModel item } || DataContext is not MindmapOverviewViewModel vm)
            return;
        var app = Application.Current as App;
        var services = app?.Services;
        var mindmapService = services?.GetService<IMindmapService>();
        var overlayService = services?.GetService<IOverlayService>();
        if (mindmapService == null || overlayService == null)
            return;
        var confirm = await overlayService.CreateDialogAsync("Delete Mindmap", $"Are you sure you want to delete '{item.Name}'?", "Delete", "Cancel", confirmIconName: "Common/trash", severity: DialogSeverity.Destructive).ConfigureAwait(true);
        if (!string.Equals(confirm, "Delete", StringComparison.Ordinal))
            return;
        var deleted = await mindmapService.DeleteAsync(item.Id).ConfigureAwait(true);
        await overlayService.CreateDialogAsync(deleted.IsSuccess ? "Deleted" : "Delete failed",
            deleted.IsSuccess ? "Mindmap deleted." : deleted.ErrorMessage ?? "Delete failed.").ConfigureAwait(true);
        if (deleted.IsSuccess)
            await vm.RefreshAsync().ConfigureAwait(true);
    }

    private async void OnMindmapRenameClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: MindmapItemViewModel item } || DataContext is not MindmapOverviewViewModel vm)
            return;
        var app = Application.Current as App;
        var services = app?.Services;
        var mindmapService = services?.GetService<IMindmapService>();
        var overlayService = services?.GetService<IOverlayService>();
        if (mindmapService == null || overlayService == null)
            return;
        var newName = (await overlayService.CreateInputDialogAsync(
            title: "Rename mindmap",
            confirmText: "Save",
            cancelText: "Cancel",
            placeholder: "Mindmap name",
            initialValue: item.Name,
            confirmIconName: "Common/pencil").ConfigureAwait(true) ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(newName) || string.Equals(newName, item.Name, StringComparison.Ordinal))
            return;
        var saved = await mindmapService.RenameAsync(item.Id, newName).ConfigureAwait(true);
        if (saved.IsSuccess && saved.Value is { Success: true })
            await vm.RefreshAsync().ConfigureAwait(true);
    }

    private async void OnMindmapDuplicateClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: MindmapItemViewModel item } || DataContext is not MindmapOverviewViewModel vm)
            return;
        var app = Application.Current as App;
        var services = app?.Services;
        var mindmapService = services?.GetService<IMindmapService>();
        if (mindmapService == null)
            return;
        var saved = await mindmapService.DuplicateAsync(item.Id, $"{item.Name} Copy").ConfigureAwait(true);
        if (saved.IsSuccess)
            await vm.RefreshAsync().ConfigureAwait(true);
    }

    private async void OnMindmapExportClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: MindmapItemViewModel item })
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

        var choice = await TransferDialog.ShowAsync(overlayService, new TransferDialogContext
        {
            ContentType = "mindmaps",
            Direction = TransferDialogDirection.ExportOnly,
            ImportTitle = localization.T("TransferExportSingleTitle", "Mindmap"),
            ExportTitle = localization.T("TransferExportSingleTitle", "Mindmap"),
            ExportSubtitle = string.Format(localization.T("TransferFromFormat", "Mindmap"), item.Name),
            ItemNounSingular = localization.T("TransferNounSingular", "Mindmap"),
            ItemNounPlural = localization.T("TransferNounPlural", "Mindmap"),
            ExportFormats = BuildMindmapExportFormats(coordinator, localization),
            Coordinator = coordinator
        }).ConfigureAwait(true);
        if (choice == null)
            return;

        await ExportMindmapsAsync(overlayService, localization, coordinator, choice, payload: item.Id, suggestedName: SanitizeFileName(item.Name)).ConfigureAwait(true);
    }

    private static string SanitizeFileName(string value)
    {
        var name = string.IsNullOrWhiteSpace(value) ? "mindmap" : value.Trim();
        foreach (var invalid in System.IO.Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');
        return name;
    }
}
