using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Modules.Mindmap.ViewModels;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Mnemo.UI.Modules.Mindmap.Views;

public partial class MindmapOverviewView : UserControl
{
    public MindmapOverviewView()
    {
        InitializeComponent();
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
        if (coordinator == null || overlayService == null)
            return;

        var button = sender as Button;
        var startTransfer = string.Equals(button?.Tag?.ToString(), "transfer", StringComparison.OrdinalIgnoreCase);
        var capabilities = coordinator.GetCapabilities("mindmaps");
        var overlay = new TransferOverlay();
        overlay.SetLocalizedChrome(
            "TransferOverlayTitle", "Mindmap",
            "TransferOverlayDescription", "Mindmap",
            "Continue", "Common",
            "Cancel", "Common");
        overlay.Initialize(capabilities, startTransfer);
        var overlayId = overlayService.CreateOverlay(overlay, new OverlayOptions
        {
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true
        }, "TransferOverlay");

        var tcs = new TaskCompletionSource<TransferOverlayResult?>();
        overlay.OnResult = result =>
        {
            overlayService.CloseOverlay(overlayId);
            tcs.TrySetResult(result);
        };
        var selected = await tcs.Task.ConfigureAwait(true);
        if (selected == null)
            return;

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel?.StorageProvider == null)
            return;

        if (selected.IsImport)
        {
            var files = await topLevel.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
            {
                AllowMultiple = false,
                Title = localization?.T("ImportMindmapsPickerTitle", "Mindmap") ?? "Import mindmaps",
                FileTypeFilter = [new FilePickerFileType(selected.Format.DisplayName) { Patterns = selected.Format.Extensions.Select(ext => $"*{ext}").ToArray() }]
            });
            var file = files.FirstOrDefault();
            if (file == null)
                return;

            var result = await coordinator.ImportAsync(new ImportExportRequest
            {
                ContentType = "mindmaps",
                FormatId = selected.Format.FormatId,
                FilePath = file.Path.LocalPath
            }).ConfigureAwait(true);
            var importSucceeded = result.IsSuccess && result.Value is { Success: true };
            var importMessage = importSucceeded
                ? localization?.T("ImportMindmapFinishedMessage", "Mindmap") ?? "Mindmap import finished."
                : result.Value?.ErrorMessage ?? result.ErrorMessage ?? localization?.T("ImportMindmapGenericError", "Mindmap") ?? "Import failed.";
            await overlayService.CreateDialogAsync(importSucceeded ? localization?.T("ImportCompleteTitle", "Common") ?? "Import complete" : localization?.T("ImportFailedTitle", "Common") ?? "Import failed", importMessage).ConfigureAwait(true);
            if (importSucceeded)
                await vm.RefreshAsync().ConfigureAwait(true);
            return;
        }

        var saveFile = await topLevel.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = localization?.T("ExportMindmapsPickerTitle", "Mindmap") ?? "Export mindmaps",
            SuggestedFileName = $"mindmaps{selected.Format.Extensions.FirstOrDefault() ?? ".mnemo"}",
            DefaultExtension = selected.Format.Extensions.FirstOrDefault()?.TrimStart('.'),
            FileTypeChoices = [new FilePickerFileType(selected.Format.DisplayName) { Patterns = selected.Format.Extensions.Select(ext => $"*{ext}").ToArray() }]
        });
        if (saveFile == null)
            return;

        var export = await coordinator.ExportAsync(new ImportExportRequest
        {
            ContentType = "mindmaps",
            FormatId = selected.Format.FormatId,
            FilePath = saveFile.Path.LocalPath
        }).ConfigureAwait(true);
        var exportSucceeded = export.IsSuccess && export.Value is { Success: true };
        var exportMessage = exportSucceeded
            ? localization?.T("ExportMindmapFinishedMessage", "Mindmap") ?? "Mindmap export finished."
            : export.Value?.ErrorMessage ?? export.ErrorMessage ?? localization?.T("ExportMindmapGenericError", "Mindmap") ?? "Export failed.";
        await overlayService.CreateDialogAsync(exportSucceeded ? localization?.T("ExportCompleteTitle", "Common") ?? "Export complete" : localization?.T("ExportFailedTitle", "Common") ?? "Export failed", exportMessage).ConfigureAwait(true);
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
        var confirm = await overlayService.CreateDialogAsync("Delete Mindmap", $"Are you sure you want to delete '{item.Name}'?", "Delete", "Cancel", severity: DialogSeverity.Destructive).ConfigureAwait(true);
        if (!string.Equals(confirm, "Delete", StringComparison.Ordinal))
            return;
        var deleted = await mindmapService.DeleteMindmapAsync(item.Id).ConfigureAwait(true);
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
        var input = new InputDialogOverlay
        {
            Title = "Rename mindmap",
            Placeholder = "Mindmap name",
            InputValue = item.Name,
            ConfirmText = "Save",
            CancelText = "Cancel"
        };
        var id = overlayService.CreateOverlay(input, new OverlayOptions { ShowBackdrop = true, CloseOnOutsideClick = true });
        var tcs = new TaskCompletionSource<string?>();
        input.OnResult = result =>
        {
            overlayService.CloseOverlay(id);
            tcs.TrySetResult(result);
        };
        var newName = (await tcs.Task.ConfigureAwait(true) ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(newName) || string.Equals(newName, item.Name, StringComparison.Ordinal))
            return;
        var existing = await mindmapService.GetMindmapAsync(item.Id).ConfigureAwait(true);
        if (!existing.IsSuccess || existing.Value == null)
            return;
        existing.Value.Title = newName;
        var saved = await mindmapService.SaveMindmapAsync(existing.Value).ConfigureAwait(true);
        if (saved.IsSuccess)
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
        var existing = await mindmapService.GetMindmapAsync(item.Id).ConfigureAwait(true);
        if (!existing.IsSuccess || existing.Value == null)
            return;
        var copy = CloneMindmap(existing.Value, $"{existing.Value.Title} Copy");
        var saved = await mindmapService.SaveMindmapAsync(copy).ConfigureAwait(true);
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
        var capabilities = coordinator.GetCapabilities("mindmaps").Where(c => c.SupportsExport).ToArray();
        var overlay = new TransferOverlay();
        overlay.SetLocalizedChrome(
            "ExportSingleMindmapTitle", "Mindmap",
            "ExportSingleMindmapDescription", "Mindmap",
            "Export", "Mindmap",
            "Cancel", "Common");
        overlay.Initialize(capabilities, defaultImport: false);
        var overlayId = overlayService.CreateOverlay(overlay, new OverlayOptions
        {
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true
        }, "TransferOverlay");
        var tcs = new TaskCompletionSource<TransferOverlayResult?>();
        overlay.OnResult = result =>
        {
            overlayService.CloseOverlay(overlayId);
            tcs.TrySetResult(result);
        };
        var selected = await tcs.Task.ConfigureAwait(true);
        if (selected == null)
            return;
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel?.StorageProvider == null)
            return;
        var saveFile = await topLevel.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = localization?.T("ExportSingleMindmapPickerTitle", "Mindmap") ?? "Export mindmap",
            SuggestedFileName = $"{SanitizeFileName(item.Name)}{selected.Format.Extensions.FirstOrDefault() ?? ".mnemo"}",
            DefaultExtension = selected.Format.Extensions.FirstOrDefault()?.TrimStart('.'),
            FileTypeChoices = [new FilePickerFileType(selected.Format.DisplayName) { Patterns = selected.Format.Extensions.Select(ext => $"*{ext}").ToArray() }]
        });
        if (saveFile == null)
            return;
        var export = await coordinator.ExportAsync(new ImportExportRequest
        {
            ContentType = "mindmaps",
            FormatId = selected.Format.FormatId,
            FilePath = saveFile.Path.LocalPath,
            Payload = item.Id
        }).ConfigureAwait(true);
        var exportSucceeded = export.IsSuccess && export.Value is { Success: true };
        var exportMessage = exportSucceeded
            ? localization?.T("ExportMindmapFinishedMessage", "Mindmap") ?? "Mindmap export finished."
            : export.Value?.ErrorMessage ?? export.ErrorMessage ?? localization?.T("ExportMindmapGenericError", "Mindmap") ?? "Export failed.";
        await overlayService.CreateDialogAsync(exportSucceeded ? localization?.T("ExportCompleteTitle", "Common") ?? "Export complete" : localization?.T("ExportFailedTitle", "Common") ?? "Export failed", exportMessage).ConfigureAwait(true);
    }

    private static Mnemo.Core.Models.Mindmap.Mindmap CloneMindmap(Mnemo.Core.Models.Mindmap.Mindmap source, string title) =>
        Mnemo.Core.Models.Mindmap.MindmapDuplicate.WithNewId(source, title);

    private static string SanitizeFileName(string value)
    {
        var name = string.IsNullOrWhiteSpace(value) ? "mindmap" : value.Trim();
        foreach (var invalid in System.IO.Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');
        return name;
    }
}
