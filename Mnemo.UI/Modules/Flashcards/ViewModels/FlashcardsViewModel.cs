using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
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
/// an aggregate study summary, sorting, and drag organization.
/// </summary>
public partial class FlashcardsViewModel : ViewModelBase, INavigationAware
{
    private const string RootFolderKey = "__root__";

    /// <summary>Rough pace used only for the "about N min" study estimate (~11 cards/min).</summary>
    private const double CardsPerMinuteEstimate = 11d;

    private readonly IFlashcardDeckService _deckService;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILocalizationService _localization;

    private IReadOnlyList<FlashcardDeck> _loadedDecks = Array.Empty<FlashcardDeck>();
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
    public IRelayCommand<FlashcardDeckRowViewModel?> StartReviewSessionCommand { get; }
    public IRelayCommand<FlashcardDeckRowViewModel?> StartQuickSessionCommand { get; }
    public IRelayCommand<FlashcardDeckRowViewModel?> StartCramSessionCommand { get; }
    public IRelayCommand<FlashcardDeckRowViewModel?> StartTestSessionCommand { get; }
    public IAsyncRelayCommand<FlashcardDeckRowViewModel?> OpenDeckSettingsCommand { get; }
    public IAsyncRelayCommand<FlashcardDeckRowViewModel?> DeleteDeckCommand { get; }

    public IAsyncRelayCommand CreateDeckCommand { get; }
    public IAsyncRelayCommand CreateFolderCommand { get; }

    public IRelayCommand<string?> SetSortCommand { get; }
    public IRelayCommand ToggleExpandCollapseAllCommand { get; }

    public IRelayCommand StudyAllCommand { get; }
    public IRelayCommand OpenCustomSessionCommand { get; }

    public IAsyncRelayCommand<FlashcardFolderItemViewModel?> RenameFolderCommand { get; }
    public IAsyncRelayCommand<FlashcardFolderItemViewModel?> DeleteFolderCommand { get; }

    public FlashcardsViewModel(
        IFlashcardDeckService deckService,
        INavigationService navigation,
        IOverlayService overlay,
        ILocalizationService localization)
    {
        _deckService = deckService;
        _navigation = navigation;
        _overlay = overlay;
        _localization = localization;

        RefreshCommand = new AsyncRelayCommand(LoadDecksAsync);
        OpenDeckCommand = new RelayCommand<FlashcardDeckRowViewModel?>(OpenDeck);
        StartReviewSessionCommand = new RelayCommand<FlashcardDeckRowViewModel?>(r => StartSession(r, FlashcardSessionType.Review));
        StartQuickSessionCommand = new RelayCommand<FlashcardDeckRowViewModel?>(r => StartSession(r, FlashcardSessionType.Quick));
        StartCramSessionCommand = new RelayCommand<FlashcardDeckRowViewModel?>(r => StartSession(r, FlashcardSessionType.Cram));
        StartTestSessionCommand = new RelayCommand<FlashcardDeckRowViewModel?>(r => StartSession(r, FlashcardSessionType.Test));
        OpenDeckSettingsCommand = new AsyncRelayCommand<FlashcardDeckRowViewModel?>(OpenDeckSettingsAsync);
        DeleteDeckCommand = new AsyncRelayCommand<FlashcardDeckRowViewModel?>(DeleteDeckAsync);
        CreateDeckCommand = new AsyncRelayCommand(CreateDeckAsync);
        CreateFolderCommand = new AsyncRelayCommand(CreateFolderAsync);
        SetSortCommand = new RelayCommand<string?>(SetSort);
        ToggleExpandCollapseAllCommand = new RelayCommand(ToggleExpandCollapseAll);
        StudyAllCommand = new RelayCommand(StudyAll);
        OpenCustomSessionCommand = new RelayCommand(OpenCustomSession);
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
        var folders = await _deckService.ListFoldersAsync().ConfigureAwait(false);
        var decks = await _deckService.ListDecksAsync().ConfigureAwait(false);

        _loadedDecks = decks;
        _loadedFolders = folders;

        await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
        {
            RebuildFolderTree();
            Recompute();
        });
    }

    // --- Stats -------------------------------------------------------------

    private static FlashcardFsrsState ResolveState(Flashcard card) =>
        card.FsrsState ?? ((card.ReviewCount ?? 0) <= 0 ? FlashcardFsrsState.New : FlashcardFsrsState.Review);

    private static DeckStats ComputeStats(FlashcardDeck deck, DateTimeOffset now)
    {
        var newCount = 0;
        var learn = 0;
        var reviewDue = 0;
        foreach (var card in deck.Cards)
        {
            var state = ResolveState(card);
            if (state == FlashcardFsrsState.New)
            {
                newCount++;
            }
            else if (card.DueDate <= now)
            {
                if (state == FlashcardFsrsState.Learning || state == FlashcardFsrsState.Relearning)
                    learn++;
                else
                    reviewDue++;
            }
        }

        return new DeckStats(newCount, learn, reviewDue, deck.Cards.Count, deck.RetentionScore);
    }

    // --- Rebuild -----------------------------------------------------------

    private void Recompute()
    {
        var now = DateTimeOffset.UtcNow;
        _statsByDeck = _loadedDecks.ToDictionary(d => d.Id, d => ComputeStats(d, now), StringComparer.Ordinal);

        var term = SearchText.Trim();
        var searching = term.Length > 0;
        bool Matches(FlashcardDeck d) => !searching || d.Name.Contains(term, StringComparison.OrdinalIgnoreCase);

        var decksByFolder = _loadedDecks
            .GroupBy(d => d.FolderId ?? RootFolderKey, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var knownFolderIds = _loadedFolders.Select(f => f.Id).ToHashSet(StringComparer.Ordinal);

        // Folder aggregates roll up every descendant deck (independent of search filter).
        foreach (var folder in _folderTree)
            ApplyFolderAggregates(folder, decksByFolder);

        LibraryRows.Clear();
        foreach (var root in _folderTree)
            AddFolderRows(root, decksByFolder, searching, Matches);

        var rootDecks = decksByFolder.TryGetValue(RootFolderKey, out var direct)
            ? direct.Where(d => d.FolderId is null || !knownFolderIds.Contains(d.FolderId))
            : Enumerable.Empty<FlashcardDeck>();
        // Decks whose folder no longer exists surface at root too.
        var orphaned = _loadedDecks.Where(d => d.FolderId != null && !knownFolderIds.Contains(d.FolderId));
        foreach (var deck in SortDecks(rootDecks.Concat(orphaned).Distinct()).Where(Matches))
            LibraryRows.Add(CreateDeckRow(deck, depth: 0));

        UpdateSummary(Matches);

        ShowEmptyState = _loadedDecks.Count == 0;
        ShowNoResultsState = _loadedDecks.Count > 0 && LibraryRows.Count == 0;
        ShowTree = LibraryRows.Count > 0;
    }

    private void AddFolderRows(
        FlashcardFolderItemViewModel folder,
        IReadOnlyDictionary<string, List<FlashcardDeck>> decksByFolder,
        bool searching,
        Func<FlashcardDeck, bool> matches)
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
        IReadOnlyDictionary<string, List<FlashcardDeck>> decksByFolder,
        Func<FlashcardDeck, bool> matches)
    {
        if (decksByFolder.TryGetValue(folder.Id, out var decks) && decks.Any(matches))
            return true;
        return folder.Children.Any(child => SubtreeHasMatch(child, decksByFolder, matches));
    }

    private DeckStats ApplyFolderAggregates(
        FlashcardFolderItemViewModel folder,
        IReadOnlyDictionary<string, List<FlashcardDeck>> decksByFolder)
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

    private FlashcardDeckRowViewModel CreateDeckRow(FlashcardDeck deck, int depth)
    {
        var s = _statsByDeck.TryGetValue(deck.Id, out var stats) ? stats : new DeckStats(0, 0, 0, deck.Cards.Count, deck.RetentionScore);
        return new FlashcardDeckRowViewModel
        {
            Id = deck.Id,
            Name = deck.Name,
            FolderId = deck.FolderId,
            Depth = depth,
            NewCount = s.New,
            LearnCount = s.Learn,
            ReviewDueCount = s.ReviewDue,
            TotalCards = s.Total,
            RetentionScore = s.Retention,
            CardCountLine = string.Format(CultureInfo.CurrentCulture, _localization.T("DeckCardCountFormat", "Flashcards"), s.Total)
        };
    }

    private IEnumerable<FlashcardDeck> SortDecks(IEnumerable<FlashcardDeck> decks) => SortMode switch
    {
        FlashcardSortMode.Name => decks.OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase),
        FlashcardSortMode.Retention => decks.OrderByDescending(d => d.RetentionScore).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase),
        FlashcardSortMode.Cards => decks.OrderByDescending(d => d.Cards.Count).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase),
        _ => decks.OrderByDescending(d => Due(d)).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
    };

    private int Due(FlashcardDeck deck) => _statsByDeck.TryGetValue(deck.Id, out var s) ? s.DueToday : 0;

    private void UpdateSummary(Func<FlashcardDeck, bool> matches)
    {
        var visible = _loadedDecks.Where(matches).ToList();
        var newTotal = 0;
        var learnTotal = 0;
        var reviewTotal = 0;
        var weightedRetention = 0d;
        var cardTotal = 0;
        var deckTotal = 0;
        var totalCardsAll = 0;
        var dueDecks = 0;

        foreach (var deck in visible)
        {
            if (!_statsByDeck.TryGetValue(deck.Id, out var s))
                continue;
            newTotal += s.New;
            learnTotal += s.Learn;
            reviewTotal += s.ReviewDue;
            weightedRetention += (double)s.Retention * Math.Max(1, s.Total);
            cardTotal += Math.Max(1, s.Total);
            totalCardsAll += s.Total;
            deckTotal++;
            if (s.DueToday > 0)
                dueDecks++;
        }

        var dueTotal = newTotal + learnTotal + reviewTotal;
        HasDueToday = dueTotal > 0;

        var minutes = Math.Max(1, (int)Math.Round(dueTotal / CardsPerMinuteEstimate, MidpointRounding.AwayFromZero));
        DueHeadlineText = string.Format(CultureInfo.CurrentCulture, _localization.T("DueTodayCountFormat", "Flashcards"), dueTotal);
        DueDecksText = string.Format(CultureInfo.CurrentCulture, _localization.T("DeckCountFormat", "Flashcards"), dueDecks);
        DueMinutesText = string.Format(CultureInfo.CurrentCulture, _localization.T("EstimatedMinutesFormat", "Flashcards"), minutes);
        DueNewText = string.Format(CultureInfo.CurrentCulture, _localization.T("SummaryNewFormat", "Flashcards"), newTotal);
        DueLearnText = string.Format(CultureInfo.CurrentCulture, _localization.T("SummaryLearnFormat", "Flashcards"), learnTotal);
        DueReviewText = string.Format(CultureInfo.CurrentCulture, _localization.T("SummaryReviewFormat", "Flashcards"), reviewTotal);

        TotalNew = newTotal;
        TotalLearn = learnTotal;
        TotalDue = reviewTotal;
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

    // --- Study bar (interim single-deck wiring) ----------------------------

    private FlashcardDeck? MostDueDeck() => _loadedDecks
        .Where(d => Due(d) > 0)
        .OrderByDescending(Due)
        .ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
        .FirstOrDefault();

    private void StudyAll()
    {
        var deck = MostDueDeck();
        if (deck is null)
            return;
        var config = new FlashcardSessionConfig(FlashcardSessionType.Review, deck.Id, null, null, false, null);
        _navigation.NavigateTo("flashcard-practice", new FlashcardPracticeNavigationParameter(deck.Id, config));
    }

    private void OpenCustomSession()
    {
        var deck = MostDueDeck();
        if (deck is null)
            return;
        _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(deck.Id));
    }

    // --- Deck actions ------------------------------------------------------

    private void OpenDeck(FlashcardDeckRowViewModel? row)
    {
        if (row == null || string.IsNullOrEmpty(row.Id))
            return;
        _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(row.Id));
    }

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
            null,
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

    // --- Folder actions ----------------------------------------------------

    public async Task MoveFolderAsync(string sourceFolderId, string targetFolderId, bool dropIntoFolder, bool insertAfterTarget)
    {
        if (string.IsNullOrWhiteSpace(sourceFolderId) || string.IsNullOrWhiteSpace(targetFolderId))
            return;
        if (string.Equals(sourceFolderId, targetFolderId, StringComparison.Ordinal))
            return;

        var source = _loadedFolders.FirstOrDefault(f => string.Equals(f.Id, sourceFolderId, StringComparison.Ordinal));
        var target = _loadedFolders.FirstOrDefault(f => string.Equals(f.Id, targetFolderId, StringComparison.Ordinal));
        if (source is null || target is null)
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
            await _deckService.SaveFolderAsync(
                childFolders[index] with { ParentId = null, Order = rootOrderStart + index }).ConfigureAwait(false);
        }

        var directDecks = _loadedDecks.Where(d => string.Equals(d.FolderId, folderId, StringComparison.Ordinal)).ToArray();
        foreach (var deck in directDecks)
            await _deckService.SaveDeckAsync(deck with { FolderId = null }).ConfigureAwait(false);

        await _deckService.DeleteFolderAsync(folderId).ConfigureAwait(false);
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
                await _deckService.SaveFolderAsync(siblings[index] with { Order = index }).ConfigureAwait(false);
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
