using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>
/// One active filter chip on the deck view toolbar: either a State facet or a Tag facet.
/// Removable; clicking the × clears just this facet.
/// </summary>
public sealed class FlashcardFilterChipViewModel
{
    public required string Label { get; init; }
    public required bool IsState { get; init; }
    public FlashcardCardStateFilter State { get; init; }
    public string? Tag { get; init; }
}

/// <summary>
/// A folder option in the deck's "Move to folder ▸" submenu. Root is represented by a null id.
/// </summary>
public sealed record FlashcardFolderMenuItem(string? FolderId, string Name);

/// <summary>
/// A deck option in the multi-select "Move to ▾" submenu. Excludes the current deck.
/// Carries its own <see cref="Invoke"/> command so the menu item binds against its own DataContext
/// (flyouts live in a separate popup namescope, where cross-tree command bindings don't resolve).
/// </summary>
public sealed class FlashcardDeckMenuItem
{
    public required string DeckId { get; init; }
    public required string Name { get; init; }
    public required System.Windows.Input.ICommand Invoke { get; init; }
}

/// <summary>A single-row "Move to ▸ &lt;deck&gt;" request (card id + target deck id).</summary>
public sealed record FlashcardRowMoveRequest(string CardId, string TargetDeckId);

/// <summary>
/// Deck view on the relational flashcard services. Renders one deck's header sub-stats, a
/// searchable/filterable/sortable paginated card table, a multi-select floating action bar, and the
/// deck ⋯ menu (rename, move, review settings, export, suspend-all, delete). Holds no cards beyond
/// the current page; every list load and mutation goes through <see cref="IFlashcardCardService"/> /
/// <see cref="IFlashcardLibraryService"/> and refreshes counts + rows afterwards.
/// </summary>
public partial class FlashcardDeckViewModel : ViewModelBase, INavigationAware, IDisposable
{
    private const int PageSize = 50;
    private const int SearchDebounceMs = 250;

    private readonly IFlashcardCardService _cardService;
    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardStudyService _study;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILocalizationService _localization;
    private readonly IDateDisplayService _dates;
    private readonly ITopbarTrailService _trail;

    private string _deckId = string.Empty;
    public string DeckId => _deckId;

    /// <summary>Deck's folder (null = root), feeding the topbar trail "folder / deck" crumbs.</summary>
    private string? _folderId;
    private string? _folderName;

    /// <summary>Cancels an in-flight page load when the query changes (one CTS per load).</summary>
    private CancellationTokenSource? _loadCts;

    /// <summary>Debounces search-box input into the query text.</summary>
    private CancellationTokenSource? _searchCts;

    private bool _disposed;

    // --- Query state (drives ListCardsAsync) ---
    private string _queryText = string.Empty;
    private FlashcardCardStateFilter _stateFilter = FlashcardCardStateFilter.All;
    private string? _tagFilter;

    [ObservableProperty]
    private FlashcardCardSort _sort = FlashcardCardSort.Due;

    [ObservableProperty]
    private bool _sortDescending;

    private int _offset;

    // --- Header ---
    [ObservableProperty]
    private string _deckName = string.Empty;

    [ObservableProperty]
    private string _totalCardsText = string.Empty;

    [ObservableProperty]
    private int _learningCount;

    [ObservableProperty]
    private int _dueCount;

    /// <summary>New + Learning + Due, the pool Cram's "Due cards" scope draws from.</summary>
    [ObservableProperty]
    private int _newCount;

    /// <summary>Non-suspended cards, the pool Cram's "All cards" scope draws from.</summary>
    [ObservableProperty]
    private int _activeCards;

    [ObservableProperty]
    private int _retentionPercent;

    [ObservableProperty]
    private string _retentionText = string.Empty;

    /// <summary>Pixel width of the filled portion of the 44px header retention bar.</summary>
    [ObservableProperty]
    private double _retentionFillWidth;

    [ObservableProperty]
    private string _lastStudiedText = string.Empty;

    public bool HasLearning => LearningCount > 0;
    public bool HasDue => DueCount > 0;

    /// <summary>New + Learning + Due, Cram's "Due cards" scope, independent of today's caps.</summary>
    public int DueTodayCount => NewCount + LearningCount + DueCount;

    // --- Toolbar / filters ---
    [ObservableProperty]
    private string _searchQuery = string.Empty;

    /// <summary>Tags known on this deck, offered in the "+ Filter" tag flyout.</summary>
    public ObservableCollection<string> KnownTags { get; } = new();

    [ObservableProperty]
    private bool _hasKnownTags;

    public ObservableCollection<FlashcardFilterChipViewModel> ActiveFilters { get; } = new();

    [ObservableProperty]
    private bool _hasActiveFilters;

    /// <summary>"N of M cards" shown right-aligned only while a filter/search narrows the deck.</summary>
    [ObservableProperty]
    private string _filteredCountText = string.Empty;

    [ObservableProperty]
    private bool _showFilteredCount;

    // --- Table state ---
    public ObservableCollection<FlashcardCardRowViewModel> Cards { get; } = new();

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _showEmptyState;

    [ObservableProperty]
    private bool _showNoResultsState;

    [ObservableProperty]
    private bool _showTable;

    private int _totalCount;

    // --- Sort indicators (DUE column chevron) ---
    public bool IsSortedByDue => Sort == FlashcardCardSort.Due;
    public bool DueSortAscending => IsSortedByDue && !SortDescending;
    public bool DueSortDescending => IsSortedByDue && SortDescending;

    // --- Selection ---
    private bool _suppressSelectionSync;

    [ObservableProperty]
    private int _selectedCount;

    public bool HasSelection => SelectedCount > 0;

    [ObservableProperty]
    private string _selectionCountText = string.Empty;

    /// <summary>True when every selected card is already suspended (flips Suspend → Unsuspend).</summary>
    [ObservableProperty]
    private bool _allSelectedSuspended;

    /// <summary>True when every selected card is already flagged (flips Flag → Unflag).</summary>
    [ObservableProperty]
    private bool _allSelectedFlagged;

    /// <summary>Multi-select bar Suspend/Unsuspend label, flipped by <see cref="AllSelectedSuspended"/>.</summary>
    [ObservableProperty]
    private string _suspendActionLabel = string.Empty;

    /// <summary>Multi-select bar Flag/Unflag label, flipped by <see cref="AllSelectedFlagged"/>.</summary>
    [ObservableProperty]
    private string _flagActionLabel = string.Empty;

    /// <summary>Header select-all checkbox: true / false / null (indeterminate).</summary>
    [ObservableProperty]
    private bool? _selectAllState = false;

    // --- Pagination ---
    [ObservableProperty]
    private string _pageRangeText = string.Empty;

    [ObservableProperty]
    private bool _canGoPrevious;

    [ObservableProperty]
    private bool _canGoNext;

    [ObservableProperty]
    private bool _showPagination;

    // --- Menu data ---
    public ObservableCollection<FlashcardFolderMenuItem> FolderMenuItems { get; } = new();
    public ObservableCollection<FlashcardDeckMenuItem> MoveTargetDecks { get; } = new();

    /// <summary>Bound to the inline "Tag" flyout textbox on the multi-select bar.</summary>
    [ObservableProperty]
    private string _batchTagInput = string.Empty;

    // --- Commands ---
    public IRelayCommand GoBackCommand { get; }
    public IRelayCommand AddCardsCommand { get; }
    public IRelayCommand RenameDeckCommand { get; }
    public IRelayCommand<FlashcardFolderMenuItem?> MoveToFolderCommand { get; }
    public IRelayCommand OpenReviewSettingsCommand { get; }
    public IRelayCommand ExportDeckCommand { get; }
    public IAsyncRelayCommand SuspendAllCommand { get; }
    public IAsyncRelayCommand DeleteDeckCommand { get; }

    public IRelayCommand ToggleDueSortCommand { get; }
    public IRelayCommand<FlashcardFilterChipViewModel?> RemoveFilterCommand { get; }
    public IRelayCommand<string?> AddStateFilterCommand { get; }
    public IRelayCommand<string?> AddTagFilterCommand { get; }

    public IRelayCommand NextPageCommand { get; }
    public IRelayCommand PreviousPageCommand { get; }

    public IRelayCommand<bool?> SetSelectAllCommand { get; }
    public IRelayCommand ClearSelectionCommand { get; }

    // Row context-menu + multi-select bar actions.
    public IAsyncRelayCommand<FlashcardCardRowViewModel?> EditCardCommand { get; }
    public IAsyncRelayCommand<FlashcardCardRowViewModel?> ToggleRowFlagCommand { get; }
    public IAsyncRelayCommand<FlashcardCardRowViewModel?> ToggleRowSuspendCommand { get; }
    public IAsyncRelayCommand<FlashcardCardRowViewModel?> DeleteRowCommand { get; }

    /// <summary>Row context-menu "Move to ▸ &lt;deck&gt;": moves the right-clicked row to a target deck.</summary>
    public IAsyncRelayCommand<FlashcardRowMoveRequest?> MoveRowToDeckCommand { get; }

    public IAsyncRelayCommand BatchSuspendCommand { get; }
    public IAsyncRelayCommand BatchFlagCommand { get; }
    public IAsyncRelayCommand BatchDeleteCommand { get; }
    public IAsyncRelayCommand CommitBatchTagCommand { get; }

    public FlashcardDeckViewModel(
        IFlashcardCardService cardService,
        IFlashcardLibraryService library,
        IFlashcardStudyService study,
        INavigationService navigation,
        IOverlayService overlay,
        ILocalizationService localization,
        IDateDisplayService dates,
        ITopbarTrailService trail)
    {
        _cardService = cardService;
        _library = library;
        _study = study;
        _navigation = navigation;
        _overlay = overlay;
        _localization = localization;
        _dates = dates;
        _trail = trail;

        GoBackCommand = new RelayCommand(() => _navigation.NavigateTo("flashcards"));
        AddCardsCommand = new RelayCommand(AddCards);
        RenameDeckCommand = new AsyncRelayCommand(OpenRenameDialogAsync);
        MoveToFolderCommand = new RelayCommand<FlashcardFolderMenuItem?>(item => _ = MoveDeckToFolderAsync(item));
        OpenReviewSettingsCommand = new RelayCommand(OpenReviewSettings);
        ExportDeckCommand = new RelayCommand(() => ExportRequested?.Invoke());
        SuspendAllCommand = new AsyncRelayCommand(SuspendAllAsync);
        DeleteDeckCommand = new AsyncRelayCommand(DeleteDeckAsync);

        ToggleDueSortCommand = new RelayCommand(ToggleDueSort);
        RemoveFilterCommand = new RelayCommand<FlashcardFilterChipViewModel?>(RemoveFilter);
        AddStateFilterCommand = new RelayCommand<string?>(AddStateFilter);
        AddTagFilterCommand = new RelayCommand<string?>(AddTagFilter);

        NextPageCommand = new RelayCommand(NextPage, () => CanGoNext);
        PreviousPageCommand = new RelayCommand(PreviousPage, () => CanGoPrevious);

        SetSelectAllCommand = new RelayCommand<bool?>(SetSelectAll);
        ClearSelectionCommand = new RelayCommand(ClearSelection);

        EditCardCommand = new AsyncRelayCommand<FlashcardCardRowViewModel?>(EditCardAsync);
        ToggleRowFlagCommand = new AsyncRelayCommand<FlashcardCardRowViewModel?>(ToggleRowFlagAsync);
        ToggleRowSuspendCommand = new AsyncRelayCommand<FlashcardCardRowViewModel?>(ToggleRowSuspendAsync);
        DeleteRowCommand = new AsyncRelayCommand<FlashcardCardRowViewModel?>(DeleteRowAsync);
        MoveRowToDeckCommand = new AsyncRelayCommand<FlashcardRowMoveRequest?>(MoveRowToDeckAsync);

        BatchSuspendCommand = new AsyncRelayCommand(BatchSuspendAsync);
        BatchFlagCommand = new AsyncRelayCommand(BatchFlagAsync);
        BatchDeleteCommand = new AsyncRelayCommand(BatchDeleteAsync);
        CommitBatchTagCommand = new AsyncRelayCommand(CommitBatchTagAsync);
    }

    /// <summary>
    /// Raised when the deck ⋯ Export item is chosen. The view code-behind owns the transfer/export
    /// flow (file picker, TransferDialog) and passes the deck id string as the payload, matching the
    /// library. Keeping it here avoids pulling storage-picker types into the ViewModel.
    /// </summary>
    public event Action? ExportRequested;

    public void OnNavigatedTo(object? parameter)
    {
        var id = parameter switch
        {
            FlashcardDeckNavigationParameter p => p.DeckId,
            string s => s,
            _ => null
        };

        if (string.IsNullOrWhiteSpace(id))
        {
            _navigation.NavigateTo("flashcards");
            return;
        }

        _deckId = id;
        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        await LoadHeaderAsync().ConfigureAwait(false);
        await LoadMenuDataAsync().ConfigureAwait(false);
        await ReloadFirstPageAsync().ConfigureAwait(false);
    }

    // --- Header + counts ---------------------------------------------------

    private async Task LoadHeaderAsync()
    {
        var summary = await _library.GetDeckAsync(_deckId).ConfigureAwait(false);
        if (summary is null)
        {
            await Dispatcher.UIThread.InvokeAsync(() => _navigation.NavigateTo("flashcards"));
            return;
        }

        var due = await _study.GetDueCountsAsync(_deckId).ConfigureAwait(false);

        _folderId = summary.Header.FolderId;

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            DeckName = summary.Header.Name;
            UpdateTrail();
            TotalCardsText = string.Format(
                CultureInfo.CurrentCulture, _localization.T("DeckCardCountFormat", "Flashcards"), summary.TotalCards);
            NewCount = due.New;
            LearningCount = due.Learning;
            DueCount = due.Due;
            ActiveCards = summary.ActiveCards;
            RetentionPercent = Math.Clamp(summary.RetentionPercent, 0, 100);
            RetentionText = string.Create(CultureInfo.CurrentCulture, $"{RetentionPercent}%");
            RetentionFillWidth = 30d * RetentionPercent / 100d;
            LastStudiedText = summary.Header.LastStudied is { } studied
                ? string.Format(
                    CultureInfo.CurrentCulture,
                    _localization.T("DeckLastStudiedFormat", "Flashcards"),
                    _dates.FormatRelative(studied.UtcDateTime))
                : _localization.T("DeckNeverStudied", "Flashcards");
            OnPropertyChanged(nameof(HasLearning));
            OnPropertyChanged(nameof(HasDue));
            OnPropertyChanged(nameof(DueTodayCount));
        });
    }

    /// <summary>
    /// Publishes the topbar trail ("folder / deck" after the module label). Runs after the async
    /// loads because the trail service clears itself on every navigation.
    /// </summary>
    private void UpdateTrail()
    {
        if (string.IsNullOrEmpty(DeckName))
            return;

        var crumbs = new List<TopbarTrailCrumb>(2);
        if (!string.IsNullOrEmpty(_folderName))
            crumbs.Add(new TopbarTrailCrumb(_folderName));
        crumbs.Add(new TopbarTrailCrumb(DeckName));
        _trail.SetTrail(crumbs);
    }

    private async Task LoadMenuDataAsync()
    {
        var folders = await _library.ListFoldersAsync().ConfigureAwait(false);
        var decks = await _library.ListDecksAsync().ConfigureAwait(false);
        var tags = await CollectDeckTagsAsync().ConfigureAwait(false);

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            _folderName = folders.FirstOrDefault(f => string.Equals(f.Id, _folderId, StringComparison.Ordinal))?.Name;
            UpdateTrail();

            FolderMenuItems.Clear();
            FolderMenuItems.Add(new FlashcardFolderMenuItem(null, _localization.T("MoveToRoot", "Flashcards")));
            foreach (var folder in folders.OrderBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase))
                FolderMenuItems.Add(new FlashcardFolderMenuItem(folder.Id, folder.Name));

            MoveTargetDecks.Clear();
            foreach (var deck in decks
                         .Where(d => !string.Equals(d.Id, _deckId, StringComparison.Ordinal))
                         .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase))
            {
                var deckId = deck.Id;
                MoveTargetDecks.Add(new FlashcardDeckMenuItem
                {
                    DeckId = deckId,
                    Name = deck.Name,
                    Invoke = new AsyncRelayCommand(() => BatchMoveToDeckAsync(deckId))
                });
            }

            KnownTags.Clear();
            foreach (var tag in tags)
                KnownTags.Add(tag);
            HasKnownTags = KnownTags.Count > 0;
        });
    }

    /// <summary>
    /// Distinct tags across the whole deck for the "+ Filter → Tag" flyout. Pages through cards
    /// collecting tag strings only (bounded memory), same discipline as Suspend all.
    /// </summary>
    private async Task<IReadOnlyList<string>> CollectDeckTagsAsync()
    {
        var seen = new SortedSet<string>(StringComparer.CurrentCultureIgnoreCase);
        var offset = 0;
        while (true)
        {
            var query = new FlashcardCardQuery(_deckId, State: FlashcardCardStateFilter.All, Offset: offset, Limit: PageSize);
            var page = await _cardService.ListCardsAsync(query).ConfigureAwait(false);
            foreach (var view in page.Items)
                foreach (var tag in view.Card.Tags)
                    if (!string.IsNullOrWhiteSpace(tag))
                        seen.Add(tag);
            offset += PageSize;
            if (offset >= page.TotalCount || page.Items.Count == 0)
                break;
        }
        return seen.ToList();
    }

    /// <summary>Refreshes header counts after a mutation without re-navigating.</summary>
    private Task RefreshCountsAsync() => LoadHeaderAsync();

    // --- Query / paging ----------------------------------------------------

    private FlashcardCardQuery CurrentQuery(int offset) => new(
        _deckId,
        string.IsNullOrWhiteSpace(_queryText) ? null : _queryText.Trim(),
        _stateFilter,
        _tagFilter,
        Sort,
        SortDescending,
        offset,
        PageSize);

    private Task ReloadFirstPageAsync()
    {
        _offset = 0;
        return LoadPageAsync();
    }

    private async Task LoadPageAsync()
    {
        // Supersede any in-flight load: cancel + dispose the previous CTS (it is no longer referenced
        // after this swap, so nothing will Cancel it again). Loads are always kicked off on the UI
        // thread, so this field swap is race-free.
        var previous = _loadCts;
        var cts = new CancellationTokenSource();
        _loadCts = cts;
        if (previous is not null)
        {
            previous.Cancel();
            previous.Dispose();
        }
        var token = cts.Token;

        await Dispatcher.UIThread.InvokeAsync(() => IsLoading = true);

        try
        {
            var page = await _cardService.ListCardsAsync(CurrentQuery(_offset), token).ConfigureAwait(false);
            if (token.IsCancellationRequested)
                return;

            var now = DateTimeOffset.UtcNow;
            var rows = page.Items
                .Select(v => new FlashcardCardRowViewModel(v, _localization, now, MoveTargetDecks))
                .ToList();

            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                if (token.IsCancellationRequested)
                    return;

                _suppressSelectionSync = true;
                foreach (var row in Cards)
                    row.PropertyChanged -= OnRowPropertyChanged;
                Cards.Clear();
                foreach (var row in rows)
                {
                    row.PropertyChanged += OnRowPropertyChanged;
                    Cards.Add(row);
                }
                _suppressSelectionSync = false;

                _totalCount = page.TotalCount;
                _offset = page.Offset;
                UpdatePaginationState();
                UpdateFilteredCountState();
                UpdateCollectionStates();
                RecomputeSelection();
            });
        }
        catch (OperationCanceledException)
        {
            // Stale load superseded by a newer query; nothing to do.
        }
        finally
        {
            // Only the current (non-superseded) load owns the loading flag and disposes its own CTS.
            // A superseded load's CTS was already disposed by the newer load above.
            if (ReferenceEquals(_loadCts, cts))
            {
                await Dispatcher.UIThread.InvokeAsync(() => IsLoading = false);
                _loadCts = null;
                cts.Dispose();
            }
        }
    }

    private void UpdatePaginationState()
    {
        ShowPagination = _totalCount > PageSize;
        var first = _totalCount == 0 ? 0 : _offset + 1;
        var last = Math.Min(_offset + PageSize, _totalCount);
        PageRangeText = string.Format(
            CultureInfo.CurrentCulture,
            _localization.T("DeckPageRangeFormat", "Flashcards"),
            first, last, _totalCount);
        CanGoPrevious = _offset > 0;
        CanGoNext = _offset + PageSize < _totalCount;
        PreviousPageCommand.NotifyCanExecuteChanged();
        NextPageCommand.NotifyCanExecuteChanged();
    }

    private void UpdateFilteredCountState()
    {
        var filtered = HasActiveFilters || !string.IsNullOrWhiteSpace(_queryText);
        ShowFilteredCount = filtered && _totalCount > 0;
        if (ShowFilteredCount)
        {
            FilteredCountText = string.Format(
                CultureInfo.CurrentCulture,
                _localization.T("DeckFilteredCountFormat", "Flashcards"),
                _totalCount);
        }
    }

    private void UpdateCollectionStates()
    {
        var hasRows = Cards.Count > 0;
        var filtered = HasActiveFilters || !string.IsNullOrWhiteSpace(_queryText);
        ShowTable = hasRows;
        ShowEmptyState = !hasRows && !filtered;
        ShowNoResultsState = !hasRows && filtered;
    }

    private void NextPage()
    {
        if (!CanGoNext)
            return;
        _offset += PageSize;
        _ = LoadPageAsync();
    }

    private void PreviousPage()
    {
        if (!CanGoPrevious)
            return;
        _offset = Math.Max(0, _offset - PageSize);
        _ = LoadPageAsync();
    }

    // --- Search (debounced) + filters --------------------------------------

    partial void OnSearchQueryChanged(string value)
    {
        _searchCts?.Cancel();
        var cts = new CancellationTokenSource();
        _searchCts = cts;
        _ = DebounceSearchAsync(value, cts.Token);
    }

    private async Task DebounceSearchAsync(string value, CancellationToken token)
    {
        try
        {
            await Task.Delay(SearchDebounceMs, token).ConfigureAwait(false);
            if (token.IsCancellationRequested)
                return;
            _queryText = value;
            await ReloadFirstPageAsync().ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by newer keystroke.
        }
    }

    partial void OnSortChanged(FlashcardCardSort value)
    {
        OnPropertyChanged(nameof(IsSortedByDue));
        OnPropertyChanged(nameof(DueSortAscending));
        OnPropertyChanged(nameof(DueSortDescending));
    }

    partial void OnSortDescendingChanged(bool value)
    {
        OnPropertyChanged(nameof(DueSortAscending));
        OnPropertyChanged(nameof(DueSortDescending));
    }

    private void ToggleDueSort()
    {
        if (Sort == FlashcardCardSort.Due)
            SortDescending = !SortDescending;
        else
        {
            Sort = FlashcardCardSort.Due;
            SortDescending = false;
        }
        _ = ReloadFirstPageAsync();
    }

    private void AddStateFilter(string? name)
    {
        if (!Enum.TryParse<FlashcardCardStateFilter>(name, ignoreCase: true, out var state)
            || state == FlashcardCardStateFilter.All)
            return;
        _stateFilter = state;
        RebuildFilterChips();
        _ = ReloadFirstPageAsync();
    }

    private void AddTagFilter(string? tag)
    {
        if (string.IsNullOrWhiteSpace(tag))
            return;
        _tagFilter = tag;
        RebuildFilterChips();
        _ = ReloadFirstPageAsync();
    }

    private void RemoveFilter(FlashcardFilterChipViewModel? chip)
    {
        if (chip is null)
            return;
        if (chip.IsState)
            _stateFilter = FlashcardCardStateFilter.All;
        else
            _tagFilter = null;
        RebuildFilterChips();
        _ = ReloadFirstPageAsync();
    }

    private void RebuildFilterChips()
    {
        ActiveFilters.Clear();
        if (_stateFilter != FlashcardCardStateFilter.All)
        {
            ActiveFilters.Add(new FlashcardFilterChipViewModel
            {
                Label = string.Format(
                    CultureInfo.CurrentCulture,
                    _localization.T("DeckFilterStateFormat", "Flashcards"),
                    StateFilterLabel(_stateFilter)),
                IsState = true,
                State = _stateFilter
            });
        }
        if (!string.IsNullOrWhiteSpace(_tagFilter))
        {
            ActiveFilters.Add(new FlashcardFilterChipViewModel
            {
                Label = string.Format(
                    CultureInfo.CurrentCulture,
                    _localization.T("DeckFilterTagFormat", "Flashcards"),
                    _tagFilter),
                IsState = false,
                Tag = _tagFilter
            });
        }
        HasActiveFilters = ActiveFilters.Count > 0;
    }

    private string StateFilterLabel(FlashcardCardStateFilter state) => state switch
    {
        FlashcardCardStateFilter.Due => _localization.T("StateFilterDue", "Flashcards"),
        FlashcardCardStateFilter.New => _localization.T("StateFilterNew", "Flashcards"),
        FlashcardCardStateFilter.Learning => _localization.T("StateFilterLearning", "Flashcards"),
        FlashcardCardStateFilter.Suspended => _localization.T("StateFilterSuspended", "Flashcards"),
        FlashcardCardStateFilter.Flagged => _localization.T("StateFilterFlagged", "Flashcards"),
        _ => string.Empty
    };

    // --- Selection ---------------------------------------------------------

    private void OnRowPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_suppressSelectionSync)
            return;
        if (e.PropertyName == nameof(FlashcardCardRowViewModel.IsSelected))
            RecomputeSelection();
    }

    private void SetSelectAll(bool? state)
    {
        // Header checkbox click: if not everything is already selected, select all on-page rows;
        // otherwise clear. Decided from current state (not the incoming checkbox value) so a
        // three-state box that is indeterminate resolves to "select all".
        var select = SelectAllState != true;
        _suppressSelectionSync = true;
        foreach (var row in Cards)
            row.IsSelected = select;
        _suppressSelectionSync = false;
        RecomputeSelection();
    }

    private void ClearSelection()
    {
        _suppressSelectionSync = true;
        foreach (var row in Cards)
            row.IsSelected = false;
        _suppressSelectionSync = false;
        RecomputeSelection();
    }

    private void RecomputeSelection()
    {
        var selected = Cards.Where(c => c.IsSelected).ToList();
        SelectedCount = selected.Count;
        SelectionCountText = string.Format(
            CultureInfo.CurrentCulture, _localization.T("DeckSelectedFormat", "Flashcards"), selected.Count);
        AllSelectedSuspended = selected.Count > 0 && selected.All(c => c.IsSuspended);
        AllSelectedFlagged = selected.Count > 0 && selected.All(c => c.IsFlagged);
        SuspendActionLabel = _localization.T(AllSelectedSuspended ? "BatchUnsuspend" : "BatchSuspend", "Flashcards");
        FlagActionLabel = _localization.T(AllSelectedFlagged ? "BatchUnflag" : "BatchFlag", "Flashcards");

        SelectAllState = Cards.Count == 0
            ? false
            : selected.Count == 0
                ? false
                : selected.Count == Cards.Count
                    ? true
                    : (bool?)null;

        OnPropertyChanged(nameof(HasSelection));
    }

    private IReadOnlyList<string> SelectedIds() =>
        Cards.Where(c => c.IsSelected).Select(c => c.Id).ToList();

    // --- Row + batch mutations ---------------------------------------------

    private async Task AfterMutationAsync()
    {
        await RefreshCountsAsync().ConfigureAwait(false);
        await LoadPageAsync().ConfigureAwait(false);
    }

    private Task EditCardAsync(FlashcardCardRowViewModel? row)
    {
        if (row is not null)
            EditRequested?.Invoke(row.Id);
        return Task.CompletedTask;
    }

    /// <summary>Raised when a row is opened for edit (double-click or context menu → editor overlay).</summary>
    public event Action<string>? EditRequested;

    /// <summary>Raised for the "Add cards" affordance → card editor overlay in add mode.</summary>
    public event Action? AddCardsRequested;

    private void AddCards() => AddCardsRequested?.Invoke();

    private async Task ToggleRowFlagAsync(FlashcardCardRowViewModel? row)
    {
        if (row is null)
            return;
        await _cardService.SetFlaggedAsync(new[] { row.Id }, !row.IsFlagged).ConfigureAwait(false);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task ToggleRowSuspendAsync(FlashcardCardRowViewModel? row)
    {
        if (row is null)
            return;
        await _cardService.SetSuspendedAsync(new[] { row.Id }, !row.IsSuspended).ConfigureAwait(false);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task DeleteRowAsync(FlashcardCardRowViewModel? row)
    {
        if (row is null)
            return;
        if (!await ConfirmDeleteCardsAsync(1).ConfigureAwait(false))
            return;
        await _cardService.DeleteCardsAsync(new[] { row.Id }).ConfigureAwait(false);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task BatchSuspendAsync()
    {
        var ids = SelectedIds();
        if (ids.Count == 0)
            return;
        // If every selected card is suspended, unsuspend; otherwise suspend.
        await _cardService.SetSuspendedAsync(ids, !AllSelectedSuspended).ConfigureAwait(false);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task BatchFlagAsync()
    {
        var ids = SelectedIds();
        if (ids.Count == 0)
            return;
        await _cardService.SetFlaggedAsync(ids, !AllSelectedFlagged).ConfigureAwait(false);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task BatchDeleteAsync()
    {
        var ids = SelectedIds();
        if (ids.Count == 0)
            return;
        if (!await ConfirmDeleteCardsAsync(ids.Count).ConfigureAwait(false))
            return;
        await _cardService.DeleteCardsAsync(ids).ConfigureAwait(false);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task CommitBatchTagAsync()
    {
        var ids = SelectedIds();
        var tag = BatchTagInput.Trim();
        if (ids.Count == 0 || tag.Length == 0)
            return;
        await _cardService.AddTagAsync(ids, tag).ConfigureAwait(false);
        await Dispatcher.UIThread.InvokeAsync(() => BatchTagInput = string.Empty);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task BatchMoveToDeckAsync(string targetDeckId)
    {
        var ids = SelectedIds();
        if (string.IsNullOrWhiteSpace(targetDeckId) || ids.Count == 0)
            return;
        await _cardService.MoveCardsAsync(ids, targetDeckId).ConfigureAwait(false);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task MoveRowToDeckAsync(FlashcardRowMoveRequest? request)
    {
        if (request is null)
            return;
        await _cardService.MoveCardsAsync(new[] { request.CardId }, request.TargetDeckId).ConfigureAwait(false);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task<bool> ConfirmDeleteCardsAsync(int count)
    {
        var deleteLabel = _localization.T("Delete", "Common");
        var cancelLabel = _localization.T("Cancel", "Common");
        var message = count == 1
            ? _localization.T("DeleteCardConfirm", "Flashcards")
            : string.Format(CultureInfo.CurrentCulture, _localization.T("DeleteCardsConfirmFormat", "Flashcards"), count);
        var confirm = await _overlay.CreateDialogAsync(
            _localization.T("DeleteCard", "Flashcards"),
            message,
            deleteLabel,
            cancelLabel,
            severity: DialogSeverity.Destructive).ConfigureAwait(false);
        return string.Equals(confirm, deleteLabel, StringComparison.Ordinal);
    }

    // --- Deck-level actions ------------------------------------------------

    private async Task OpenRenameDialogAsync()
    {
        var result = await _overlay.CreateInputDialogAsync(
            title: _localization.T("RenameDeck", "Flashcards"),
            confirmText: _localization.T("Save", "Common"),
            cancelText: _localization.T("Cancel", "Common"),
            placeholder: _localization.T("DeckNamePlaceholder", "Flashcards"),
            initialValue: DeckName,
            confirmIconName: "Common/pencil").ConfigureAwait(true);

        var trimmed = (result ?? string.Empty).Trim();
        if (trimmed.Length == 0 || string.Equals(trimmed, DeckName, StringComparison.Ordinal))
            return;
        var summary = await _library.GetDeckAsync(_deckId).ConfigureAwait(false);
        if (summary is null)
            return;
        await _library.SaveDeckAsync(summary.Header with { Name = trimmed }).ConfigureAwait(false);
        await LoadHeaderAsync().ConfigureAwait(false);
    }

    private async Task MoveDeckToFolderAsync(FlashcardFolderMenuItem? target)
    {
        if (target is null)
            return;
        var summary = await _library.GetDeckAsync(_deckId).ConfigureAwait(false);
        if (summary is null || string.Equals(summary.Header.FolderId, target.FolderId, StringComparison.Ordinal))
            return;

        // Append to the end of the target folder's deck run.
        var decks = await _library.ListDecksAsync().ConfigureAwait(false);
        var sortOrder = decks
            .Where(d => string.Equals(d.Header.FolderId, target.FolderId, StringComparison.Ordinal))
            .Select(d => d.Header.SortOrder)
            .DefaultIfEmpty(-1)
            .Max() + 1;
        await _library.MoveDeckAsync(_deckId, target.FolderId, sortOrder).ConfigureAwait(false);

        _folderId = target.FolderId;
        _folderName = target.FolderId is null ? null : target.Name;
        await Dispatcher.UIThread.InvokeAsync(UpdateTrail);
    }

    private void OpenReviewSettings() => ReviewSettingsRequested?.Invoke();

    /// <summary>Raised for the ⋯ → Review settings… item → the review-settings preset dialog.</summary>
    public event Action? ReviewSettingsRequested;

    private async Task SuspendAllAsync()
    {
        // Page through every active card id (ids only in memory) and suspend in one batch.
        var ids = new List<string>();
        var offset = 0;
        while (true)
        {
            var query = new FlashcardCardQuery(_deckId, State: FlashcardCardStateFilter.All, Offset: offset, Limit: PageSize);
            var page = await _cardService.ListCardsAsync(query).ConfigureAwait(false);
            ids.AddRange(page.Items
                .Where(v => v.Card.State != FlashcardCardState.Suspended)
                .Select(v => v.Card.Id));
            offset += PageSize;
            if (offset >= page.TotalCount || page.Items.Count == 0)
                break;
        }

        if (ids.Count == 0)
            return;
        await _cardService.SetSuspendedAsync(ids, true).ConfigureAwait(false);
        await AfterMutationAsync().ConfigureAwait(false);
    }

    private async Task DeleteDeckAsync()
    {
        var deleteLabel = _localization.T("Delete", "Common");
        var cancelLabel = _localization.T("Cancel", "Common");
        var confirm = await _overlay.CreateDialogAsync(
            _localization.T("DeleteDeck", "Flashcards"),
            _localization.T("DeleteDeckConfirm", "Flashcards"),
            deleteLabel,
            cancelLabel,
            severity: DialogSeverity.Destructive).ConfigureAwait(false);
        if (!string.Equals(confirm, deleteLabel, StringComparison.Ordinal))
            return;

        await _library.DeleteDeckAsync(_deckId).ConfigureAwait(false);
        await Dispatcher.UIThread.InvokeAsync(() => _navigation.NavigateTo("flashcards"));
    }

    /// <summary>Called by the view after the editor overlay closes, so new/edited cards appear.</summary>
    public void Refresh() => _ = AfterMutationAsync();

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _loadCts?.Cancel();
        _loadCts?.Dispose();
        _searchCts?.Cancel();
        _searchCts?.Dispose();
        foreach (var row in Cards)
            row.PropertyChanged -= OnRowPropertyChanged;
    }
}
