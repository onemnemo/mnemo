using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>
/// Library view: folders, filters, search, and deck list.
/// </summary>
public partial class FlashcardsViewModel : ViewModelBase, INavigationAware
{
    /// <summary>Filter token for due-only decks (used by the library sidebar).</summary>
    public const string DueFilterToken = "__due__";
    private const string RootFolderKey = "__root__";
    private const string FlashcardsSidebarOpenKey = "Flashcards.SidebarOpen";

    private readonly IFlashcardDeckService _deckService;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILocalizationService _localization;
    private readonly ISettingsService _settingsService;
    private IReadOnlyList<FlashcardDeck> _loadedDecks = Array.Empty<FlashcardDeck>();
    private IReadOnlyList<FlashcardFolder> _loadedFolders = Array.Empty<FlashcardFolder>();
    private bool _sidebarStateLoaded;

    [ObservableProperty]
    private string _searchText = string.Empty;

    /// <summary>
    /// Selected folder id, <see cref="DueFilterKey"/> for due-only, or <c>null</c> for all decks.
    /// </summary>
    [ObservableProperty]
    private string? _selectedFolderId;

    [ObservableProperty]
    private bool _isSidebarOpen = true;

    /// <summary>True when the library has no decks at all (first-run state).</summary>
    [ObservableProperty]
    private bool _showEmptyState;

    /// <summary>True when decks exist but the current folder/search filter matches none.</summary>
    [ObservableProperty]
    private bool _showNoResultsState;

    public ObservableCollection<FlashcardFolder> Folders { get; } = new();
    public ObservableCollection<FlashcardFolderItemViewModel> FolderTreeItems { get; } = new();
    public ObservableCollection<FlashcardFolderItemViewModel> FlatFolderItems { get; } = new();

    public ObservableCollection<FlashcardDeckRowViewModel> FilteredDecks { get; } = new();

    public IAsyncRelayCommand RefreshCommand { get; }

    public IRelayCommand<FlashcardDeckRowViewModel?> OpenDeckCommand { get; }

    public IRelayCommand<FlashcardDeckRowViewModel?> StartReviewSessionCommand { get; }
    public IRelayCommand<FlashcardDeckRowViewModel?> StartQuickSessionCommand { get; }
    public IRelayCommand<FlashcardDeckRowViewModel?> StartCramSessionCommand { get; }
    public IRelayCommand<FlashcardDeckRowViewModel?> StartTestSessionCommand { get; }
    public IAsyncRelayCommand<FlashcardDeckRowViewModel?> OpenDeckSettingsCommand { get; }
    public IAsyncRelayCommand<FlashcardDeckRowViewModel?> DeleteDeckCommand { get; }

    public IAsyncRelayCommand CreateDeckCommand { get; }
    public IAsyncRelayCommand CreateFolderCommand { get; }

    public IRelayCommand SelectAllDecksCommand { get; }

    public IRelayCommand SelectDueDecksCommand { get; }

    public IRelayCommand<string?> SelectFolderCommand { get; }
    public IAsyncRelayCommand<FlashcardFolderItemViewModel?> RenameFolderCommand { get; }
    public IAsyncRelayCommand<FlashcardFolderItemViewModel?> DeleteFolderCommand { get; }

    public IRelayCommand ToggleSidebarCommand { get; }

    public FlashcardsViewModel(
        IFlashcardDeckService deckService,
        INavigationService navigation,
        IOverlayService overlay,
        ILocalizationService localization,
        ISettingsService settingsService)
    {
        _deckService = deckService;
        _navigation = navigation;
        _overlay = overlay;
        _localization = localization;
        _settingsService = settingsService;

        RefreshCommand = new AsyncRelayCommand(LoadDecksAsync);
        OpenDeckCommand = new RelayCommand<FlashcardDeckRowViewModel?>(OpenDeck);
        StartReviewSessionCommand = new RelayCommand<FlashcardDeckRowViewModel?>(StartReviewSession);
        StartQuickSessionCommand = new RelayCommand<FlashcardDeckRowViewModel?>(StartQuickSession);
        StartCramSessionCommand = new RelayCommand<FlashcardDeckRowViewModel?>(StartCramSession);
        StartTestSessionCommand = new RelayCommand<FlashcardDeckRowViewModel?>(StartTestSession);
        OpenDeckSettingsCommand = new AsyncRelayCommand<FlashcardDeckRowViewModel?>(OpenDeckSettingsAsync);
        DeleteDeckCommand = new AsyncRelayCommand<FlashcardDeckRowViewModel?>(DeleteDeckAsync);
        CreateDeckCommand = new AsyncRelayCommand(CreateDeckAsync);
        CreateFolderCommand = new AsyncRelayCommand(CreateFolderAsync);
        SelectAllDecksCommand = new RelayCommand(SelectAllDecks);
        SelectDueDecksCommand = new RelayCommand(SelectDueFilter);
        ToggleSidebarCommand = new RelayCommand(ToggleSidebar);
        SelectFolderCommand = new RelayCommand<string?>(id =>
        {
            if (!string.IsNullOrEmpty(id))
                SelectFolder(id);
        });
        RenameFolderCommand = new AsyncRelayCommand<FlashcardFolderItemViewModel?>(RenameFolderAsync);
        DeleteFolderCommand = new AsyncRelayCommand<FlashcardFolderItemViewModel?>(DeleteFolderAsync);

        _ = LoadDecksAsync();
    }

    public void OnNavigatedTo(object? parameter)
    {
        _ = LoadDecksAsync();
    }

    partial void OnSearchTextChanged(string value) => ApplyFilter();

    partial void OnSelectedFolderIdChanged(string? value) => ApplyFilter();

    partial void OnIsSidebarOpenChanged(bool value)
    {
        if (_sidebarStateLoaded)
            _ = _settingsService.SetAsync(FlashcardsSidebarOpenKey, value);
    }

    private async Task LoadDecksAsync()
    {
        var folders = await _deckService.ListFoldersAsync().ConfigureAwait(false);
        var decks = await _deckService.ListDecksAsync().ConfigureAwait(false);
        var sidebarOpen = await _settingsService.GetAsync(FlashcardsSidebarOpenKey, true).ConfigureAwait(false);

        _loadedDecks = decks;
        _loadedFolders = folders;

        await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
        {
            _sidebarStateLoaded = false;
            IsSidebarOpen = sidebarOpen;
            _sidebarStateLoaded = true;

            Folders.Clear();
            foreach (var f in folders)
                Folders.Add(f);

            RebuildFolderTree();

            ApplyFilter();
        });
    }

    private void ApplyFilter()
    {
        var now = DateTimeOffset.UtcNow;
        IEnumerable<FlashcardDeck> query = _loadedDecks;

        if (SelectedFolderId == DueFilterToken)
            query = query.Where(d => d.Cards.Any(c => c.DueDate <= now));
        else if (!string.IsNullOrEmpty(SelectedFolderId))
        {
            var folderIds = GetSelectedFolderFamily(SelectedFolderId);
            query = query.Where(d => d.FolderId != null && folderIds.Contains(d.FolderId));
        }

        if (!string.IsNullOrWhiteSpace(SearchText))
        {
            var q = SearchText.Trim();
            query = query.Where(d => d.Name.Contains(q, StringComparison.OrdinalIgnoreCase));
        }

        FilteredDecks.Clear();
        foreach (var d in query.OrderBy(d => d.Name))
        {
            var due = d.Cards.Count(c => c.DueDate <= now);
            var dueBadge = due > 0
                ? string.Format(System.Globalization.CultureInfo.CurrentCulture,
                    _localization.T("DueCountFormat", "Flashcards"), due)
                : string.Empty;
            var lastLine = d.LastStudied.HasValue
                ? string.Format(System.Globalization.CultureInfo.CurrentCulture,
                    _localization.T("DeckLastStudiedFormat", "Flashcards"),
                    d.LastStudied.Value.ToLocalTime().ToString("d", System.Globalization.CultureInfo.CurrentCulture))
                : _localization.T("DeckNeverStudied", "Flashcards");
            var cardCountLine = string.Format(System.Globalization.CultureInfo.CurrentCulture,
                _localization.T("DeckCardCountFormat", "Flashcards"), d.Cards.Count);

            FilteredDecks.Add(new FlashcardDeckRowViewModel
            {
                Id = d.Id,
                Name = d.Name,
                DueCount = due,
                TotalCards = d.Cards.Count,
                RetentionScore = d.RetentionScore,
                FolderId = d.FolderId,
                DueBadgeText = dueBadge,
                CardCountLine = cardCountLine,
                LastStudiedLine = lastLine
            });
        }

        ShowEmptyState = _loadedDecks.Count == 0;
        ShowNoResultsState = _loadedDecks.Count > 0 && FilteredDecks.Count == 0;
    }

    private void OpenDeck(FlashcardDeckRowViewModel? row)
    {
        if (row == null || string.IsNullOrEmpty(row.Id))
            return;

        _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(row.Id));
    }

    private void StartReviewSession(FlashcardDeckRowViewModel? row) =>
        StartSession(row, FlashcardSessionType.Review);

    private void StartQuickSession(FlashcardDeckRowViewModel? row)
    {
        StartSession(row, FlashcardSessionType.Quick);
    }

    private void StartCramSession(FlashcardDeckRowViewModel? row) =>
        StartSession(row, FlashcardSessionType.Cram);

    private void StartTestSession(FlashcardDeckRowViewModel? row) =>
        StartSession(row, FlashcardSessionType.Test);

    private void StartSession(FlashcardDeckRowViewModel? row, FlashcardSessionType sessionType)
    {
        if (row == null || string.IsNullOrWhiteSpace(row.Id))
            return;

        var config = new FlashcardSessionConfig(
            sessionType,
            row.Id,
            null,
            null,
            sessionType == FlashcardSessionType.Cram,
            null);
        _navigation.NavigateTo("flashcard-practice", new FlashcardPracticeNavigationParameter(row.Id, config));
    }

    private async Task CreateDeckAsync()
    {
        var id = Guid.NewGuid().ToString("n");
        var name = _localization.T("DefaultDeckName", "Flashcards");
        var deck = new FlashcardDeck(
            id,
            name,
            GetSelectedFolderForCreate(),
            null,
            Array.Empty<string>(),
            null,
            0,
            Array.Empty<Flashcard>(),
            FlashcardSchedulingAlgorithm.Fsrs);

        await _deckService.SaveDeckAsync(deck).ConfigureAwait(false);
        await LoadDecksAsync().ConfigureAwait(false);
        _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(id));
    }

    public void SelectAllDecks() => SelectedFolderId = null;

    public void SelectDueFilter() => SelectedFolderId = DueFilterToken;

    public void SelectFolder(string folderId) => SelectedFolderId = folderId;

    public void ToggleSidebar() => IsSidebarOpen = !IsSidebarOpen;

    public async Task MoveDeckToFolderAsync(string deckId, string targetFolderId)
    {
        if (string.IsNullOrWhiteSpace(deckId) || string.IsNullOrWhiteSpace(targetFolderId))
            return;

        var existing = _loadedDecks.FirstOrDefault(d => string.Equals(d.Id, deckId, StringComparison.Ordinal));
        if (existing is null)
            return;

        if (string.Equals(existing.FolderId, targetFolderId, StringComparison.Ordinal))
            return;

        await _deckService.SaveDeckAsync(existing with { FolderId = targetFolderId }).ConfigureAwait(false);
        await LoadDecksAsync().ConfigureAwait(false);
    }

    private async Task OpenDeckSettingsAsync(FlashcardDeckRowViewModel? row)
    {
        if (row == null || string.IsNullOrWhiteSpace(row.Id))
            return;

        var deck = await _deckService.GetDeckByIdAsync(row.Id).ConfigureAwait(false);
        if (deck is null)
            return;
        var folders = await _deckService.ListFoldersAsync().ConfigureAwait(false);

        await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
        {
            var view = new FlashcardDeckSettingsOverlay
            {
                Title = "Deck settings",
                SaveText = _localization.T("Save", "Common"),
                CancelText = _localization.T("Cancel", "Common")
            };
            view.Initialize(deck.Name, deck.SchedulingAlgorithm, deck.FolderId, deck.Description, folders);

            var id = _overlay.CreateOverlay(view, new OverlayOptions
            {
                HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
                VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
                ShowBackdrop = true,
                CloseOnOutsideClick = true,
                CloseOnEscape = true
            }, "FlashcardDeckSettings");

            view.OnResult = result =>
            {
                _overlay.CloseOverlay(id);
                if (result is null)
                    return;

                _ = Task.Run(async () =>
                {
                    var refreshed = await _deckService.GetDeckByIdAsync(row.Id).ConfigureAwait(false);
                    if (refreshed is null)
                        return;
                    await _deckService.SaveDeckAsync(refreshed with
                    {
                        SchedulingAlgorithm = result.SchedulingAlgorithm,
                        FolderId = result.FolderId,
                        Description = result.Description
                    }).ConfigureAwait(false);
                    await LoadDecksAsync().ConfigureAwait(false);
                });
            };
        });
    }

    private async Task DeleteDeckAsync(FlashcardDeckRowViewModel? row)
    {
        if (row == null || string.IsNullOrWhiteSpace(row.Id))
            return;

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

        await _deckService.DeleteDeckAsync(row.Id).ConfigureAwait(false);
        await LoadDecksAsync().ConfigureAwait(false);
    }

    public async Task MoveFolderAsync(string sourceFolderId, string targetFolderId, bool dropIntoFolder, bool insertAfterTarget)
    {
        if (string.IsNullOrWhiteSpace(sourceFolderId) || string.IsNullOrWhiteSpace(targetFolderId))
            return;
        if (string.Equals(sourceFolderId, targetFolderId, StringComparison.Ordinal))
            return;

        var source = _loadedFolders.FirstOrDefault(f => string.Equals(f.Id, sourceFolderId, StringComparison.Ordinal));
        var target = _loadedFolders.FirstOrDefault(f => string.Equals(f.Id, targetFolderId, StringComparison.Ordinal));
        if (source is null)
            return;
        if (target is null)
            return;

        if (dropIntoFolder)
        {
            if (IsDescendantFolder(targetFolderId, sourceFolderId))
                return;

            var siblingOrder = _loadedFolders
                .Where(f => !string.Equals(f.Id, sourceFolderId, StringComparison.Ordinal) &&
                            string.Equals(f.ParentId, targetFolderId, StringComparison.Ordinal))
                .Select(f => f.Order)
                .DefaultIfEmpty(-1)
                .Max() + 1;

            await _deckService.SaveFolderAsync(source with { ParentId = targetFolderId, Order = siblingOrder }).ConfigureAwait(false);
            await NormalizeFolderOrderAsync(source with { ParentId = targetFolderId, Order = siblingOrder }).ConfigureAwait(false);
            await LoadDecksAsync().ConfigureAwait(false);
            return;
        }

        var targetParentId = target.ParentId;
        if (!string.IsNullOrEmpty(targetParentId) && IsDescendantFolder(targetParentId, sourceFolderId))
            return;

        var siblings = _loadedFolders
            .Where(f => !string.Equals(f.Id, sourceFolderId, StringComparison.Ordinal) &&
                        string.Equals(f.ParentId, targetParentId, StringComparison.Ordinal))
            .OrderBy(f => f.Order)
            .ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var targetIndex = siblings.FindIndex(f => string.Equals(f.Id, targetFolderId, StringComparison.Ordinal));
        if (targetIndex < 0)
            return;

        var insertIndex = insertAfterTarget ? targetIndex + 1 : targetIndex;
        insertIndex = Math.Clamp(insertIndex, 0, siblings.Count);
        siblings.Insert(insertIndex, source with { ParentId = targetParentId });

        for (var index = 0; index < siblings.Count; index++)
        {
            var folder = siblings[index];
            if (!string.Equals(folder.ParentId, targetParentId, StringComparison.Ordinal) || folder.Order != index)
                await _deckService.SaveFolderAsync(folder with { ParentId = targetParentId, Order = index }).ConfigureAwait(false);
        }

        await LoadDecksAsync().ConfigureAwait(false);
    }

    private async Task CreateFolderAsync()
    {
        var parentId = GetSelectedFolderForCreate();
        var order = _loadedFolders
            .Where(f => string.Equals(f.ParentId, parentId, StringComparison.Ordinal))
            .Select(f => f.Order)
            .DefaultIfEmpty(-1)
            .Max() + 1;
        var folder = new FlashcardFolder(
            Guid.NewGuid().ToString("n"),
            _localization.T("NewFolderName", "Flashcards"),
            parentId,
            order);
        await _deckService.SaveFolderAsync(folder).ConfigureAwait(false);
        await LoadDecksAsync().ConfigureAwait(false);
    }

    private async Task RenameFolderAsync(FlashcardFolderItemViewModel? folderItem)
    {
        if (folderItem is null || string.IsNullOrWhiteSpace(folderItem.Id))
            return;

        var existing = _loadedFolders.FirstOrDefault(f => string.Equals(f.Id, folderItem.Id, StringComparison.Ordinal));
        if (existing is null)
            return;

        var trimmedName = folderItem.Name.Trim();
        if (string.IsNullOrWhiteSpace(trimmedName))
        {
            folderItem.Name = existing.Name;
            return;
        }

        if (string.Equals(existing.Name, trimmedName, StringComparison.Ordinal))
            return;

        await _deckService.SaveFolderAsync(existing with { Name = trimmedName }).ConfigureAwait(false);
        await LoadDecksAsync().ConfigureAwait(false);
    }

    private async Task DeleteFolderAsync(FlashcardFolderItemViewModel? folderItem)
    {
        if (folderItem is null || string.IsNullOrWhiteSpace(folderItem.Id))
            return;

        var folderId = folderItem.Id;
        var folder = _loadedFolders.FirstOrDefault(f => string.Equals(f.Id, folderId, StringComparison.Ordinal));
        if (folder is null)
            return;

        // Match notes behavior: direct children are lifted to root when parent folder is deleted.
        var rootOrderStart = _loadedFolders
            .Where(f => f.ParentId is null && !string.Equals(f.Id, folderId, StringComparison.Ordinal))
            .Select(f => f.Order)
            .DefaultIfEmpty(-1)
            .Max() + 1;
        var childFolders = _loadedFolders
            .Where(f => string.Equals(f.ParentId, folderId, StringComparison.Ordinal))
            .OrderBy(f => f.Order)
            .ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();
        for (var index = 0; index < childFolders.Length; index++)
        {
            await _deckService.SaveFolderAsync(
                childFolders[index] with { ParentId = null, Order = rootOrderStart + index }).ConfigureAwait(false);
        }

        var directDecks = _loadedDecks.Where(d => string.Equals(d.FolderId, folderId, StringComparison.Ordinal)).ToArray();
        foreach (var deck in directDecks)
            await _deckService.SaveDeckAsync(deck with { FolderId = null }).ConfigureAwait(false);

        await _deckService.DeleteFolderAsync(folderId).ConfigureAwait(false);

        if (string.Equals(SelectedFolderId, folderId, StringComparison.Ordinal) ||
            (!string.IsNullOrWhiteSpace(SelectedFolderId) && IsDescendantFolder(SelectedFolderId!, folderId)))
        {
            SelectedFolderId = null;
        }

        await LoadDecksAsync().ConfigureAwait(false);
    }

    private string? GetSelectedFolderForCreate()
    {
        if (string.IsNullOrEmpty(SelectedFolderId) || SelectedFolderId == DueFilterToken)
            return null;
        return SelectedFolderId;
    }

    private HashSet<string> GetSelectedFolderFamily(string selectedFolderId)
    {
        var childrenByParent = _loadedFolders
            .GroupBy(f => f.ParentId, StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key ?? RootFolderKey,
                g => g.Select(f => f.Id).ToArray(),
                StringComparer.Ordinal);
        var result = new HashSet<string>(StringComparer.Ordinal);
        var queue = new Queue<string>();
        queue.Enqueue(selectedFolderId);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!result.Add(current))
                continue;
            if (!childrenByParent.TryGetValue(current, out var children))
                continue;
            foreach (var child in children)
                queue.Enqueue(child);
        }

        return result;
    }

    private bool IsDescendantFolder(string candidateFolderId, string ancestorFolderId)
    {
        var byId = _loadedFolders.ToDictionary(f => f.Id, StringComparer.Ordinal);
        var current = candidateFolderId;
        while (byId.TryGetValue(current, out var folder) && !string.IsNullOrEmpty(folder.ParentId))
        {
            if (string.Equals(folder.ParentId, ancestorFolderId, StringComparison.Ordinal))
                return true;
            current = folder.ParentId;
        }

        return false;
    }

    private async Task NormalizeFolderOrderAsync(FlashcardFolder movedFolder)
    {
        var parentId = movedFolder.ParentId;
        var siblings = _loadedFolders
            .Where(f => string.Equals(f.ParentId, parentId, StringComparison.Ordinal))
            .OrderBy(f => f.Order)
            .ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var movedIndex = siblings.FindIndex(f => string.Equals(f.Id, movedFolder.Id, StringComparison.Ordinal));
        if (movedIndex >= 0)
        {
            siblings.RemoveAt(movedIndex);
            siblings.Add(movedFolder);
        }

        for (var index = 0; index < siblings.Count; index++)
        {
            if (siblings[index].Order != index)
                await _deckService.SaveFolderAsync(siblings[index] with { Order = index }).ConfigureAwait(false);
        }
    }

    private void RebuildFolderTree()
    {
        FolderTreeItems.Clear();
        FlatFolderItems.Clear();
        var byParent = _loadedFolders
            .GroupBy(f => f.ParentId, StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key ?? RootFolderKey,
                g => g.OrderBy(f => f.Order).ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase).ToArray(),
                StringComparer.Ordinal);

        AddFolderChildren(FolderTreeItems, byParent, RootFolderKey, 0);
        foreach (var root in FolderTreeItems)
            FlattenFolderTree(root, FlatFolderItems);
    }

    private static void AddFolderChildren(
        ICollection<FlashcardFolderItemViewModel> target,
        IReadOnlyDictionary<string, FlashcardFolder[]> byParent,
        string parentId,
        int depth)
    {
        if (!byParent.TryGetValue(parentId, out var folders))
            return;
        foreach (var folder in folders)
        {
            var vm = new FlashcardFolderItemViewModel(folder.Id, folder.Name, folder.ParentId, folder.Order, depth);
            target.Add(vm);
            AddFolderChildren(vm.Children, byParent, folder.Id, depth + 1);
        }
    }

    private static void FlattenFolderTree(FlashcardFolderItemViewModel source, ICollection<FlashcardFolderItemViewModel> target)
    {
        target.Add(source);
        foreach (var child in source.Children)
            FlattenFolderTree(child, target);
    }
}
