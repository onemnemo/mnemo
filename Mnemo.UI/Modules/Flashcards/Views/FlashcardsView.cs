using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.UI.Modules.Flashcards.ViewModels;
using System;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Components.Overlays.Transfer;
using System.Collections.Generic;

namespace Mnemo.UI.Modules.Flashcards.Views;

public partial class FlashcardsView : UserControl, INotifyPropertyChanged
{
    private const double DragStartThreshold = 5.0;

    public new event PropertyChangedEventHandler? PropertyChanged;

    public IRelayCommand<FlashcardDeckRowViewModel?>? StartReviewSessionCommandProxy => (DataContext as FlashcardsViewModel)?.StartReviewSessionCommand;
    public IRelayCommand<FlashcardDeckRowViewModel?>? StartQuickSessionCommandProxy => (DataContext as FlashcardsViewModel)?.StartQuickSessionCommand;
    public IRelayCommand<FlashcardDeckRowViewModel?>? StartCramSessionCommandProxy => (DataContext as FlashcardsViewModel)?.StartCramSessionCommand;
    public IRelayCommand<FlashcardDeckRowViewModel?>? StartTestSessionCommandProxy => (DataContext as FlashcardsViewModel)?.StartTestSessionCommand;
    public IRelayCommand<FlashcardDeckRowViewModel?>? OpenDeckCommandProxy => (DataContext as FlashcardsViewModel)?.OpenDeckCommand;
    public IAsyncRelayCommand<FlashcardDeckRowViewModel?>? OpenDeckSettingsCommandProxy => (DataContext as FlashcardsViewModel)?.OpenDeckSettingsCommand;
    public IAsyncRelayCommand<FlashcardDeckRowViewModel?>? DeleteDeckCommandProxy => (DataContext as FlashcardsViewModel)?.DeleteDeckCommand;

    private Border? _dragArmedDeckBorder;
    private Point _dragArmedDeckPoint;
    internal FlashcardsDragCoordinator? _dragCoordinator;

    public FlashcardsView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        AddHandler(PointerMovedEvent, OnRootPointerMoved, RoutingStrategies.Tunnel);
        AddHandler(PointerReleasedEvent, OnRootPointerReleased, RoutingStrategies.Tunnel);
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(StartReviewSessionCommandProxy)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(StartQuickSessionCommandProxy)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(StartCramSessionCommandProxy)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(StartTestSessionCommandProxy)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(OpenDeckCommandProxy)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(OpenDeckSettingsCommandProxy)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(DeleteDeckCommandProxy)));
    }

    private void OnDeckCardPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (sender is not Border border || DataContext is not FlashcardsViewModel)
            return;

        if (border.DataContext is not FlashcardDeckRowViewModel row)
            return;

        if (!e.GetCurrentPoint(border).Properties.IsLeftButtonPressed)
            return;
        if (e.Source is StyledElement source)
        {
            StyledElement? current = source;
            while (current is not null)
            {
                if (current is Button)
                    return;
                current = current.Parent as StyledElement;
            }
        }

        _dragArmedDeckBorder = border;
        _dragArmedDeckPoint = e.GetPosition(border);
        e.Pointer.Capture(border);

        e.Handled = true;
    }

    private void OnDeckCardPointerMoved(object? sender, PointerEventArgs e)
    {
        if (sender is not Border border)
            return;
        if (!ReferenceEquals(_dragArmedDeckBorder, border))
            return;
        if (border.DataContext is not FlashcardDeckRowViewModel row || string.IsNullOrWhiteSpace(row.Id))
            return;
        if (!e.GetCurrentPoint(border).Properties.IsLeftButtonPressed)
            return;

        var current = e.GetPosition(border);
        var delta = current - _dragArmedDeckPoint;
        if (Math.Abs(delta.X) < DragStartThreshold && Math.Abs(delta.Y) < DragStartThreshold)
            return;

        e.Pointer.Capture(null);
        _dragArmedDeckBorder = null;
        EnsureDragCoordinator();
        _dragCoordinator?.BeginDeckDrag(row, border, e.Pointer);
    }

    private void OnDeckCardPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (sender is not Border border || DataContext is not FlashcardsViewModel vm)
            return;

        e.Pointer.Capture(null);
        if (!ReferenceEquals(_dragArmedDeckBorder, border))
            return;

        _dragArmedDeckBorder = null;

        if (border.DataContext is not FlashcardDeckRowViewModel row)
            return;
        if (e.Source is StyledElement source && IsEventFromButton(source))
            return;

        if (vm.OpenDeckCommand.CanExecute(row))
            vm.OpenDeckCommand.Execute(row);
        e.Handled = true;
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

    private void EnsureDragCoordinator()
    {
        if (_dragCoordinator != null)
            return;

        if (this.FindControl<Canvas>("DragOverlayCanvas") is not Canvas overlay)
            return;

        _dragCoordinator = new FlashcardsDragCoordinator(overlay, this);
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

        if (drop.Value.SourceKind == FlashcardsDragCoordinator.DragSourceKind.Deck &&
            !string.IsNullOrWhiteSpace(drop.Value.TargetFolderId))
        {
            await vm.MoveDeckToFolderAsync(drop.Value.SourceId, drop.Value.TargetFolderId);
            return;
        }

        if (drop.Value.SourceKind == FlashcardsDragCoordinator.DragSourceKind.Folder &&
            !string.IsNullOrWhiteSpace(drop.Value.TargetFolderId) &&
            drop.Value.FolderMode != FlashcardsDragCoordinator.FolderDropMode.None)
        {
            await vm.MoveFolderAsync(
                drop.Value.SourceId,
                drop.Value.TargetFolderId,
                drop.Value.FolderMode == FlashcardsDragCoordinator.FolderDropMode.DropIntoFolder,
                drop.Value.FolderMode == FlashcardsDragCoordinator.FolderDropMode.InsertBelow);
        }
    }

    public void InitiateFolderDrag(FlashcardFolderItemViewModel item, FlashcardFolderRow row, IPointer pointer)
    {
        EnsureDragCoordinator();
        _dragCoordinator?.BeginFolderDrag(item, row, pointer);
    }

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

        var button = sender as Button;
        var startTransfer = string.Equals(button?.Tag?.ToString(), "transfer", StringComparison.OrdinalIgnoreCase);
        var filteredDeckIds = vm.FilteredDecks
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
            {
                vm.SelectAllDecks();
                await vm.RefreshCommand.ExecuteAsync(null);
            }
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

    private async void OnDeckRenameClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: FlashcardDeckRowViewModel row })
            return;
        var app = Application.Current as App;
        var services = app?.Services;
        if (services == null || DataContext is not FlashcardsViewModel vm)
            return;
        var overlayService = services.GetService<IOverlayService>();
        var deckService = services.GetService<IFlashcardDeckService>();
        if (overlayService == null || deckService == null)
            return;

        var input = new InputDialogOverlay
        {
            Title = "Rename deck",
            Placeholder = "Deck name",
            InputValue = row.Name,
            ConfirmText = "Save",
            CancelText = "Cancel"
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
        var deck = await deckService.GetDeckByIdAsync(row.Id).ConfigureAwait(true);
        if (deck == null)
            return;
        await deckService.SaveDeckAsync(deck with { Name = newName }).ConfigureAwait(true);
        await vm.RefreshCommand.ExecuteAsync(null);
    }

    private async void OnDeckDuplicateClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: FlashcardDeckRowViewModel row })
            return;
        var app = Application.Current as App;
        var services = app?.Services;
        if (services == null || DataContext is not FlashcardsViewModel vm)
            return;
        var deckService = services.GetService<IFlashcardDeckService>();
        if (deckService == null)
            return;
        var deck = await deckService.GetDeckByIdAsync(row.Id).ConfigureAwait(true);
        if (deck == null)
            return;
        var copy = deck with
        {
            Id = Guid.NewGuid().ToString("n"),
            Name = $"{deck.Name} Copy",
            Cards = deck.Cards.Select(card => card with { Id = Guid.NewGuid().ToString("n") }).ToArray(),
            LastStudied = null
        };
        await deckService.SaveDeckAsync(copy).ConfigureAwait(true);
        await vm.RefreshCommand.ExecuteAsync(null);
    }

    private async void OnDeckExportClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control { Tag: FlashcardDeckRowViewModel row })
            return;
        var app = Application.Current as App;
        var services = app?.Services;
        if (services == null || DataContext is not FlashcardsViewModel vm)
            return;
        var coordinator = services.GetService<IImportExportCoordinator>();
        var overlayService = services.GetService<IOverlayService>();
        var deckService = services.GetService<IFlashcardDeckService>();
        if (coordinator == null || overlayService == null || deckService == null)
            return;
        var localization = services.GetService<ILocalizationService>();
        var deck = await deckService.GetDeckByIdAsync(row.Id).ConfigureAwait(true);
        if (deck == null)
            return;

        if (localization == null)
            return;

        var exportFormats = BuildFlashcardsExportFormats(coordinator, localization, includeSingleDeckFormats: true);
        var requestedFormatId = (sender as MenuItem)?.CommandParameter as string;
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

        object payload = choice.Format.FormatId == "flashcards.csv" ? deck : deck.Id;
        await ExportFlashcardsAsync(overlayService, localization, coordinator, choice, payload, SanitizeFileName(deck.Name)).ConfigureAwait(true);
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
        _dragCoordinator?.Dispose();
        _dragCoordinator = null;
        base.OnDetachedFromVisualTree(e);
    }
}
