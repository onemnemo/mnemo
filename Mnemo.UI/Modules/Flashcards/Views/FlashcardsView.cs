using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Mnemo.Core.Models.Flashcards;
using Mnemo.UI.Modules.Flashcards.ViewModels;
using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Components.Overlays.Transfer;
using System.Collections.Generic;

namespace Mnemo.UI.Modules.Flashcards.Views;

public partial class FlashcardsView : UserControl
{
    internal FlashcardsDragCoordinator? _dragCoordinator;

    public FlashcardsView()
    {
        InitializeComponent();
        AddHandler(PointerMovedEvent, OnRootPointerMoved, RoutingStrategies.Tunnel);
        AddHandler(PointerReleasedEvent, OnRootPointerReleased, RoutingStrategies.Tunnel);
        AddHandler(KeyDownEvent, OnRootKeyDown, RoutingStrategies.Tunnel);
    }

    private void OnRootKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && _dragCoordinator?.IsDragging == true)
        {
            _dragCoordinator.CancelDrag();
            e.Handled = true;
        }
    }

    private void EnsureDragCoordinator()
    {
        if (_dragCoordinator != null)
            return;

        if (this.FindControl<Canvas>("DragOverlayCanvas") is not Canvas overlay)
            return;

        var treeSurface = this.FindControl<Control>("LibraryTreeSurface");
        _dragCoordinator = new FlashcardsDragCoordinator(overlay, this, treeSurface);
    }

    public void InitiateFolderDrag(FlashcardFolderItemViewModel item, FlashcardFolderRow row, IPointer pointer)
    {
        EnsureDragCoordinator();
        _dragCoordinator?.BeginFolderDrag(item, row, pointer);
    }

    public void InitiateDeckDrag(FlashcardDeckRowViewModel deck, FlashcardDeckRow row, IPointer pointer)
    {
        EnsureDragCoordinator();
        _dragCoordinator?.BeginDeckDrag(deck, row, pointer);
    }

    private void OnRootPointerMoved(object? sender, PointerEventArgs e)
    {
        if (_dragCoordinator?.IsDragging != true)
            return;

        _dragCoordinator.OnPointerMoved(e);
    }

    private async void OnRootPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (_dragCoordinator?.IsDragging != true || DataContext is not FlashcardsViewModel vm)
            return;

        var drop = _dragCoordinator.CompleteDrag(e.Pointer);
        if (drop is null)
            return;

        if (drop.Value.SourceKind == FlashcardsDragCoordinator.DragSourceKind.Deck)
        {
            if (drop.Value.IsRootTarget)
            {
                await vm.MoveDeckToFolderAsync(drop.Value.SourceId, null);
                return;
            }

            if (!string.IsNullOrWhiteSpace(drop.Value.TargetFolderId))
                await vm.MoveDeckToFolderAsync(drop.Value.SourceId, drop.Value.TargetFolderId);
            return;
        }

        if (drop.Value.SourceKind == FlashcardsDragCoordinator.DragSourceKind.Folder)
        {
            if (drop.Value.IsRootTarget)
            {
                await vm.MoveFolderAsync(drop.Value.SourceId, null, dropIntoFolder: false, insertAfterTarget: false);
                return;
            }

            if (!string.IsNullOrWhiteSpace(drop.Value.TargetFolderId) &&
                drop.Value.FolderMode != FlashcardsDragCoordinator.FolderDropMode.None)
            {
                await vm.MoveFolderAsync(
                    drop.Value.SourceId,
                    drop.Value.TargetFolderId,
                    drop.Value.FolderMode == FlashcardsDragCoordinator.FolderDropMode.DropIntoFolder,
                    drop.Value.FolderMode == FlashcardsDragCoordinator.FolderDropMode.InsertBelow);
            }
        }
    }

    // --- Transfer (page-level import/export) -------------------------------

    private async void OnTransferClick(object? sender, RoutedEventArgs e)
    {
        var app = Application.Current as App;
        var services = app?.Services;
        if (services == null || DataContext is not FlashcardsViewModel vm)
            return;

        var coordinator = services.GetService<IImportExportCoordinator>();
        var overlayService = services.GetService<IOverlayService>();
        var localization = services.GetService<ILocalizationService>();
        if (coordinator == null || overlayService == null || localization == null)
            return;

        var button = sender as Control;
        var startTransfer = string.Equals(button?.Tag?.ToString(), "transfer", StringComparison.OrdinalIgnoreCase);
        var filteredDeckIds = vm.LibraryRows
            .OfType<FlashcardDeckRowViewModel>()
            .Where(deck => !string.IsNullOrWhiteSpace(deck.Id))
            .Select(deck => deck.Id!)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        var context = new TransferDialogContext
        {
            ContentType = "flashcards",
            Direction = TransferDialogDirection.Both,
            StartWithImport = startTransfer,
            ImportTitle = localization.T("TransferImportTitle", "Flashcards"),
            ExportTitle = localization.T("TransferExportTitle", "Flashcards"),
            ItemNounSingular = localization.T("TransferNounSingular", "Flashcards"),
            ItemNounPlural = localization.T("TransferNounPlural", "Flashcards"),
            ConflictQuestion = localization.T("TransferConflictQuestion", "Flashcards"),
            ImportCapabilities = coordinator.GetCapabilities("flashcards").Where(c => c.SupportsImport).ToArray(),
            ExportFormats = BuildFlashcardsExportFormats(coordinator, localization, includeSingleDeckFormats: false),
            ExportScopes =
            [
                new TransferExportScopeOption
                {
                    ScopeId = "all",
                    Label = localization.T("TransferScopeAllDecks", "Flashcards"),
                    Count = filteredDeckIds.Length
                }
            ],
            Coordinator = coordinator
        };

        var choice = await TransferDialog.ShowAsync(overlayService, context).ConfigureAwait(true);
        if (choice == null)
            return;

        if (choice.IsImport)
        {
            var summary = await TransferImportRunner.RunAsync(coordinator, "flashcards", choice).ConfigureAwait(true);
            await TransferImportRunner.ShowSummaryAsync(overlayService, localization, context, summary).ConfigureAwait(true);
            if (summary.AnySucceeded)
                await vm.RefreshCommand.ExecuteAsync(null);
            return;
        }

        if (filteredDeckIds.Length == 0)
        {
            await overlayService.CreateDialogAsync(
                localization.T("ExportFailedTitle", "Common"),
                localization.T("ExportFlashcardsNoDecksMessage", "Flashcards")).ConfigureAwait(true);
            return;
        }

        await ExportFlashcardsAsync(overlayService, localization, coordinator, choice, filteredDeckIds, "flashcards").ConfigureAwait(true);
    }

    private static IReadOnlyList<TransferExportFormatOption> BuildFlashcardsExportFormats(
        IImportExportCoordinator coordinator,
        ILocalizationService localization,
        bool includeSingleDeckFormats)
    {
        var capabilities = coordinator.GetCapabilities("flashcards").Where(c => c.SupportsExport).ToArray();
        var formats = new List<TransferExportFormatOption>();

        var package = capabilities.FirstOrDefault(c => c.FormatId == "flashcards.mnemo");
        if (package != null)
        {
            formats.Add(new TransferExportFormatOption
            {
                FormatId = package.FormatId,
                ExtensionLabel = ".mnemo",
                DisplayName = localization.T("TransferFormatArchive", "Common"),
                Caption = localization.T("TransferFormatCaptionArchive", "Common"),
                Extensions = package.Extensions
            });
        }

        if (!includeSingleDeckFormats)
            return formats;

        var csv = capabilities.FirstOrDefault(c => c.FormatId == "flashcards.csv");
        if (csv != null)
        {
            formats.Add(new TransferExportFormatOption
            {
                FormatId = csv.FormatId,
                ExtensionLabel = ".csv",
                DisplayName = localization.T("TransferFormatCsv", "Common"),
                Caption = localization.T("TransferFormatCaptionCsv", "Common"),
                Extensions = csv.Extensions
            });
        }

        var anki = capabilities.FirstOrDefault(c => c.FormatId == "flashcards.anki");
        if (anki != null)
        {
            formats.Add(new TransferExportFormatOption
            {
                FormatId = anki.FormatId,
                ExtensionLabel = ".apkg",
                DisplayName = localization.T("TransferFormatAnki", "Common"),
                Caption = localization.T("TransferFormatCaptionAnki", "Common"),
                Extensions = anki.Extensions
            });
        }

        return formats;
    }

    private async Task ExportFlashcardsAsync(
        IOverlayService overlayService,
        ILocalizationService localization,
        IImportExportCoordinator coordinator,
        TransferDialogResult choice,
        object payload,
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
            Title = localization.T("TransferExportTitle", "Flashcards"),
            SuggestedFileName = $"{suggestedName}{extension}",
            DefaultExtension = extension.TrimStart('.'),
            FileTypeChoices = [new FilePickerFileType(choice.Format.DisplayName) { Patterns = choice.Format.Extensions.Select(ext => $"*{ext}").ToArray() }]
        });
        if (saveFile == null)
            return;

        var export = await coordinator.ExportAsync(new ImportExportRequest
        {
            ContentType = "flashcards",
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

    // --- Per-deck actions (invoked from FlashcardDeckRow overflow menu) -----

    public void OpenDeckSettings(FlashcardDeckRowViewModel row)
    {
        if (row is null || string.IsNullOrWhiteSpace(row.Id))
            return;
        var services = (Application.Current as App)?.Services;
        if (services == null)
            return;
        var overlayService = services.GetService<IOverlayService>();
        if (overlayService == null)
            return;

        FlashcardReviewSettingsOverlay.Open(overlayService, services, row.Id, row.Name);
    }

    public async Task RenameDeckAsync(FlashcardDeckRowViewModel row)
    {
        var services = (Application.Current as App)?.Services;
        if (services == null || DataContext is not FlashcardsViewModel vm)
            return;
        var overlayService = services.GetService<IOverlayService>();
        var library = services.GetService<IFlashcardLibraryService>();
        var localization = services.GetService<ILocalizationService>();
        if (overlayService == null || library == null || localization == null)
            return;

        var input = new InputDialogOverlay
        {
            Title = localization.T("RenameDeck", "Flashcards"),
            Placeholder = localization.T("DeckNamePlaceholder", "Flashcards"),
            InputValue = row.Name,
            ConfirmText = localization.T("Save", "Common"),
            CancelText = localization.T("Cancel", "Common")
        };
        var id = overlayService.CreateOverlay(input, new OverlayOptions { ShowBackdrop = true, CloseOnOutsideClick = true });
        var tcs = new TaskCompletionSource<string?>();
        input.OnResult = value =>
        {
            overlayService.CloseOverlay(id);
            tcs.TrySetResult(value);
        };
        var newName = (await tcs.Task.ConfigureAwait(true) ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(newName) || string.Equals(newName, row.Name, StringComparison.Ordinal))
            return;
        var summary = await library.GetDeckAsync(row.Id).ConfigureAwait(true);
        if (summary == null)
            return;
        await library.SaveDeckAsync(summary.Header with { Name = newName }).ConfigureAwait(true);
        await vm.RefreshCommand.ExecuteAsync(null);
    }

    public async Task ExportDeckAsync(FlashcardDeckRowViewModel row, string? requestedFormatId)
    {
        var services = (Application.Current as App)?.Services;
        if (services == null || DataContext is not FlashcardsViewModel vm)
            return;
        var coordinator = services.GetService<IImportExportCoordinator>();
        var overlayService = services.GetService<IOverlayService>();
        var library = services.GetService<IFlashcardLibraryService>();
        var localization = services.GetService<ILocalizationService>();
        if (coordinator == null || overlayService == null || library == null || localization == null)
            return;
        var deck = await library.GetDeckAsync(row.Id).ConfigureAwait(true);
        if (deck == null)
            return;

        var exportFormats = BuildFlashcardsExportFormats(coordinator, localization, includeSingleDeckFormats: true);
        TransferDialogResult? choice;
        if (!string.IsNullOrWhiteSpace(requestedFormatId))
        {
            var preferred = exportFormats.FirstOrDefault(f => string.Equals(f.FormatId, requestedFormatId, StringComparison.Ordinal));
            if (preferred == null)
            {
                await overlayService.CreateDialogAsync(
                    localization.T("ExportFormatUnavailableTitle", "Flashcards"),
                    localization.T("ExportFormatUnavailableMessage", "Flashcards")).ConfigureAwait(true);
                return;
            }

            choice = new TransferDialogResult { IsImport = false, Format = preferred };
        }
        else
        {
            choice = await TransferDialog.ShowAsync(overlayService, new TransferDialogContext
            {
                ContentType = "flashcards",
                Direction = TransferDialogDirection.ExportOnly,
                ImportTitle = localization.T("TransferExportDeckTitle", "Flashcards"),
                ExportTitle = localization.T("TransferExportDeckTitle", "Flashcards"),
                ExportSubtitle = string.Format(localization.T("TransferFromFormat", "Flashcards"), deck.Name),
                ItemNounSingular = localization.T("TransferNounSingular", "Flashcards"),
                ItemNounPlural = localization.T("TransferNounPlural", "Flashcards"),
                ExportFormats = exportFormats,
                Coordinator = coordinator
            }).ConfigureAwait(true);
        }

        if (choice?.Format == null)
            return;

        // All format adapters resolve a deck id string (or summary/header) to the deck's cards; the
        // deck id is the single portable payload for every format including CSV.
        await ExportFlashcardsAsync(overlayService, localization, coordinator, choice, deck.Id, SanitizeFileName(deck.Name)).ConfigureAwait(true);
        await vm.RefreshCommand.ExecuteAsync(null);
    }

    private static string SanitizeFileName(string value)
    {
        var name = string.IsNullOrWhiteSpace(value) ? "flashcards" : value.Trim();
        foreach (var invalid in System.IO.Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');
        return name;
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        RemoveHandler(PointerMovedEvent, OnRootPointerMoved);
        RemoveHandler(PointerReleasedEvent, OnRootPointerReleased);
        RemoveHandler(KeyDownEvent, OnRootKeyDown);
        _dragCoordinator?.Dispose();
        _dragCoordinator = null;
        base.OnDetachedFromVisualTree(e);
    }
}
