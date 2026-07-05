using Avalonia;
using Avalonia.Controls;
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
