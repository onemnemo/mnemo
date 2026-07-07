using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Modules.Mindmap.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>Column the library grid is ordered by.</summary>
public enum MindmapSortMode
{
    Recent,
    Name,
    Nodes
}

/// <summary>
/// Library home for mindmaps: a finder-style grid of folders and maps with drill-in navigation, a
/// "jump back in" strip, and linked-deck due badges bridging to Flashcards. Runs on the schema v2
/// <see cref="IMindmapService"/> library surface (folders + folder membership as row metadata).
/// </summary>
public partial class MindmapOverviewViewModel : ViewModelBase, INavigationAware
{
    private const int RecentCount = 3;

    private readonly IMindmapService _mindmapService;
    private readonly IFlashcardStudyService _studyService;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILoggerService _logger;
    private readonly IDateDisplayService _dateDisplay;
    private readonly ILocalizationService _localization;

    // Raw loaded data (source of truth for structural queries).
    private List<MindmapLibraryEntry> _maps = new();
    private List<MindmapFolder> _folders = new();
    private Dictionary<string, MindmapItemViewModel> _itemsById = new(StringComparer.Ordinal);

    [ObservableProperty]
    private string _searchText = string.Empty;

    [ObservableProperty]
    private bool _isGridView = true;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _showEmptyState;

    [ObservableProperty]
    private bool _showNoResultsState;

    /// <summary>Current folder id being viewed; null means the library root.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsFolderView))]
    [NotifyPropertyChangedFor(nameof(IsRootView))]
    private string? _currentFolderId;

    public bool IsRootView => CurrentFolderId is null;
    public bool IsFolderView => CurrentFolderId is not null;

    [ObservableProperty]
    private string _currentFolderName = string.Empty;

    /// <summary>Page/folder subtitle line (counts + due + updated).</summary>
    [ObservableProperty]
    private string _headerCountLine = string.Empty;

    [ObservableProperty]
    private bool _showRecent;

    [ObservableProperty]
    private string _mapsHeaderLabel = string.Empty;

    [ObservableProperty]
    private int _mapsHeaderCount;

    [ObservableProperty]
    private string _searchPlaceholder = string.Empty;

    /// <summary>Label for the dashed new-map tile (folder-aware).</summary>
    [ObservableProperty]
    private string _newTileLabel = string.Empty;

    [ObservableProperty]
    private MindmapSortMode _sortMode = MindmapSortMode.Recent;

    [ObservableProperty]
    private string _sortLabel = string.Empty;

    /// <summary>Maps surfaced in the "jump back in" strip (root only).</summary>
    public ObservableCollection<MindmapItemViewModel> RecentItems { get; } = new();

    /// <summary>Folder tiles then map tiles (plus a dashed new-map tile inside a folder).</summary>
    public ObservableCollection<object> GridItems { get; } = new();

    /// <summary>Clickable folder path shown in folder view.</summary>
    public ObservableCollection<MindmapBreadcrumbSegment> Breadcrumbs { get; } = new();

    public ICommand CreateCommand { get; }
    public ICommand CreateFolderCommand { get; }
    public ICommand OpenMindmapCommand { get; }
    public ICommand OpenFolderCommand { get; }
    public ICommand NavigateToFolderCommand { get; }
    public ICommand NavigateUpCommand { get; }
    public ICommand SetSortCommand { get; }
    public ICommand RenameFolderCommand { get; }
    public ICommand DeleteFolderCommand { get; }
    public ICommand RenameCurrentFolderCommand { get; }
    public ICommand DeleteCurrentFolderCommand { get; }

    // Convenience for the code-behind transfer/export handlers.
    public IReadOnlyList<MindmapItemViewModel> AllItems => _itemsById.Values.ToList();

    public MindmapOverviewViewModel(
        IMindmapService mindmapService,
        IFlashcardStudyService studyService,
        INavigationService navigation,
        IOverlayService overlay,
        ILoggerService logger,
        IDateDisplayService dateDisplay,
        ILocalizationService localization)
    {
        _mindmapService = mindmapService;
        _studyService = studyService;
        _navigation = navigation;
        _overlay = overlay;
        _logger = logger;
        _dateDisplay = dateDisplay;
        _localization = localization;

        CreateCommand = new AsyncRelayCommand(CreateNewMindmapAsync);
        CreateFolderCommand = new AsyncRelayCommand(CreateNewFolderAsync);
        OpenMindmapCommand = new RelayCommand<MindmapItemViewModel>(OpenMindmap);
        OpenFolderCommand = new RelayCommand<MindmapFolderItemViewModel>(OpenFolder);
        NavigateToFolderCommand = new RelayCommand<string?>(NavigateToFolder);
        NavigateUpCommand = new RelayCommand(NavigateUp);
        SetSortCommand = new RelayCommand<string?>(SetSort);
        RenameFolderCommand = new AsyncRelayCommand<MindmapFolderItemViewModel?>(RenameFolderAsync);
        DeleteFolderCommand = new AsyncRelayCommand<MindmapFolderItemViewModel?>(DeleteFolderAsync);
        RenameCurrentFolderCommand = new AsyncRelayCommand(RenameCurrentFolderAsync);
        DeleteCurrentFolderCommand = new AsyncRelayCommand(DeleteCurrentFolderAsync);

        UpdateSortLabel();
        _ = LoadAsync();
    }

    public void OnNavigatedTo(object? parameter) => _ = LoadAsync();

    public void OnNavigatedFrom()
    {
        GridItems.Clear();
        RecentItems.Clear();
        Breadcrumbs.Clear();
    }

    partial void OnSearchTextChanged(string value) => RebuildView();

    partial void OnSortModeChanged(MindmapSortMode value)
    {
        UpdateSortLabel();
        RebuildView();
    }

    public Task RefreshAsync() => LoadAsync();

    // --- Loading -----------------------------------------------------------

    private async Task LoadAsync()
    {
        if (IsLoading) return;
        IsLoading = true;
        try
        {
            var mapsResult = await _mindmapService.GetLibraryAsync().ConfigureAwait(false);
            var foldersResult = await _mindmapService.GetFoldersAsync().ConfigureAwait(false);

            var maps = (mapsResult.IsSuccess && mapsResult.Value != null
                ? mapsResult.Value
                : Enumerable.Empty<MindmapLibraryEntry>()).ToList();
            var folders = (foldersResult.IsSuccess && foldersResult.Value != null
                ? foldersResult.Value
                : Array.Empty<MindmapFolder>()).ToList();

            var linkedDeckIds = maps
                .SelectMany(m => m.LinkedDeckIds)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var duePerDeck = await GetDuePerDeckAsync(linkedDeckIds).ConfigureAwait(false);

            var folderNamesById = folders.ToDictionary(f => f.Id, f => f.Name, StringComparer.Ordinal);

            var itemsById = new Dictionary<string, MindmapItemViewModel>(StringComparer.Ordinal);
            foreach (var entry in maps)
            {
                var map = entry.Document;
                var due = entry.LinkedDeckIds
                    .Where(id => duePerDeck.ContainsKey(id))
                    .Sum(id => duePerDeck[id]);
                var lastModified = _dateDisplay.FormatSmart(map.ModifiedAt);
                var folderName = entry.FolderId != null && folderNamesById.TryGetValue(entry.FolderId, out var fn) ? fn : null;

                var item = new MindmapItemViewModel
                {
                    Id = map.Id,
                    Name = map.Title,
                    FolderId = entry.FolderId,
                    NodeCount = map.Elements.Count,
                    EdgeCount = map.Edges.Count,
                    LastModified = lastModified,
                    MetaLine = string.Format(CultureInfo.CurrentCulture, T("MapMetaFormat"), map.Elements.Count, lastModified),
                    ContextLine = folderName is null
                        ? lastModified
                        : string.Format(CultureInfo.CurrentCulture, T("MapContextFormat"), folderName, lastModified),
                    LayoutLabel = LayoutLabelFor(map.Clusters.FirstOrDefault()?.LayoutAlgorithm),
                    DueCount = due,
                    DueLabel = string.Format(CultureInfo.CurrentCulture, T("DueCountFormat"), due),
                };
                MindmapPreviewBuilder.PopulatePreviews(item, map);
                itemsById[map.Id] = item;
            }

            await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
            {
                _maps = maps;
                _folders = folders;
                _itemsById = itemsById;
                RebuildView();
            });
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Failed to load mindmap library", ex);
        }
        finally
        {
            IsLoading = false;
        }
    }

    // --- View rebuild ------------------------------------------------------

    private void RebuildView()
    {
        var term = SearchText.Trim();
        var searching = term.Length > 0;
        bool Matches(string name) => !searching || name.Contains(term, StringComparison.OrdinalIgnoreCase);

        var knownFolderIds = _folders.Select(f => f.Id).ToHashSet(StringComparer.Ordinal);

        // Folders at this level.
        var levelFolders = _folders
            .Where(f => string.Equals(f.ParentId, CurrentFolderId, StringComparison.Ordinal))
            .OrderBy(f => f.Order)
            .ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase)
            .Where(f => Matches(f.Name))
            .Select(BuildFolderItem)
            .ToList();

        // Maps at this level (orphans whose folder no longer exists surface at root).
        var levelMaps = _maps
            .Where(m => string.Equals(NormalizeFolder(m.FolderId, knownFolderIds), CurrentFolderId, StringComparison.Ordinal))
            .Where(m => Matches(m.Document.Title))
            .Select(m => _itemsById[m.Document.Id])
            .ToList();
        levelMaps = SortMaps(levelMaps).ToList();

        GridItems.Clear();
        foreach (var folder in levelFolders)
            GridItems.Add(folder);
        foreach (var map in levelMaps)
            GridItems.Add(map);
        if (IsFolderView && !searching)
            GridItems.Add(MindmapNewTilePlaceholder.Instance);

        // Jump back in (root, not searching).
        RecentItems.Clear();
        if (IsRootView && !searching)
        {
            foreach (var map in _maps
                         .OrderByDescending(m => m.Document.ModifiedAt)
                         .Take(RecentCount))
            {
                if (_itemsById.TryGetValue(map.Document.Id, out var item))
                    RecentItems.Add(item);
            }
        }
        ShowRecent = RecentItems.Count > 0;

        UpdateHeader(levelFolders, levelMaps, knownFolderIds);
        UpdateBreadcrumb();

        var hasAnything = _maps.Count > 0 || _folders.Count > 0;
        ShowEmptyState = !hasAnything;
        ShowNoResultsState = hasAnything && searching && GridItems.Count == 0;

        SearchPlaceholder = IsFolderView
            ? string.Format(CultureInfo.CurrentCulture, T("SearchInFolder"), CurrentFolderName)
            : T("SearchMindmaps");
    }

    private void UpdateHeader(
        IReadOnlyList<MindmapFolderItemViewModel> levelFolders,
        IReadOnlyList<MindmapItemViewModel> levelMaps,
        HashSet<string> knownFolderIds)
    {
        if (IsRootView)
        {
            CurrentFolderName = string.Empty;
            MapsHeaderLabel = T("AllMaps");
            MapsHeaderCount = _maps.Count;
            var folderCount = _folders.Count;
            HeaderCountLine = string.Format(CultureInfo.CurrentCulture, T("RootCountFormat"), _maps.Count, folderCount);
            NewTileLabel = T("NewMap");
            return;
        }

        var folder = _folders.FirstOrDefault(f => string.Equals(f.Id, CurrentFolderId, StringComparison.Ordinal));
        CurrentFolderName = folder?.Name ?? string.Empty;
        MapsHeaderLabel = T("MapsLabel");
        NewTileLabel = string.Format(CultureInfo.CurrentCulture, T("NewMapInFolder"), CurrentFolderName);

        var directMaps = _maps.Count(m => string.Equals(m.FolderId, CurrentFolderId, StringComparison.Ordinal));
        MapsHeaderCount = directMaps;

        var subtreeMapIds = SubtreeMapIds(CurrentFolderId!);
        var subtreeMapCount = subtreeMapIds.Count;
        var subtreeDue = subtreeMapIds.Sum(id => _itemsById.TryGetValue(id, out var it) ? it.DueCount : 0);
        var updated = _maps
            .Where(m => subtreeMapIds.Contains(m.Document.Id))
            .Select(m => m.Document.ModifiedAt)
            .DefaultIfEmpty()
            .Max();
        var updatedText = updated == default ? "—" : _dateDisplay.FormatSmart(updated);

        HeaderCountLine = subtreeDue > 0
            ? string.Format(CultureInfo.CurrentCulture, T("FolderHeaderDueFormat"), subtreeMapCount, subtreeDue, updatedText)
            : string.Format(CultureInfo.CurrentCulture, T("FolderHeaderFormat"), subtreeMapCount, updatedText);
    }

    private void UpdateBreadcrumb()
    {
        Breadcrumbs.Clear();
        if (IsRootView)
            return;

        var byId = _folders.ToDictionary(f => f.Id, StringComparer.Ordinal);
        var chain = new List<MindmapBreadcrumbSegment>();
        var current = CurrentFolderId;
        var guard = 0;
        while (current != null && byId.TryGetValue(current, out var folder) && guard++ < 64)
        {
            chain.Insert(0, new MindmapBreadcrumbSegment(folder.Id, folder.Name));
            current = folder.ParentId;
        }
        chain.Insert(0, new MindmapBreadcrumbSegment(null, T("Title")));
        foreach (var seg in chain)
            Breadcrumbs.Add(seg);
    }

    private MindmapFolderItemViewModel BuildFolderItem(MindmapFolder folder)
    {
        var subtreeIds = SubtreeMapIds(folder.Id);
        var due = subtreeIds.Sum(id => _itemsById.TryGetValue(id, out var it) ? it.DueCount : 0);

        DateTime newest = default;
        MindmapItemViewModel? newestItem = null;
        foreach (var map in _maps.Where(m => subtreeIds.Contains(m.Document.Id)))
        {
            var mod = map.Document.ModifiedAt;
            if (mod >= newest && _itemsById.TryGetValue(map.Document.Id, out var it))
            {
                newest = mod;
                newestItem = it;
            }
        }

        var updatedText = newest == default ? "—" : _dateDisplay.FormatSmart(newest);
        var vm = new MindmapFolderItemViewModel
        {
            Id = folder.Id,
            Name = folder.Name,
            ParentId = folder.ParentId,
            MapCount = subtreeIds.Count,
            DueCount = due,
            MetaLine = string.Format(CultureInfo.CurrentCulture, T("FolderMetaFormat"), subtreeIds.Count, updatedText),
        };
        if (newestItem != null)
            MindmapPreviewBuilder.CopyPreviewTo(newestItem, vm);
        return vm;
    }

    /// <summary>All map ids inside a folder's subtree (direct + nested).</summary>
    private HashSet<string> SubtreeMapIds(string folderId)
    {
        var folderIds = new HashSet<string>(StringComparer.Ordinal) { folderId };
        var queue = new Queue<string>();
        queue.Enqueue(folderId);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            foreach (var child in _folders.Where(f => string.Equals(f.ParentId, current, StringComparison.Ordinal)))
            {
                if (folderIds.Add(child.Id))
                    queue.Enqueue(child.Id);
            }
        }
        return _maps
            .Where(m => m.FolderId != null && folderIds.Contains(m.FolderId))
            .Select(m => m.Document.Id)
            .ToHashSet(StringComparer.Ordinal);
    }

    private static string? NormalizeFolder(string? folderId, HashSet<string> knownFolderIds) =>
        folderId != null && knownFolderIds.Contains(folderId) ? folderId : null;

    private IEnumerable<MindmapItemViewModel> SortMaps(IEnumerable<MindmapItemViewModel> maps) => SortMode switch
    {
        MindmapSortMode.Name => maps.OrderBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase),
        MindmapSortMode.Nodes => maps.OrderByDescending(m => m.NodeCount).ThenBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase),
        _ => maps
            .OrderByDescending(m => MapModified(m.Id)).ThenBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase)
    };

    private DateTime MapModified(string id) =>
        _maps.FirstOrDefault(m => string.Equals(m.Document.Id, id, StringComparison.Ordinal))?.Document.ModifiedAt ?? DateTime.MinValue;

    // --- Navigation --------------------------------------------------------

    private void OpenMindmap(MindmapItemViewModel? item)
    {
        if (item != null && !string.IsNullOrEmpty(item.Id))
            _navigation.NavigateTo("mindmap-detail", item.Id);
    }

    private void OpenFolder(MindmapFolderItemViewModel? folder)
    {
        if (folder == null || string.IsNullOrEmpty(folder.Id))
            return;
        CurrentFolderId = folder.Id;
        SearchText = string.Empty;
        RebuildView();
    }

    private void NavigateToFolder(string? folderId)
    {
        CurrentFolderId = folderId;
        SearchText = string.Empty;
        RebuildView();
    }

    private void NavigateUp()
    {
        if (IsRootView)
            return;
        var folder = _folders.FirstOrDefault(f => string.Equals(f.Id, CurrentFolderId, StringComparison.Ordinal));
        NavigateToFolder(folder?.ParentId);
    }

    private void SetSort(string? mode)
    {
        if (Enum.TryParse<MindmapSortMode>(mode, ignoreCase: true, out var parsed))
            SortMode = parsed;
    }

    private void UpdateSortLabel()
    {
        var key = SortMode switch
        {
            MindmapSortMode.Name => "SortName",
            MindmapSortMode.Nodes => "SortNodes",
            _ => "SortRecent"
        };
        SortLabel = string.Format(CultureInfo.CurrentCulture, T("SortLabelFormat"), T(key));
    }

    // --- Mutations ---------------------------------------------------------

    private async Task CreateNewMindmapAsync()
    {
        var name = await PromptForNameAsync(T("CreateMindmapTitle"), T("NewMindmap")).ConfigureAwait(true);
        if (string.IsNullOrWhiteSpace(name))
            return;

        try
        {
            var result = await _mindmapService.CreateAsync(name, folderId: CurrentFolderId).ConfigureAwait(true);
            if (result.IsSuccess && result.Value != null)
                _navigation.NavigateTo("mindmap-detail", result.Value.Id);
            else
                await _overlay.CreateDialogAsync(T("ErrorTitle"), result.ErrorMessage ?? T("CreateFailed")).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Failed to create mindmap", ex);
        }
    }

    private async Task CreateNewFolderAsync()
    {
        var name = await PromptForNameAsync(T("CreateFolderTitle"), T("NewFolderName")).ConfigureAwait(true);
        if (string.IsNullOrWhiteSpace(name))
            return;

        var order = _folders
            .Where(f => string.Equals(f.ParentId, CurrentFolderId, StringComparison.Ordinal))
            .Select(f => f.Order)
            .DefaultIfEmpty(-1)
            .Max() + 1;
        var folder = new MindmapFolder(Guid.NewGuid().ToString("n"), name.Trim(), CurrentFolderId, order);
        var save = await _mindmapService.SaveFolderAsync(folder).ConfigureAwait(true);
        if (save.IsSuccess)
            await LoadAsync().ConfigureAwait(true);
    }

    private async Task RenameFolderAsync(MindmapFolderItemViewModel? folderItem)
    {
        if (folderItem == null || string.IsNullOrEmpty(folderItem.Id))
            return;
        var existing = _folders.FirstOrDefault(f => string.Equals(f.Id, folderItem.Id, StringComparison.Ordinal));
        if (existing == null)
            return;

        var name = await PromptForNameAsync(T("RenameFolderTitle"), existing.Name).ConfigureAwait(true);
        var trimmed = name?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed) || string.Equals(trimmed, existing.Name, StringComparison.Ordinal))
            return;

        var save = await _mindmapService.SaveFolderAsync(existing with { Name = trimmed }).ConfigureAwait(true);
        if (save.IsSuccess)
            await LoadAsync().ConfigureAwait(true);
    }

    private async Task DeleteFolderAsync(MindmapFolderItemViewModel? folderItem)
    {
        if (folderItem == null || string.IsNullOrEmpty(folderItem.Id))
            return;

        var confirm = await _overlay.CreateDialogAsync(
            T("DeleteFolderTitle"),
            string.Format(CultureInfo.CurrentCulture, T("DeleteFolderConfirm"), folderItem.Name),
            T("Delete"),
            T("Cancel"),
            confirmIconName: "Common/trash",
            severity: DialogSeverity.Destructive).ConfigureAwait(true);
        if (!string.Equals(confirm, T("Delete"), StringComparison.Ordinal))
            return;

        var result = await _mindmapService.DeleteFolderAsync(folderItem.Id).ConfigureAwait(true);
        if (result.IsSuccess)
            await LoadAsync().ConfigureAwait(true);
    }

    private async Task RenameCurrentFolderAsync()
    {
        var folder = _folders.FirstOrDefault(f => string.Equals(f.Id, CurrentFolderId, StringComparison.Ordinal));
        if (folder == null)
            return;
        await RenameFolderAsync(new MindmapFolderItemViewModel { Id = folder.Id, Name = folder.Name }).ConfigureAwait(true);
    }

    private async Task DeleteCurrentFolderAsync()
    {
        var folder = _folders.FirstOrDefault(f => string.Equals(f.Id, CurrentFolderId, StringComparison.Ordinal));
        if (folder == null)
            return;
        var parentId = folder.ParentId;
        await DeleteFolderAsync(new MindmapFolderItemViewModel { Id = folder.Id, Name = folder.Name }).ConfigureAwait(true);
        NavigateToFolder(parentId);
    }

    /// <summary>Moves a map into a folder (or to root when <paramref name="folderId"/> is null).</summary>
    public async Task MoveMapToFolderAsync(string mapId, string? folderId)
    {
        if (string.IsNullOrWhiteSpace(mapId))
            return;
        var entry = _maps.FirstOrDefault(m => string.Equals(m.Document.Id, mapId, StringComparison.Ordinal));
        if (entry != null && string.Equals(entry.FolderId, folderId, StringComparison.Ordinal))
            return;

        var move = await _mindmapService.MoveToFolderAsync(mapId, folderId).ConfigureAwait(true);
        if (move.IsSuccess)
            await LoadAsync().ConfigureAwait(true);
    }

    public IReadOnlyList<MindmapFolder> Folders => _folders;

    // --- Helpers -----------------------------------------------------------

    private Task<string?> PromptForNameAsync(string title, string initialValue)
        => _overlay.CreateInputDialogAsync(
            title: title,
            confirmText: T("Save"),
            cancelText: T("Cancel"),
            placeholder: T("NamePlaceholder"),
            initialValue: initialValue,
            confirmIconName: "Common/pencil");

    private string LayoutLabelFor(string? algorithm) => algorithm switch
    {
        MindmapLayoutAlgorithms.Radial => T("LayoutRadial"),
        MindmapLayoutAlgorithms.TreeRight or MindmapLayoutAlgorithms.TreeDown => T("LayoutTree"),
        _ => T("LayoutFree")
    };

    /// <summary>
    /// Due badge count per linked deck: <see cref="FlashcardDueCounts.Total"/> (new + learning + due
    /// review). Missing/errored decks are treated as zero due.
    /// </summary>
    private async Task<Dictionary<string, int>> GetDuePerDeckAsync(IReadOnlyList<string> deckIds)
    {
        var result = new Dictionary<string, int>(StringComparer.Ordinal);
        if (deckIds.Count == 0)
            return result;

        var tasks = deckIds.Select(async id =>
        {
            try
            {
                var counts = await _studyService.GetDueCountsAsync(id).ConfigureAwait(false);
                return (Id: id, Due: counts.Total);
            }
            catch (Exception ex)
            {
                _logger.Error("Mindmap", $"Failed to load due counts for deck '{id}'", ex);
                return (Id: id, Due: 0);
            }
        });

        var pairs = await Task.WhenAll(tasks).ConfigureAwait(false);
        foreach (var (id, due) in pairs)
            result[id] = due;

        return result;
    }

    private string T(string key) => _localization.T(key, "Mindmap");
}
