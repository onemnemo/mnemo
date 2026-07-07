using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>Column the deck tree is ordered by.</summary>
public enum FlashcardSortMode
{
    Due,
    Name,
    Retention,
    Cards
}

/// <summary>
/// Library home: a single unified tree of folders and decks with per-state metrics,
/// an aggregate study summary, sorting, and drag organization. Backed by the relational
/// flashcard services (deck/folder summaries, counts, and due aggregates).
/// </summary>
public partial class FlashcardsViewModel : ViewModelBase, INavigationAware
{
    private const string RootFolderKey = "__root__";

    /// <summary>Rough pace used only for the "about N min" study estimate (~11 cards/min).</summary>
    private const double CardsPerMinuteEstimate = 11d;

    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardStudyService _study;
    private readonly IFlashcardPresetService _presets;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILocalizationService _localization;

    private IReadOnlyList<FlashcardDeckSummary> _loadedDecks = Array.Empty<FlashcardDeckSummary>();
    private IReadOnlyList<FlashcardFolder> _loadedFolders = Array.Empty<FlashcardFolder>();

    private readonly record struct DeckStats(int New, int Learn, int ReviewDue, int Total, int Retention)
    {
        public int DueToday => New + Learn + ReviewDue;
    }

    private Dictionary<string, DeckStats> _statsByDeck = new(StringComparer.Ordinal);

    [ObservableProperty]
    private string _searchText = string.Empty;

    [ObservableProperty]
    private FlashcardSortMode _sortMode = FlashcardSortMode.Due;

    /// <summary>True when the library has no decks at all (first-run state).</summary>
    [ObservableProperty]
    private bool _showEmptyState;

    /// <summary>True when decks exist but the current search matches none.</summary>
    [ObservableProperty]
    private bool _showNoResultsState;

    [ObservableProperty]
    private bool _hasDueToday;

    /// <summary>True when the deck tree has at least one visible row.</summary>
    [ObservableProperty]
    private bool _showTree;

    // --- Page head ---
    [ObservableProperty]
    private string _headerSummaryText = string.Empty;

    // --- Study bar ---
    [ObservableProperty]
    private string _dueHeadlineText = string.Empty;
    [ObservableProperty]
    private string _dueDecksText = string.Empty;
    [ObservableProperty]
    private string _dueMinutesText = string.Empty;
    [ObservableProperty]
    private string _dueNewText = string.Empty;
    [ObservableProperty]
    private string _dueLearnText = string.Empty;
    [ObservableProperty]
    private string _dueReviewText = string.Empty;

    // --- Totals footer ---
    [ObservableProperty]
    private int _totalNew;
    [ObservableProperty]
    private int _totalLearn;
    [ObservableProperty]
    private int _totalDue;
    [ObservableProperty]
    private string _totalRetentionText = string.Empty;

    [ObservableProperty]
    private string _sortModeLabel = string.Empty;

    /// <summary>Persisted folder tree (survives expansion toggles); rebuilt only on data reload.</summary>
    private readonly ObservableCollection<FlashcardFolderItemViewModel> _folderTree = new();

    /// <summary>Flattened, ordered, visibility-filtered rows (folders + decks) for the tree control.</summary>
    public ObservableCollection<object> LibraryRows { get; } = new();

    public IAsyncRelayCommand RefreshCommand { get; }

    public IRelayCommand<FlashcardDeckRowViewModel?> OpenDeckCommand { get; }
    public IAsyncRelayCommand<FlashcardDeckRowViewModel?> DeleteDeckCommand { get; }

    public IAsyncRelayCommand CreateDeckCommand { get; }
    public IAsyncRelayCommand CreateFolderCommand { get; }

    public IRelayCommand<string?> SetSortCommand { get; }
    public IRelayCommand ToggleExpandCollapseAllCommand { get; }

    public IAsyncRelayCommand<FlashcardFolderItemViewModel?> RenameFolderCommand { get; }
    public IAsyncRelayCommand<FlashcardFolderItemViewModel?> DeleteFolderCommand { get; }

    public FlashcardsViewModel(
        IFlashcardLibraryService library,
        IFlashcardStudyService study,
        IFlashcardPresetService presets,
        INavigationService navigation,
        IOverlayService overlay,
        ILocalizationService localization)
    {
        _library = library;
        _study = study;
        _presets = presets;
        _navigation = navigation;
        _overlay = overlay;
        _localization = localization;

        RefreshCommand = new AsyncRelayCommand(LoadDecksAsync);
        OpenDeckCommand = new RelayCommand<FlashcardDeckRowViewModel?>(OpenDeck);
        DeleteDeckCommand = new AsyncRelayCommand<FlashcardDeckRowViewModel?>(DeleteDeckAsync);
        CreateDeckCommand = new AsyncRelayCommand(CreateDeckAsync);
        CreateFolderCommand = new AsyncRelayCommand(CreateFolderAsync);
        SetSortCommand = new RelayCommand<string?>(SetSort);
        ToggleExpandCollapseAllCommand = new RelayCommand(ToggleExpandCollapseAll);
        RenameFolderCommand = new AsyncRelayCommand<FlashcardFolderItemViewModel?>(RenameFolderAsync);
        DeleteFolderCommand = new AsyncRelayCommand<FlashcardFolderItemViewModel?>(DeleteFolderAsync);

        UpdateSortLabel();
        _ = LoadDecksAsync();
    }

    public void OnNavigatedTo(object? parameter) => _ = LoadDecksAsync();

    partial void OnSearchTextChanged(string value) => Recompute();

    partial void OnSortModeChanged(FlashcardSortMode value)
    {
        UpdateSortLabel();
        Recompute();
    }

    private async Task LoadDecksAsync()
    {
        var folders = await _library.ListFoldersAsync().ConfigureAwait(false);
        var decks = await _library.ListDecksAsync().ConfigureAwait(false);
        var aggregate = await _study.GetAggregateDueCountsAsync().ConfigureAwait(false);

        _loadedDecks = decks;
        _loadedFolders = folders;
        _aggregateDue = aggregate;

        await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
        {
            RebuildFolderTree();
            Recompute();
        });
    }

    /// <summary>Cap-aware aggregate due counts across all decks (drives the study-bar banner).</summary>
    private FlashcardDueCounts _aggregateDue = FlashcardDueCounts.Empty;

    // --- Stats -------------------------------------------------------------

    private static DeckStats ToStats(FlashcardDeckSummary summary) => new(
        summary.DueCounts.New,
        summary.DueCounts.Learning,
        summary.DueCounts.Due,
        summary.TotalCards,
        summary.RetentionPercent);

    // --- Rebuild -----------------------------------------------------------

    private void Recompute()
    {
        _statsByDeck = _loadedDecks.ToDictionary(d => d.Id, ToStats, StringComparer.Ordinal);

        var term = SearchText.Trim();
        var searching = term.Length > 0;
        bool Matches(FlashcardDeckSummary d) => !searching || d.Name.Contains(term, StringComparison.OrdinalIgnoreCase);

        var decksByFolder = _loadedDecks
            .GroupBy(d => d.Header.FolderId ?? RootFolderKey, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var knownFolderIds = _loadedFolders.Select(f => f.Id).ToHashSet(StringComparer.Ordinal);

        // Folder aggregates roll up every descendant deck (independent of search filter).
        foreach (var folder in _folderTree)
            ApplyFolderAggregates(folder, decksByFolder);

        LibraryRows.Clear();
        foreach (var root in _folderTree)
            AddFolderRows(root, decksByFolder, searching, Matches);

        var rootDecks = decksByFolder.TryGetValue(RootFolderKey, out var direct)
            ? direct.Where(d => d.Header.FolderId is null || !knownFolderIds.Contains(d.Header.FolderId))
            : Enumerable.Empty<FlashcardDeckSummary>();
        // Decks whose folder no longer exists surface at root too.
        var orphaned = _loadedDecks.Where(d => d.Header.FolderId != null && !knownFolderIds.Contains(d.Header.FolderId));
        foreach (var deck in SortDecks(rootDecks.Concat(orphaned).Distinct()).Where(Matches))
            LibraryRows.Add(CreateDeckRow(deck, depth: 0));

        UpdateSummary(Matches);

        ShowEmptyState = _loadedDecks.Count == 0;
        ShowNoResultsState = _loadedDecks.Count > 0 && LibraryRows.Count == 0;
        ShowTree = LibraryRows.Count > 0;
    }

    private void AddFolderRows(
        FlashcardFolderItemViewModel folder,
        IReadOnlyDictionary<string, List<FlashcardDeckSummary>> decksByFolder,
        bool searching,
        Func<FlashcardDeckSummary, bool> matches)
    {
        if (searching && !SubtreeHasMatch(folder, decksByFolder, matches))
            return;

        LibraryRows.Add(folder);

        var expanded = searching || folder.IsExpanded;
        if (!expanded)
            return;

        foreach (var child in folder.Children)
            AddFolderRows(child, decksByFolder, searching, matches);

        if (decksByFolder.TryGetValue(folder.Id, out var decks))
        {
            foreach (var deck in SortDecks(decks).Where(matches))
                LibraryRows.Add(CreateDeckRow(deck, folder.Depth + 1));
        }
    }

    private bool SubtreeHasMatch(
        FlashcardFolderItemViewModel folder,
        IReadOnlyDictionary<string, List<FlashcardDeckSummary>> decksByFolder,
        Func<FlashcardDeckSummary, bool> matches)
    {
        if (decksByFolder.TryGetValue(folder.Id, out var decks) && decks.Any(matches))
            return true;
        return folder.Children.Any(child => SubtreeHasMatch(child, decksByFolder, matches));
    }

    private DeckStats ApplyFolderAggregates(
        FlashcardFolderItemViewModel folder,
        IReadOnlyDictionary<string, List<FlashcardDeckSummary>> decksByFolder)
    {
        var sum = new DeckStats(0, 0, 0, 0, 0);
        var deckCount = 0;

        if (decksByFolder.TryGetValue(folder.Id, out var decks))
        {
            foreach (var deck in decks)
            {
                if (!_statsByDeck.TryGetValue(deck.Id, out var s))
                    continue;
                sum = new DeckStats(sum.New + s.New, sum.Learn + s.Learn, sum.ReviewDue + s.ReviewDue, 0, 0);
                deckCount++;
            }
        }

        foreach (var child in folder.Children)
        {
            var childSum = ApplyFolderAggregates(child, decksByFolder);
            sum = new DeckStats(sum.New + childSum.New, sum.Learn + childSum.Learn, sum.ReviewDue + childSum.ReviewDue, 0, 0);
            deckCount += child.DeckCount;
        }

        folder.NewCount = sum.New;
        folder.LearnCount = sum.Learn;
        folder.ReviewDueCount = sum.ReviewDue;
        folder.DeckCount = deckCount;
        folder.DeckCountLabel = string.Format(CultureInfo.CurrentCulture, _localization.T("DeckCountFormat", "Flashcards"), deckCount);
        return sum;
    }

    private FlashcardDeckRowViewModel CreateDeckRow(FlashcardDeckSummary deck, int depth)
    {
        var s = _statsByDeck.TryGetValue(deck.Id, out var stats) ? stats : ToStats(deck);
        return new FlashcardDeckRowViewModel
        {
            Id = deck.Id,
            Name = deck.Name,
            FolderId = deck.Header.FolderId,
            Depth = depth,
            NewCount = s.New,
            LearnCount = s.Learn,
            ReviewDueCount = s.ReviewDue,
            TotalCards = s.Total,
            ActiveCards = deck.ActiveCards,
            RetentionScore = s.Retention,
            CardCountLine = string.Format(CultureInfo.CurrentCulture, _localization.T("DeckCardCountFormat", "Flashcards"), s.Total)
        };
    }

    private IEnumerable<FlashcardDeckSummary> SortDecks(IEnumerable<FlashcardDeckSummary> decks) => SortMode switch
    {
        FlashcardSortMode.Name => decks.OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase),
        FlashcardSortMode.Retention => decks.OrderByDescending(d => d.RetentionPercent).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase),
        FlashcardSortMode.Cards => decks.OrderByDescending(d => d.TotalCards).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase),
        _ => decks.OrderByDescending(Due).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
    };

    private int Due(FlashcardDeckSummary deck) => _statsByDeck.TryGetValue(deck.Id, out var s) ? s.DueToday : 0;

    private void UpdateSummary(Func<FlashcardDeckSummary, bool> matches)
    {
        var visible = _loadedDecks.Where(matches).ToList();
        var weightedRetention = 0d;
        var cardTotal = 0;
        var deckTotal = 0;
        var totalCardsAll = 0;

        // Footer totals mirror the visible (filtered) deck set.
        var footerNew = 0;
        var footerLearn = 0;
        var footerReview = 0;

        foreach (var deck in visible)
        {
            if (!_statsByDeck.TryGetValue(deck.Id, out var s))
                continue;
            footerNew += s.New;
            footerLearn += s.Learn;
            footerReview += s.ReviewDue;
            weightedRetention += (double)s.Retention * Math.Max(1, s.Total);
            cardTotal += Math.Max(1, s.Total);
            totalCardsAll += s.Total;
            deckTotal++;
        }

        // The study-bar banner uses the cap-aware aggregate due counts (across all decks, not just the
        // filtered view) and the count of decks that currently have something due.
        var bannerNew = _aggregateDue.New;
        var bannerLearn = _aggregateDue.Learning;
        var bannerReview = _aggregateDue.Due;
        var bannerTotal = _aggregateDue.Total;
        var dueDecks = _loadedDecks.Count(d => _statsByDeck.TryGetValue(d.Id, out var s) && s.DueToday > 0);

        HasDueToday = bannerTotal > 0;

        var minutes = Math.Max(1, (int)Math.Round(bannerTotal / CardsPerMinuteEstimate, MidpointRounding.AwayFromZero));
        DueHeadlineText = string.Format(CultureInfo.CurrentCulture, _localization.T("DueTodayCountFormat", "Flashcards"), bannerTotal);
        DueDecksText = string.Format(CultureInfo.CurrentCulture, _localization.T("DeckCountFormat", "Flashcards"), dueDecks);
        DueMinutesText = string.Format(CultureInfo.CurrentCulture, _localization.T("EstimatedMinutesFormat", "Flashcards"), minutes);
        DueNewText = string.Format(CultureInfo.CurrentCulture, _localization.T("SummaryNewFormat", "Flashcards"), bannerNew);
        DueLearnText = string.Format(CultureInfo.CurrentCulture, _localization.T("SummaryLearnFormat", "Flashcards"), bannerLearn);
        DueReviewText = string.Format(CultureInfo.CurrentCulture, _localization.T("SummaryReviewFormat", "Flashcards"), bannerReview);

        TotalNew = footerNew;
        TotalLearn = footerLearn;
        TotalDue = footerReview;
        var overallRetention = cardTotal > 0 ? (int)Math.Round(weightedRetention / cardTotal, MidpointRounding.AwayFromZero) : 0;
        TotalRetentionText = $"{overallRetention}%";

        HeaderSummaryText = string.Format(
            CultureInfo.CurrentCulture,
            _localization.T("DeckCountCardCountFormat", "Flashcards"),
            deckTotal,
            totalCardsAll.ToString("#,##0", CultureInfo.CurrentCulture));
    }

    private void UpdateSortLabel()
    {
        var key = SortMode switch
        {
            FlashcardSortMode.Name => "SortName",
            FlashcardSortMode.Retention => "SortRetention",
            FlashcardSortMode.Cards => "SortCards",
            _ => "SortDue"
        };
        SortModeLabel = string.Format(CultureInfo.CurrentCulture, _localization.T("SortLabelFormat", "Flashcards"), _localization.T(key, "Flashcards"));
    }

    private void SetSort(string? mode)
    {
        if (Enum.TryParse<FlashcardSortMode>(mode, ignoreCase: true, out var parsed))
            SortMode = parsed;
    }

    private void ToggleExpandCollapseAll()
    {
        var anyCollapsed = false;
        WalkFolders(_folderTree, f => anyCollapsed |= !f.IsExpanded);
        WalkFolders(_folderTree, f => f.IsExpanded = anyCollapsed);
        Recompute();
    }

    public void ToggleFolderExpanded(FlashcardFolderItemViewModel folder)
    {
        folder.IsExpanded = !folder.IsExpanded;
        Recompute();
    }

    private static void WalkFolders(IEnumerable<FlashcardFolderItemViewModel> folders, Action<FlashcardFolderItemViewModel> action)
    {
        foreach (var folder in folders)
        {
            action(folder);
            WalkFolders(folder.Children, action);
        }
    }

    // --- Deck actions ------------------------------------------------------

    private void OpenDeck(FlashcardDeckRowViewModel? row)
    {
        if (row == null || string.IsNullOrEmpty(row.Id))
            return;
        _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(row.Id));
    }

    private async Task CreateDeckAsync()
    {
        var name = _localization.T("DefaultDeckName", "Flashcards");
        var preset = await _presets.GetOrCreateStandardAsync().ConfigureAwait(false);
        var header = await _library.CreateDeckAsync(name, folderId: null, presetId: preset.Id).ConfigureAwait(false);
        await LoadDecksAsync().ConfigureAwait(false);
        _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(header.Id));
    }

    public async Task MoveDeckToFolderAsync(string deckId, string? targetFolderId)
    {
        if (string.IsNullOrWhiteSpace(deckId))
            return;

        var existing = _loadedDecks.FirstOrDefault(d => string.Equals(d.Id, deckId, StringComparison.Ordinal));
        if (existing is null)
            return;
        if (string.Equals(existing.Header.FolderId, targetFolderId, StringComparison.Ordinal))
            return;

        // Append to the end of the target folder's deck run.
        var sortOrder = _loadedDecks
            .Where(d => string.Equals(d.Header.FolderId, targetFolderId, StringComparison.Ordinal))
            .Select(d => d.Header.SortOrder)
            .DefaultIfEmpty(-1)
            .Max() + 1;

        await _library.MoveDeckAsync(deckId, targetFolderId, sortOrder).ConfigureAwait(false);
        await LoadDecksAsync().ConfigureAwait(false);
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

        await _library.DeleteDeckAsync(row.Id).ConfigureAwait(false);
        await LoadDecksAsync().ConfigureAwait(false);
    }

    // --- Folder actions ----------------------------------------------------

    public async Task MoveFolderAsync(string sourceFolderId, string? targetFolderId, bool dropIntoFolder, bool insertAfterTarget)
    {
        if (string.IsNullOrWhiteSpace(sourceFolderId))
            return;

        var source = _loadedFolders.FirstOrDefault(f => string.Equals(f.Id, sourceFolderId, StringComparison.Ordinal));
        if (source is null)
            return;

        if (string.IsNullOrWhiteSpace(targetFolderId))
        {
            // Root-level drop: lift the folder to the top level, appended after the existing root siblings.
            if (source.ParentId is null)
                return;

            var rootOrder = _loadedFolders
                .Where(f => f.ParentId is null && !string.Equals(f.Id, sourceFolderId, StringComparison.Ordinal))
                .Select(f => f.Order)
                .DefaultIfEmpty(-1)
                .Max() + 1;

            await _library.SaveFolderAsync(source with { ParentId = null, Order = rootOrder }).ConfigureAwait(false);
            await LoadDecksAsync().ConfigureAwait(false);
            return;
        }

        if (string.Equals(sourceFolderId, targetFolderId, StringComparison.Ordinal))
            return;

        var target = _loadedFolders.FirstOrDefault(f => string.Equals(f.Id, targetFolderId, StringComparison.Ordinal));
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

            await _library.SaveFolderAsync(source with { ParentId = targetFolderId, Order = siblingOrder }).ConfigureAwait(false);
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
                await _library.SaveFolderAsync(folder with { ParentId = targetParentId, Order = index }).ConfigureAwait(false);
        }

        await LoadDecksAsync().ConfigureAwait(false);
    }

    private async Task CreateFolderAsync()
    {
        var order = _loadedFolders
            .Where(f => f.ParentId is null)
            .Select(f => f.Order)
            .DefaultIfEmpty(-1)
            .Max() + 1;
        var folder = new FlashcardFolder(
            Guid.NewGuid().ToString("n"),
            _localization.T("NewFolderName", "Flashcards"),
            null,
            order);
        await _library.SaveFolderAsync(folder).ConfigureAwait(false);
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

        await _library.SaveFolderAsync(existing with { Name = trimmedName }).ConfigureAwait(false);
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

        // Direct children are lifted to root when the parent folder is deleted (matches notes behavior).
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
            await _library.SaveFolderAsync(
                childFolders[index] with { ParentId = null, Order = rootOrderStart + index }).ConfigureAwait(false);
        }

        // Decks in the deleted folder are re-parented to root before the folder row is removed.
        var directDecks = _loadedDecks.Where(d => string.Equals(d.Header.FolderId, folderId, StringComparison.Ordinal)).ToArray();
        foreach (var deck in directDecks)
            await _library.SaveDeckAsync(deck.Header with { FolderId = null }).ConfigureAwait(false);

        await _library.DeleteFolderAsync(folderId).ConfigureAwait(false);
        await LoadDecksAsync().ConfigureAwait(false);
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
                await _library.SaveFolderAsync(siblings[index] with { Order = index }).ConfigureAwait(false);
        }
    }

    private void RebuildFolderTree()
    {
        // Preserve expansion state across reloads so a save/move doesn't collapse the tree.
        var expandedIds = new HashSet<string>(StringComparer.Ordinal);
        WalkFolders(_folderTree, f =>
        {
            if (f.IsExpanded)
                expandedIds.Add(f.Id);
        });
        var hadFolders = _folderTree.Count > 0;

        _folderTree.Clear();
        var byParent = _loadedFolders
            .GroupBy(f => f.ParentId, StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key ?? RootFolderKey,
                g => g.OrderBy(f => f.Order).ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase).ToArray(),
                StringComparer.Ordinal);

        AddFolderChildren(_folderTree, byParent, RootFolderKey, 0, id => !hadFolders || expandedIds.Contains(id));
    }

    private static void AddFolderChildren(
        ICollection<FlashcardFolderItemViewModel> target,
        IReadOnlyDictionary<string, FlashcardFolder[]> byParent,
        string parentId,
        int depth,
        Func<string, bool> isExpanded)
    {
        if (!byParent.TryGetValue(parentId, out var folders))
            return;
        foreach (var folder in folders)
        {
            var vm = new FlashcardFolderItemViewModel(folder.Id, folder.Name, folder.ParentId, folder.Order, depth)
            {
                IsExpanded = isExpanded(folder.Id)
            };
            target.Add(vm);
            AddFolderChildren(vm.Children, byParent, folder.Id, depth + 1, isExpanded);
        }
    }
}
