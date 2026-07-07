using System;
using System.Collections.Specialized;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.Views;

/// <summary>
/// Deck view code-behind. All state lives in <see cref="FlashcardDeckViewModel"/>; this only
/// wires view-only glue: launching the card editor / review-settings / export overlays from VM
/// events, refreshing the deck when the editor overlay closes, and the two menu gestures that need
/// the clicked element (row double-click → edit, per-row "Move to ▸ &lt;deck&gt;").
/// </summary>
public partial class FlashcardDeckView : UserControl
{
    private const string CardEditorOverlayName = "FlashcardCardEditor";

    private FlashcardDeckViewModel? _viewModel;
    private IOverlayService? _overlay;
    private bool _editorOverlayOpen;

    public FlashcardDeckView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        Unloaded += OnUnloaded;
        AttachViewModel(DataContext as FlashcardDeckViewModel);
    }

    private void OnDataContextChanged(object? sender, EventArgs e) =>
        AttachViewModel(DataContext as FlashcardDeckViewModel);

    private void AttachViewModel(FlashcardDeckViewModel? next)
    {
        if (ReferenceEquals(_viewModel, next))
            return;

        if (_viewModel is not null)
        {
            _viewModel.AddCardsRequested -= OnAddCardsRequested;
            _viewModel.EditRequested -= OnEditRequested;
            _viewModel.ReviewSettingsRequested -= OnReviewSettingsRequested;
            _viewModel.ExportRequested -= OnExportRequested;
        }

        _viewModel = next;

        if (_viewModel is not null)
        {
            _viewModel.AddCardsRequested += OnAddCardsRequested;
            _viewModel.EditRequested += OnEditRequested;
            _viewModel.ReviewSettingsRequested += OnReviewSettingsRequested;
            _viewModel.ExportRequested += OnExportRequested;
        }

        EnsureOverlaySubscription();
    }

    private IServiceProvider? Services => (Application.Current as App)?.Services;

    private void EnsureOverlaySubscription()
    {
        if (_overlay is not null)
            return;
        _overlay = Services?.GetService<IOverlayService>();
        if (_overlay is not null)
            _overlay.Overlays.CollectionChanged += OnOverlaysChanged;
    }

    // Refresh the deck once the card editor overlay closes so new/edited cards appear.
    private void OnOverlaysChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        if (_overlay is null || _viewModel is null)
            return;

        var editorOpen = _overlay.Overlays.Any(o => string.Equals(o.Name, CardEditorOverlayName, StringComparison.Ordinal));
        if (_editorOverlayOpen && !editorOpen)
            _viewModel.Refresh();
        _editorOverlayOpen = editorOpen;
    }

    private void OnUnloaded(object? sender, RoutedEventArgs e)
    {
        if (_overlay is not null)
        {
            _overlay.Overlays.CollectionChanged -= OnOverlaysChanged;
            _overlay = null;
        }
    }

    // --- VM event handlers → overlay launchers -----------------------------

    private void OnAddCardsRequested()
    {
        if (Services is not { } services || _viewModel is null)
            return;
        var overlay = services.GetService<IOverlayService>();
        if (overlay is null)
            return;
        FlashcardCardEditorOverlay.Open(overlay, services, _viewModel.DeckId);
    }

    private void OnEditRequested(string cardId)
    {
        if (Services is not { } services)
            return;
        var overlay = services.GetService<IOverlayService>();
        if (overlay is null || string.IsNullOrWhiteSpace(cardId))
            return;
        FlashcardCardEditorOverlay.OpenForEdit(overlay, services, cardId);
    }

    private void OnReviewSettingsRequested()
    {
        if (Services is not { } services || _viewModel is null)
            return;
        var overlay = services.GetService<IOverlayService>();
        if (overlay is null)
            return;
        FlashcardReviewSettingsOverlay.Open(overlay, services, _viewModel.DeckId, _viewModel.DeckName);
    }

    private async void OnExportRequested()
    {
        if (_viewModel is null || Services is not { } services)
            return;
        var overlayService = services.GetService<IOverlayService>();
        var coordinator = services.GetService<IImportExportCoordinator>();
        var localization = services.GetService<ILocalizationService>();
        if (overlayService is null || coordinator is null || localization is null)
            return;

        await FlashcardDeckExport.RunAsync(this, overlayService, coordinator, localization, _viewModel.DeckId, _viewModel.DeckName)
            .ConfigureAwait(true);
    }

    // --- Row gestures ------------------------------------------------------

    private void OnRowDoubleTapped(object? sender, TappedEventArgs e)
    {
        if (_viewModel is null || sender is not Control { DataContext: FlashcardCardRowViewModel row })
            return;
        _viewModel.EditCardCommand.Execute(row);
    }

    // Row context-menu items (Edit/Flag/Suspend/Delete) carry the card id in Tag; commands resolve
    // the row from the VM's current page. Cross-popup #root bindings don't resolve, so we route via
    // Click — the proven pattern from FlashcardDeckRow.
    private FlashcardCardRowViewModel? RowFor(object? sender) =>
        sender is MenuItem { Tag: string cardId }
            ? _viewModel?.Cards.FirstOrDefault(c => string.Equals(c.Id, cardId, StringComparison.Ordinal))
            : null;

    private void OnRowEditClick(object? sender, RoutedEventArgs e)
    {
        if (RowFor(sender) is { } row)
            _viewModel!.EditCardCommand.Execute(row);
    }

    private void OnRowFlagClick(object? sender, RoutedEventArgs e)
    {
        if (RowFor(sender) is { } row)
            _viewModel!.ToggleRowFlagCommand.Execute(row);
    }

    private void OnRowSuspendClick(object? sender, RoutedEventArgs e)
    {
        if (RowFor(sender) is { } row)
            _viewModel!.ToggleRowSuspendCommand.Execute(row);
    }

    private void OnRowDeleteClick(object? sender, RoutedEventArgs e)
    {
        if (RowFor(sender) is { } row)
            _viewModel!.DeleteRowCommand.Execute(row);
    }

    // Per-row "Move to ▸ <deck>": the outer MenuItem carries the card id in Tag; the clicked leaf
    // carries the target FlashcardDeckMenuItem as its DataContext.
    private void OnRowMoveMenuClick(object? sender, RoutedEventArgs e)
    {
        if (_viewModel is null || sender is not MenuItem outer || outer.Tag is not string cardId)
            return;
        if (e.Source is MenuItem { DataContext: FlashcardDeckMenuItem target } && !ReferenceEquals(e.Source, outer))
        {
            _viewModel.MoveRowToDeckCommand.Execute(new FlashcardRowMoveRequest(cardId, target.DeckId));
        }
    }

    // Deck ⋯ "Move to folder ▸ <folder>": leaf carries the FlashcardFolderMenuItem as DataContext.
    private void OnMoveToFolderClick(object? sender, RoutedEventArgs e)
    {
        if (_viewModel is null || sender is not MenuItem outer)
            return;
        if (e.Source is MenuItem { DataContext: FlashcardFolderMenuItem target } && !ReferenceEquals(e.Source, outer))
            _viewModel.MoveToFolderCommand.Execute(target);
    }

    // "+ Filter → Tag ▸ <tag>": leaf carries the tag string as DataContext.
    private void OnTagFilterClick(object? sender, RoutedEventArgs e)
    {
        if (_viewModel is null || sender is not MenuItem outer)
            return;
        if (e.Source is MenuItem { DataContext: string tag } && !ReferenceEquals(e.Source, outer))
            _viewModel.AddTagFilterCommand.Execute(tag);
    }

    private void OnBatchTagKeyDown(object? sender, KeyEventArgs e)
    {
        if (_viewModel is null)
            return;
        if (e.Key is Key.Enter or Key.Return)
        {
            e.Handled = true;
            if (_viewModel.CommitBatchTagCommand.CanExecute(null))
                _viewModel.CommitBatchTagCommand.Execute(null);
        }
    }
}
