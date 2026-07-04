using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using Avalonia.Layout;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.UI.Components.Overlays;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Markdown;
using Mnemo.UI.Modules.Flashcards.Views;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>
/// Deck editor: cards, study launcher, and persistence through <see cref="IFlashcardDeckService"/>.
/// </summary>
/// <summary>
/// Deep snapshot of the card fields taken when an editor expands so <see cref="FlashcardDeckDetailViewModel"/>'s
/// revert command can restore all content (including rich blocks) even after autosave has persisted changes.
/// </summary>
internal sealed record FlashcardEditSnapshot(
    string CardId,
    string Front,
    string Back,
    FlashcardType Type,
    IReadOnlyList<string> Tags,
    IReadOnlyList<Block>? FrontBlocks,
    IReadOnlyList<Block>? BackBlocks);

/// <summary>
/// Parameter passed from the editor view to <see cref="FlashcardDeckDetailViewModel.InsertClozeCommand"/>.
/// The view supplies the current selection; the callback lets the view restore focus and caret afterwards.
/// </summary>
public sealed class FlashcardClozeInsertRequest
{
    public int SelectionStart { get; init; }
    public int SelectionEnd { get; init; }
    public Action<int>? OnCompleted { get; init; }
}

/// <summary>Identifies which field a block-editor update applies to.</summary>
public enum FlashcardEditorField
{
    Front,
    Back
}

public partial class FlashcardDeckDetailViewModel : ViewModelBase, INavigationAware
{
    private const int RetentionTrendWindowDays = 14;

    private static readonly Regex ClozeOrdinalPattern = new(@"\{\{c(\d+)::", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex ClozeContentPattern = new(@"\{\{c\d+::(.*?)}}", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.Singleline);

    private readonly IFlashcardDeckService _deckService;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILocalizationService _localization;

    private string _deckId = string.Empty;
    public string DeckId => _deckId;

    private string? _studyLauncherOverlayId;
    private bool _isLoadingDeck;
    private bool _isSyncingEditorFromSelection;
    private FlashcardSchedulingAlgorithm _deckSchedulingAlgorithm = FlashcardSchedulingAlgorithm.Fsrs;
    private CancellationTokenSource? _deckAutosaveCts;
    private CancellationTokenSource? _cardAutosaveCts;

    /// <summary>Snapshot captured when a card is opened; <see cref="RevertEdit"/> restores from this.</summary>
    private FlashcardEditSnapshot? _editSnapshot;

    [ObservableProperty]
    private string _deckName = string.Empty;

    [ObservableProperty]
    private Flashcard? _selectedCard;

    [ObservableProperty]
    private string _editorFront = string.Empty;

    [ObservableProperty]
    private string _editorBack = string.Empty;

    [ObservableProperty]
    private double _focusedCardCountSlider = 20;

    [ObservableProperty]
    private bool _cramShuffle;

    [ObservableProperty]
    private bool _focusedUseTimeLimit;

    [ObservableProperty]
    private double _focusedTimeLimitSlider = 20;

    [ObservableProperty]
    private int _totalCardsCount;

    [ObservableProperty]
    private int _dueTodayCount;

    [ObservableProperty]
    private int _retentionPercent;

    [ObservableProperty]
    private string _retentionTrendDeltaText = string.Empty;

    [ObservableProperty]
    private string? _expandedCardId;

    [ObservableProperty]
    private string _editorTags = string.Empty;

    [ObservableProperty]
    private FlashcardType _editorCardType = FlashcardType.Classic;

    [ObservableProperty]
    private string _cardSearchQuery = string.Empty;

    private IReadOnlyList<InlineSpan> _editorFrontSpans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };

    private IReadOnlyList<InlineSpan> _editorBackSpans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };

    public IReadOnlyList<InlineSpan> EditorFrontSpans => _editorFrontSpans;

    public IReadOnlyList<InlineSpan> EditorBackSpans => _editorBackSpans;

    public bool IsEditorClozeType => EditorCardType == FlashcardType.Cloze;
    public bool IsEditorBackEditable => !IsEditorClozeType;

    public ObservableCollection<Flashcard> Cards { get; } = new();
    public ObservableCollection<Flashcard> FilteredCards { get; } = new();
    public ObservableCollection<FlashcardRetentionTrendPoint> RetentionTrendPoints { get; } = new();

    public string LocalizedCardDue => _localization.T("CardDue", "Flashcards");

    public bool HasRetentionTrendData => RetentionTrendPoints.Any(point => point.ReviewsCount > 0);

    public string RetentionTrendSummaryPercentText
    {
        get
        {
            var activePoints = GetActiveRetentionTrendPoints().ToList();
            if (activePoints.Count == 0)
                return "--";

            var average = (int)Math.Round(
                activePoints.Average(point => point.RetentionPercent),
                MidpointRounding.AwayFromZero);
            return string.Format(
                System.Globalization.CultureInfo.CurrentCulture,
                "{0}%",
                average);
        }
    }

    public string RetentionTrendSummaryLabel =>
        HasRetentionTrendData
            ? _localization.T("RetentionTrendSummaryAverage", "Flashcards")
            : _localization.T("RetentionTrendSummaryEmpty", "Flashcards");

    public string RetentionTrendActivityText
    {
        get
        {
            var activeDays = GetActiveRetentionTrendPoints().Count();
            return activeDays switch
            {
                0 => string.Format(
                    System.Globalization.CultureInfo.CurrentCulture,
                    _localization.T("RetentionTrendActivityNone", "Flashcards"),
                    RetentionTrendWindowDays),
                1 => string.Format(
                    System.Globalization.CultureInfo.CurrentCulture,
                    _localization.T("RetentionTrendActivitySingle", "Flashcards"),
                    RetentionTrendWindowDays),
                _ => string.Format(
                    System.Globalization.CultureInfo.CurrentCulture,
                    _localization.T("RetentionTrendActivityPlural", "Flashcards"),
                    activeDays,
                    RetentionTrendWindowDays)
            };
        }
    }

    public string RetentionTrendEmptyStateText => _localization.T("RetentionTrendEmptyState", "Flashcards");

    /// <summary>Front source for markdown preview in the card editor (cloze → hidden blanks).</summary>
    public string EditorFrontPreviewMarkdown =>
        IsEditorClozeType && FrontIndicatesCloze(EditorFront)
            ? ClozeContentPattern.Replace(EditorFront, "[…]")
            : EditorFront;

    /// <summary>Back source for preview; cloze cards use the front with blanks emphasized like practice mode.</summary>
    public string EditorBackPreviewMarkdown =>
        IsEditorClozeType && FrontIndicatesCloze(EditorFront)
            ? ClozeContentPattern.Replace(EditorFront, "**$1**")
            : EditorBack;

    public IRelayCommand GoBackCommand { get; }

    public IRelayCommand OpenStudyLauncherCommand { get; }

    public IRelayCommand CloseStudyLauncherCommand { get; }

    public IRelayCommand StartReviewSessionCommand { get; }

    public IRelayCommand StartQuickSessionCommand { get; }

    public IRelayCommand StartFocusedSessionCommand { get; }

    public IRelayCommand StartCramSessionCommand { get; }

    public IRelayCommand StartTestSessionCommand { get; }

    public IRelayCommand AddCardCommand { get; }

    public IAsyncRelayCommand DuplicateDeckCommand { get; }

    public IRelayCommand RenameDeckCommand { get; }

    public IRelayCommand OpenDeckSettingsCommand { get; }

    public IRelayCommand CancelEditCommand { get; }

    public IRelayCommand RevertEditCommand { get; }

    public IRelayCommand SaveAndAddCardCommand { get; }

    public IRelayCommand<FlashcardClozeInsertRequest?> InsertClozeCommand { get; }

    public IAsyncRelayCommand DeleteCardCommand { get; }

    public IAsyncRelayCommand DeleteDeckCommand { get; }

    public IRelayCommand<Flashcard?> ToggleCardRowCommand { get; }

    public IRelayCommand CloseExpandedCardCommand { get; }

    public IRelayCommand SelectFocusedCardCountModeCommand { get; }

    public IRelayCommand SelectFocusedTimeLimitModeCommand { get; }

    public IRelayCommand SetEditorClassicTypeCommand { get; }

    public IRelayCommand SetEditorClozeTypeCommand { get; }

    public FlashcardDeckDetailViewModel(
        IFlashcardDeckService deckService,
        INavigationService navigation,
        IOverlayService overlay,
        ILocalizationService localization)
    {
        _deckService = deckService;
        _navigation = navigation;
        _overlay = overlay;
        _localization = localization;

        GoBackCommand = new RelayCommand(() => _navigation.NavigateTo("flashcards"));
        OpenStudyLauncherCommand = new RelayCommand(OpenStudyLauncher);
        CloseStudyLauncherCommand = new RelayCommand(CloseStudyLauncher);
        StartReviewSessionCommand = new RelayCommand(() => StartPractice(new FlashcardSessionConfig(
            FlashcardSessionType.Review, _deckId, null, null, false, null)));
        StartQuickSessionCommand = new RelayCommand(() => StartPractice(new FlashcardSessionConfig(
            FlashcardSessionType.Quick, _deckId, null, null, false, null)));
        StartFocusedSessionCommand = new RelayCommand(() => StartPractice(new FlashcardSessionConfig(
            FlashcardSessionType.Focused,
            _deckId,
            FocusedUseTimeLimit ? null : (int)Math.Clamp(FocusedCardCountSlider, 5, 100),
            FocusedUseTimeLimit ? (int)Math.Clamp(FocusedTimeLimitSlider, 5, 60) : null,
            false,
            null)));
        StartCramSessionCommand = new RelayCommand(() => StartPractice(new FlashcardSessionConfig(
            FlashcardSessionType.Cram, _deckId, null, null, CramShuffle, null)));
        StartTestSessionCommand = new RelayCommand(() => StartPractice(new FlashcardSessionConfig(
            FlashcardSessionType.Test, _deckId, null, null, false, null)));
        AddCardCommand = new RelayCommand(AddCard);
        DuplicateDeckCommand = new AsyncRelayCommand(DuplicateDeckAsync);
        RenameDeckCommand = new RelayCommand(OpenRenameDeckDialog);
        OpenDeckSettingsCommand = new RelayCommand(() => _ = OpenDeckSettingsAsync());
        CancelEditCommand = new RelayCommand(RevertEdit);
        RevertEditCommand = new RelayCommand(RevertEdit);
        SaveAndAddCardCommand = new RelayCommand(SaveAndAddCard);
        InsertClozeCommand = new RelayCommand<FlashcardClozeInsertRequest?>(InsertClozeIntoFront);
        DeleteCardCommand = new AsyncRelayCommand(DeleteCardAsync, () => SelectedCard != null);
        DeleteDeckCommand = new AsyncRelayCommand(DeleteDeckAsync);
        ToggleCardRowCommand = new RelayCommand<Flashcard?>(ToggleCardRow);
        CloseExpandedCardCommand = new RelayCommand(CommitAndCollapse);
        SelectFocusedCardCountModeCommand = new RelayCommand(() => FocusedUseTimeLimit = false);
        SelectFocusedTimeLimitModeCommand = new RelayCommand(() => FocusedUseTimeLimit = true);
        SetEditorClassicTypeCommand = new RelayCommand(() => EditorCardType = FlashcardType.Classic);
        SetEditorClozeTypeCommand = new RelayCommand(() => EditorCardType = FlashcardType.Cloze);

        Cards.CollectionChanged += OnCardsCollectionChanged;
    }

    partial void OnEditorFrontChanged(string value)
    {
        OnPropertyChanged(nameof(EditorFrontPreviewMarkdown));
        OnPropertyChanged(nameof(EditorBackPreviewMarkdown));
        if (!_isSyncingEditorFromSelection && !_isLoadingDeck)
            ScheduleCardAutosave();
    }

    partial void OnFocusedUseTimeLimitChanged(bool value)
    {
        OnPropertyChanged(nameof(FocusedModeMetricLabel));
        OnPropertyChanged(nameof(FocusedSliderMin));
        OnPropertyChanged(nameof(FocusedSliderMax));
        OnPropertyChanged(nameof(FocusedMetricSliderValue));
    }

    partial void OnEditorBackChanged(string value)
    {
        OnPropertyChanged(nameof(EditorBackPreviewMarkdown));
        if (!_isSyncingEditorFromSelection && !_isLoadingDeck)
            ScheduleCardAutosave();
    }

    partial void OnEditorTagsChanged(string value)
    {
        if (!_isSyncingEditorFromSelection && !_isLoadingDeck)
            ScheduleCardAutosave();
    }

    partial void OnEditorCardTypeChanged(FlashcardType value)
    {
        OnPropertyChanged(nameof(IsEditorClozeType));
        OnPropertyChanged(nameof(IsEditorBackEditable));
        OnPropertyChanged(nameof(EditorFrontPreviewMarkdown));
        OnPropertyChanged(nameof(EditorBackPreviewMarkdown));
        if (!_isSyncingEditorFromSelection && !_isLoadingDeck)
            ScheduleCardAutosave();
    }

    partial void OnDeckNameChanged(string value)
    {
        if (_isLoadingDeck)
            return;

        ScheduleDeckAutosave();
    }

    partial void OnCardSearchQueryChanged(string value) => RefreshFilteredCards();

    private void ToggleCardRow(Flashcard? card)
    {
        if (card is null)
            return;
        if (ExpandedCardId == card.Id)
        {
            CommitAndCollapse();
            return;
        }

        if (SelectedCard?.Id != card.Id)
        {
            SelectedCard = card;
            return;
        }

        BeginEditing(card);
    }

    /// <summary>Deep-copy snapshot so a later <see cref="RevertEdit"/> cannot observe in-flight edits.</summary>
    private void BeginEditing(Flashcard card)
    {
        _isSyncingEditorFromSelection = true;
        EditorFront = card.Front;
        EditorBack = card.Back;
        EditorCardType = card.Type;
        EditorTags = string.Join(", ", card.Tags);
        _editorFrontSpans = BuildEditorSpans(card.FrontBlocks, card.Front);
        _editorBackSpans = BuildEditorSpans(card.BackBlocks, card.Back);
        _isSyncingEditorFromSelection = false;

        _editSnapshot = new FlashcardEditSnapshot(
            card.Id,
            card.Front,
            card.Back,
            card.Type,
            card.Tags.ToArray(),
            DeepCloneBlocks(card.FrontBlocks),
            DeepCloneBlocks(card.BackBlocks));

        OnPropertyChanged(nameof(EditorFrontSpans));
        OnPropertyChanged(nameof(EditorBackSpans));
        OnPropertyChanged(nameof(IsEditorClozeType));

        ExpandedCardId = card.Id;
    }

    /// <summary>
    /// Called by the rich editors when inline spans change.
    /// </summary>
    public void UpdateEditorSpans(FlashcardEditorField field, IReadOnlyList<InlineSpan> spans)
    {
        if (_isLoadingDeck)
            return;

        var normalized = InlineSpanFormatApplier.Normalize(spans ?? new List<InlineSpan> { InlineSpan.Plain(string.Empty) });

        switch (field)
        {
            case FlashcardEditorField.Front:
                _editorFrontSpans = normalized;
                _isSyncingEditorFromSelection = true;
                EditorFront = InlineSpanText.FlattenDisplay(_editorFrontSpans);
                _isSyncingEditorFromSelection = false;
                OnPropertyChanged(nameof(EditorFrontSpans));
                break;
            case FlashcardEditorField.Back:
                _editorBackSpans = normalized;
                _isSyncingEditorFromSelection = true;
                EditorBack = InlineSpanText.FlattenDisplay(_editorBackSpans);
                _isSyncingEditorFromSelection = false;
                OnPropertyChanged(nameof(EditorBackSpans));
                break;
        }

        ScheduleCardAutosave();
    }

    /// <summary>Concatenates the display text of each block so cloze-pattern regexes and Front/Back legacy fields stay meaningful even after rich editing.</summary>
    public static string FlattenBlocksToText(IReadOnlyList<Block>? blocks)
    {
        if (blocks == null || blocks.Count == 0)
            return string.Empty;
        var sb = new System.Text.StringBuilder();
        for (var i = 0; i < blocks.Count; i++)
        {
            if (i > 0) sb.Append('\n');
            sb.Append(InlineSpanText.FlattenDisplay(blocks[i].Spans));
        }
        return sb.ToString();
    }

    private async void CommitAndCollapse()
    {
        _cardAutosaveCts?.Cancel();
        await PersistSelectedCardFromEditorAsync().ConfigureAwait(false);
        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            CommitSelectedCardIntoCollection();
            _editSnapshot = null;
            ExpandedCardId = null;
        });
    }

    /// <summary>Replaces the card in <see cref="Cards"/> with the latest in-memory edit values. Only called on collapse / row-switch, never during typing.</summary>
    private void CommitSelectedCardIntoCollection()
    {
        if (SelectedCard == null)
            return;

        var idx = -1;
        for (var i = 0; i < Cards.Count; i++)
        {
            if (string.Equals(Cards[i].Id, SelectedCard.Id, StringComparison.Ordinal))
            {
                idx = i;
                break;
            }
        }

        if (idx < 0)
            return;

        var updated = Cards[idx] with
        {
            Front = EditorFront,
            Back = EditorBack,
            Type = EditorCardType,
            Tags = ParseEditorTags(EditorTags),
            FrontBlocks = BuildTextBlocksFromSpans(_editorFrontSpans),
            BackBlocks = BuildTextBlocksFromSpans(_editorBackSpans)
        };

        if (!FlashcardContentEquals(Cards[idx], updated))
            Cards[idx] = updated;
    }

    private static bool FlashcardContentEquals(Flashcard a, Flashcard b) =>
        string.Equals(a.Front, b.Front, StringComparison.Ordinal)
        && string.Equals(a.Back, b.Back, StringComparison.Ordinal)
        && a.Type == b.Type
        && a.Tags.SequenceEqual(b.Tags)
        && ReferenceEquals(a.FrontBlocks, b.FrontBlocks)
        && ReferenceEquals(a.BackBlocks, b.BackBlocks);

    /// <summary>JSON round-trip gives us a true deep copy that survives mutations of <see cref="Block.Spans"/>, <see cref="Block.Payload"/>, and <see cref="Block.Children"/>. Relies on the registered <see cref="Mnemo.Core.Serialization.BlockJsonConverter"/>.</summary>
    private static IReadOnlyList<Block>? DeepCloneBlocks(IReadOnlyList<Block>? source)
    {
        if (source == null)
            return null;
        try
        {
            var json = System.Text.Json.JsonSerializer.Serialize(source);
            var clone = System.Text.Json.JsonSerializer.Deserialize<List<Block>>(json);
            return clone ?? new List<Block>();
        }
        catch
        {
            return source;
        }
    }

    private void OnCardsCollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        if (_isLoadingDeck)
            return;

        RefreshCardStats();
        RefreshFilteredCards();
    }

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
        _ = LoadDeckAsync();
    }

    public bool HasSelectedCard => SelectedCard != null;

    partial void OnSelectedCardChanged(Flashcard? value)
    {
        OnPropertyChanged(nameof(HasSelectedCard));
        DeleteCardCommand.NotifyCanExecuteChanged();
        if (value == null)
        {
            _isSyncingEditorFromSelection = true;
            EditorFront = string.Empty;
            EditorBack = string.Empty;
            EditorCardType = FlashcardType.Classic;
            EditorTags = string.Empty;
            ExpandedCardId = null;
            _editSnapshot = null;
            _editorFrontSpans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };
            _editorBackSpans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };
            OnPropertyChanged(nameof(EditorFrontSpans));
            OnPropertyChanged(nameof(EditorBackSpans));
            _isSyncingEditorFromSelection = false;
            return;
        }

        BeginEditing(value);
    }

    private async Task LoadDeckAsync()
    {
        var deck = await _deckService.GetDeckByIdAsync(_deckId, default).ConfigureAwait(false);
        if (deck == null)
        {
            await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() => _navigation.NavigateTo("flashcards"));
            return;
        }

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            _isLoadingDeck = true;
            DeckName = deck.Name;
            _deckSchedulingAlgorithm = deck.SchedulingAlgorithm;
            RetentionPercent = deck.RetentionScore;
            Cards.Clear();
            foreach (var c in deck.Cards)
                Cards.Add(EnsureCardBlockContent(c));
            SelectedCard = null;
            ExpandedCardId = null;
            RefreshCardStats();
            RefreshFilteredCards();
            OnPropertyChanged(nameof(CurrentSchedulingEngineLabel));
            OnPropertyChanged(nameof(ReviewSessionDescription));
            _ = LoadRetentionTrendAsync();
            _isLoadingDeck = false;
        });
    }

    private void RefreshCardStats()
    {
        var now = DateTimeOffset.UtcNow;
        TotalCardsCount = Cards.Count;
        DueTodayCount = Cards.Count(c => c.DueDate <= now);
    }

    private void RefreshFilteredCards()
    {
        var search = CardSearchQuery.Trim();
        var selectedId = SelectedCard?.Id;
        var expandedId = ExpandedCardId;

        IEnumerable<Flashcard> query = Cards;
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(card => CardMatchesSearch(card, search));

        var visibleCards = query.ToList();
        FilteredCards.Clear();
        foreach (var card in visibleCards)
            FilteredCards.Add(card);

        if (!string.IsNullOrEmpty(selectedId)
            && !visibleCards.Any(card => string.Equals(card.Id, selectedId, StringComparison.Ordinal)))
        {
            SelectedCard = null;
        }

        if (!string.IsNullOrEmpty(expandedId)
            && !visibleCards.Any(card => string.Equals(card.Id, expandedId, StringComparison.Ordinal)))
        {
            ExpandedCardId = null;
            _editSnapshot = null;
        }
    }

    private static bool CardMatchesSearch(Flashcard card, string search)
    {
        if (card.Front.Contains(search, StringComparison.OrdinalIgnoreCase)
            || card.Back.Contains(search, StringComparison.OrdinalIgnoreCase))
            return true;

        if (card.Tags.Any(tag => tag.Contains(search, StringComparison.OrdinalIgnoreCase)))
            return true;

        return card.Type.ToString().Contains(search, StringComparison.OrdinalIgnoreCase);
    }

    private void StartPractice(FlashcardSessionConfig config)
    {
        CloseStudyLauncher();
        _navigation.NavigateTo("flashcard-practice", new FlashcardPracticeNavigationParameter(_deckId, config));
    }

    private void OpenStudyLauncher()
    {
        if (!string.IsNullOrWhiteSpace(_studyLauncherOverlayId)
            && _overlay.Overlays.Any(o => string.Equals(o.Id, _studyLauncherOverlayId, StringComparison.Ordinal)))
            return;

        _studyLauncherOverlayId = null;
        var content = new StudySessionLauncherOverlay
        {
            DataContext = this
        };
        _studyLauncherOverlayId = _overlay.CreateOverlay(content, new OverlayOptions
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true,
            CloseOnEscape = true
        }, "FlashcardStudyLauncher");
    }

    private void CloseStudyLauncher()
    {
        if (string.IsNullOrWhiteSpace(_studyLauncherOverlayId))
            return;

        var overlayId = _studyLauncherOverlayId;
        _studyLauncherOverlayId = null;
        _overlay.CloseOverlay(overlayId);
    }

    private async Task SaveDeckAsync(IReadOnlyList<Flashcard>? cardsOverride = null)
    {
        var deck = await BuildDeckModelAsync(cardsOverride).ConfigureAwait(false);
        await _deckService.SaveDeckAsync(deck).ConfigureAwait(false);
    }

    private async Task<FlashcardDeck> BuildDeckModelAsync(IReadOnlyList<Flashcard>? cardsOverride = null)
    {
        var existing = await _deckService.GetDeckByIdAsync(_deckId, default).ConfigureAwait(false);
        return await Dispatcher.UIThread.InvokeAsync(() => new FlashcardDeck(
            _deckId,
            DeckName,
            existing?.FolderId,
            existing?.Description,
            existing?.Tags ?? Array.Empty<string>(),
            existing?.LastStudied,
            existing?.RetentionScore ?? 0,
            (cardsOverride ?? Cards).ToArray(),
            existing?.SchedulingAlgorithm ?? FlashcardSchedulingAlgorithm.Fsrs));
    }

    private void AddCard()
    {
        var id = Guid.NewGuid().ToString("n");
        var card = new Flashcard(
            id,
            _deckId,
            string.Empty,
            string.Empty,
            FlashcardType.Classic,
            Array.Empty<string>(),
            DateTimeOffset.UtcNow,
            null,
            null,
            null,
            null,
            CreateDefaultEditorBlocks());
        Cards.Add(card);
        SelectedCard = card;
        ScheduleDeckAutosave();
    }

    private static IReadOnlyList<Block> CreateDefaultEditorBlocks() =>
        new[]
        {
            new Block
            {
                Type = BlockType.Text,
                Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) }
            }
        };

    private static IReadOnlyList<Block> CreateLegacyTextBlocks(string text) =>
        new[]
        {
            new Block
            {
                Type = BlockType.Text,
                Spans = new List<InlineSpan> { InlineSpan.Plain(text) }
            }
        };

    private static Flashcard EnsureCardBlockContent(Flashcard card)
    {
        var frontBlocks = card.FrontBlocks;
        var backBlocks = card.BackBlocks;

        if (frontBlocks is { Count: > 0 } && backBlocks is { Count: > 0 })
            return card;

        frontBlocks = frontBlocks is { Count: > 0 } ? frontBlocks : CreateLegacyTextBlocks(card.Front);
        backBlocks = backBlocks is { Count: > 0 } ? backBlocks : CreateLegacyTextBlocks(card.Back);
        return card with
        {
            FrontBlocks = frontBlocks,
            BackBlocks = backBlocks
        };
    }

    private static IReadOnlyList<InlineSpan> BuildEditorSpans(IReadOnlyList<Block>? blocks, string fallbackText)
    {
        if (blocks is null || blocks.Count == 0)
            return InlineMarkdownParser.ToSpans(fallbackText);

        var merged = new List<InlineSpan>();
        for (var i = 0; i < blocks.Count; i++)
        {
            var block = blocks[i];
            block.EnsureSpans();
            if (block.Spans is { Count: > 0 })
                merged.AddRange(block.Spans);
            if (i < blocks.Count - 1)
                merged.Add(InlineSpan.Plain("\n"));
        }

        return InlineSpanFormatApplier.Normalize(merged);
    }

    private static IReadOnlyList<Block> BuildTextBlocksFromSpans(IReadOnlyList<InlineSpan> spans)
    {
        var normalized = InlineSpanFormatApplier.Normalize(spans);
        return new[]
        {
            new Block
            {
                Type = BlockType.Text,
                Spans = new List<InlineSpan>(normalized)
            }
        };
    }

    private static string[] ParseEditorTags(string raw) =>
        raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(s => s.Length > 0)
            .ToArray();

    /// <summary>Revert restores the <see cref="_editSnapshot"/> captured on expand, then collapses without persisting pending edits.</summary>
    private async void RevertEdit()
    {
        if (SelectedCard == null || _editSnapshot == null)
        {
            ExpandedCardId = null;
            return;
        }

        _cardAutosaveCts?.Cancel();
        var snap = _editSnapshot;
        _editSnapshot = null;

        _isSyncingEditorFromSelection = true;
        EditorFront = snap.Front;
        EditorBack = snap.Back;
        EditorCardType = snap.Type;
        EditorTags = string.Join(", ", snap.Tags);
        _editorFrontSpans = BuildEditorSpans(snap.FrontBlocks, snap.Front);
        _editorBackSpans = BuildEditorSpans(snap.BackBlocks, snap.Back);
        _isSyncingEditorFromSelection = false;
        OnPropertyChanged(nameof(EditorFrontSpans));
        OnPropertyChanged(nameof(EditorBackSpans));

        var idx = -1;
        for (var i = 0; i < Cards.Count; i++)
        {
            if (string.Equals(Cards[i].Id, snap.CardId, StringComparison.Ordinal))
            {
                idx = i;
                break;
            }
        }

        if (idx >= 0)
        {
            var reverted = Cards[idx] with
            {
                Front = snap.Front,
                Back = snap.Back,
                Type = snap.Type,
                Tags = snap.Tags,
                FrontBlocks = snap.FrontBlocks,
                BackBlocks = snap.BackBlocks
            };
            Cards[idx] = reverted;
            if (SelectedCard?.Id == snap.CardId)
                SelectedCard = reverted;
        }

        ExpandedCardId = null;
        await SaveDeckAsync().ConfigureAwait(false);
    }

    /// <summary>Ctrl+Enter: commit the current edit, create a new card, and expand it (focus restoration lives in the view).</summary>
    private async void SaveAndAddCard()
    {
        _cardAutosaveCts?.Cancel();
        await PersistSelectedCardFromEditorAsync().ConfigureAwait(false);

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            CommitSelectedCardIntoCollection();
            _editSnapshot = null;
            AddCard();
        });
    }

    private void InsertClozeIntoFront(FlashcardClozeInsertRequest? request)
    {
        if (request == null || !IsEditorClozeType)
            return;

        var (newText, caret) = BuildFrontWithClozeInserted(EditorFront, request.SelectionStart, request.SelectionEnd);
        EditorFront = newText;
        request.OnCompleted?.Invoke(caret);
    }

    private async Task DeleteCardAsync()
    {
        if (SelectedCard == null)
            return;

        var deleteLabel = _localization.T("Delete", "Common");
        var cancelLabel = _localization.T("Cancel", "Common");
        var confirm = await _overlay.CreateDialogAsync(
            _localization.T("DeleteCard", "Flashcards"),
            _localization.T("DeleteCardConfirm", "Flashcards"),
            deleteLabel,
            cancelLabel,
            severity: DialogSeverity.Destructive).ConfigureAwait(false);

        if (!string.Equals(confirm, deleteLabel, StringComparison.Ordinal))
            return;

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            if (SelectedCard == null)
                return;

            var removedId = SelectedCard.Id;
            Cards.Remove(SelectedCard);
            if (ExpandedCardId == removedId)
                ExpandedCardId = null;
            SelectedCard = null;
        });

        await SaveDeckAsync().ConfigureAwait(false);
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

        await _deckService.DeleteDeckAsync(_deckId, default).ConfigureAwait(false);
        await Dispatcher.UIThread.InvokeAsync(() => _navigation.NavigateTo("flashcards"));
    }

    private void OpenRenameDeckDialog()
    {
        var inputOverlay = new InputDialogOverlay
        {
            Title = _localization.T("RenameDeck", "Flashcards"),
            Placeholder = _localization.T("DefaultDeckName", "Flashcards"),
            InputValue = DeckName,
            ConfirmText = _localization.T("RenameDeck", "Flashcards"),
            CancelText = _localization.T("Cancel", "Common")
        };

        var id = _overlay.CreateOverlay(inputOverlay, new OverlayOptions
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true,
            CloseOnEscape = true
        });

        inputOverlay.OnResult = async result =>
        {
            _overlay.CloseOverlay(id);

            if (string.IsNullOrWhiteSpace(result))
                return;

            var trimmed = result.Trim();
            if (string.Equals(trimmed, DeckName, StringComparison.Ordinal))
                return;

            DeckName = trimmed;
            await SaveDeckAsync().ConfigureAwait(false);
        };
    }

    private async Task OpenDeckSettingsAsync()
    {
        var deck = await _deckService.GetDeckByIdAsync(_deckId, default).ConfigureAwait(false);
        if (deck is null)
            return;
        var folders = await _deckService.ListFoldersAsync(default).ConfigureAwait(false);

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            var overlay = new FlashcardDeckSettingsOverlay
            {
                Title = "Deck settings",
                SaveText = _localization.T("Save", "Common"),
                CancelText = _localization.T("Cancel", "Common")
            };
            overlay.Initialize(deck.Name, deck.SchedulingAlgorithm, deck.FolderId, deck.Description, folders);
            var overlayId = _overlay.CreateOverlay(overlay, new OverlayOptions
            {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                ShowBackdrop = true,
                CloseOnOutsideClick = true,
                CloseOnEscape = true
            }, "FlashcardDeckSettings");

            overlay.OnResult = async result =>
            {
                _overlay.CloseOverlay(overlayId);
                if (result is null)
                    return;

                var refreshed = await _deckService.GetDeckByIdAsync(_deckId, default).ConfigureAwait(false);
                if (refreshed is null)
                    return;

                await _deckService.SaveDeckAsync(refreshed with
                {
                    SchedulingAlgorithm = result.SchedulingAlgorithm,
                    FolderId = result.FolderId,
                    Description = result.Description
                }).ConfigureAwait(false);

                await LoadDeckAsync().ConfigureAwait(false);
            };
        });
    }

    private async Task DuplicateDeckAsync()
    {
        var sourceDeck = await _deckService.GetDeckByIdAsync(_deckId, default).ConfigureAwait(false);
        if (sourceDeck == null)
            return;

        var newDeckId = Guid.NewGuid().ToString("n");
        var duplicateName = string.Format(
            System.Globalization.CultureInfo.CurrentCulture,
            _localization.T("DuplicateDeckTitleFormat", "Flashcards"),
            sourceDeck.Name);

        var duplicatedCards = sourceDeck.Cards
            .Select(c => c with
            {
                Id = Guid.NewGuid().ToString("n"),
                DeckId = newDeckId
            })
            .ToArray();

        var duplicatedDeck = sourceDeck with
        {
            Id = newDeckId,
            Name = duplicateName,
            Cards = duplicatedCards,
            LastStudied = null
        };

        await _deckService.SaveDeckAsync(duplicatedDeck).ConfigureAwait(false);
        await Dispatcher.UIThread.InvokeAsync(() =>
            _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(newDeckId)));
    }

    private void ScheduleCardAutosave()
    {
        if (SelectedCard == null)
            return;

        _cardAutosaveCts?.Cancel();
        _cardAutosaveCts = new CancellationTokenSource();
        _ = SaveCardDebouncedAsync(_cardAutosaveCts.Token);
    }

    private async Task SaveCardDebouncedAsync(CancellationToken token)
    {
        try
        {
            await Task.Delay(500, token).ConfigureAwait(false);
            await PersistSelectedCardFromEditorAsync().ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Ignore stale autosave requests.
        }
    }

    private async Task PersistSelectedCardFromEditorAsync()
    {
        if (SelectedCard == null)
            return;

        var selectedId = SelectedCard.Id;
        var existing = SelectedCard;
        var updatedTags = ParseEditorTags(EditorTags);
        var frontBlocks = BuildTextBlocksFromSpans(_editorFrontSpans);
        var backBlocks = BuildTextBlocksFromSpans(_editorBackSpans);
        var updated = existing with
        {
            Front = EditorFront,
            Back = EditorBack,
            Type = EditorCardType,
            Tags = updatedTags,
            FrontBlocks = frontBlocks,
            BackBlocks = backBlocks
        };

        if (existing.Front == updated.Front
            && existing.Back == updated.Back
            && existing.Type == updated.Type
            && existing.Tags.SequenceEqual(updated.Tags)
            && ReferenceEquals(existing.FrontBlocks, updated.FrontBlocks)
            && ReferenceEquals(existing.BackBlocks, updated.BackBlocks))
            return;

        IReadOnlyList<Flashcard> cardsSnapshot = await Dispatcher.UIThread.InvokeAsync(() =>
        {
            var snapshot = new Flashcard[Cards.Count];
            for (var i = 0; i < Cards.Count; i++)
            {
                var card = Cards[i];
                snapshot[i] = string.Equals(card.Id, selectedId, StringComparison.Ordinal) ? updated : card;
            }

            return snapshot;
        });
        await SaveDeckAsync(cardsSnapshot).ConfigureAwait(false);
    }

    private async Task LoadRetentionTrendAsync()
    {
        var points = await _deckService.GetDeckRetentionTrendAsync(_deckId, RetentionTrendWindowDays, default).ConfigureAwait(false);
        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            RetentionTrendPoints.Clear();
            foreach (var point in points)
                RetentionTrendPoints.Add(point);
            UpdateRetentionTrendDeltaText();
            RaiseRetentionTrendStateChanged();
        });
    }

    private void UpdateRetentionTrendDeltaText()
    {
        if (RetentionTrendPoints.Count < 2)
        {
            RetentionTrendDeltaText = _localization.T("RetentionTrendDeltaInsufficient", "Flashcards");
            return;
        }

        var split = RetentionTrendPoints.Count / 2;
        if (split == 0 || split >= RetentionTrendPoints.Count)
        {
            RetentionTrendDeltaText = _localization.T("RetentionTrendDeltaInsufficient", "Flashcards");
            return;
        }

        var previousPoints = RetentionTrendPoints
            .Take(split)
            .Where(point => point.ReviewsCount > 0)
            .ToList();
        var currentPoints = RetentionTrendPoints
            .Skip(split)
            .Where(point => point.ReviewsCount > 0)
            .ToList();

        if (previousPoints.Count == 0 || currentPoints.Count == 0)
        {
            RetentionTrendDeltaText = _localization.T("RetentionTrendDeltaInsufficient", "Flashcards");
            return;
        }

        var previousAverage = previousPoints.Average(point => point.RetentionPercent);
        var currentAverage = currentPoints.Average(point => point.RetentionPercent);
        var diff = (int)Math.Round(currentAverage - previousAverage, MidpointRounding.AwayFromZero);
        var absDiff = Math.Abs(diff);

        if (diff > 0)
        {
            RetentionTrendDeltaText = string.Format(
                System.Globalization.CultureInfo.CurrentCulture,
                _localization.T("RetentionTrendDeltaUpFormat", "Flashcards"),
                absDiff);
            return;
        }

        if (diff < 0)
        {
            RetentionTrendDeltaText = string.Format(
                System.Globalization.CultureInfo.CurrentCulture,
                _localization.T("RetentionTrendDeltaDownFormat", "Flashcards"),
                absDiff);
            return;
        }

        RetentionTrendDeltaText = _localization.T("RetentionTrendDeltaFlat", "Flashcards");
    }

    private IEnumerable<FlashcardRetentionTrendPoint> GetActiveRetentionTrendPoints() =>
        RetentionTrendPoints.Where(point => point.ReviewsCount > 0);

    private void RaiseRetentionTrendStateChanged()
    {
        OnPropertyChanged(nameof(HasRetentionTrendData));
        OnPropertyChanged(nameof(RetentionTrendSummaryPercentText));
        OnPropertyChanged(nameof(RetentionTrendSummaryLabel));
        OnPropertyChanged(nameof(RetentionTrendActivityText));
    }

    public string FocusedModeMetricLabel =>
        FocusedUseTimeLimit
            ? _localization.T("FocusedTimeLimit", "Flashcards")
            : _localization.T("FocusedCardCount", "Flashcards");

    public string CurrentSchedulingEngineLabel => _deckSchedulingAlgorithm switch
    {
        FlashcardSchedulingAlgorithm.Fsrs => _localization.T("SchedulingEngineSmart", "Flashcards"),
        FlashcardSchedulingAlgorithm.Sm2 => _localization.T("SchedulingEngineClassic", "Flashcards"),
        FlashcardSchedulingAlgorithm.Leitner => _localization.T("SchedulingEngineBoxed", "Flashcards"),
        _ => _localization.T("SchedulingEngineSimple", "Flashcards")
    };

    public string ReviewSessionDescription =>
        string.Format(
            System.Globalization.CultureInfo.CurrentCulture,
            _localization.T("SessionReviewDescFormat", "Flashcards"),
            CurrentSchedulingEngineLabel);

    public double FocusedSliderMin => FocusedUseTimeLimit ? 5 : 5;

    public double FocusedSliderMax => FocusedUseTimeLimit ? 60 : 100;

    public double FocusedMetricSliderValue
    {
        get => FocusedUseTimeLimit ? FocusedTimeLimitSlider : FocusedCardCountSlider;
        set
        {
            if (FocusedUseTimeLimit)
                FocusedTimeLimitSlider = value;
            else
                FocusedCardCountSlider = value;
        }
    }

    private void ScheduleDeckAutosave()
    {
        _deckAutosaveCts?.Cancel();
        _deckAutosaveCts = new CancellationTokenSource();
        _ = SaveDeckDebouncedAsync(_deckAutosaveCts.Token);
    }

    private async Task SaveDeckDebouncedAsync(CancellationToken token)
    {
        try
        {
            await Task.Delay(500, token).ConfigureAwait(false);
            await SaveDeckAsync().ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Ignore stale autosave requests.
        }
    }

    /// <summary>Matches practice session cloze markup: <c>{{c1::hidden}}</c>.</summary>
    public static bool FrontIndicatesCloze(string front) =>
        front.Length > 0 && ClozeOrdinalPattern.IsMatch(front);

    /// <summary>Inserts or wraps the next <c>{{cN::…}}</c> marker; <paramref name="selEnd"/> is exclusive.</summary>
    public static (string NewText, int CaretPosition) BuildFrontWithClozeInserted(string front, int selStart, int selEnd)
    {
        selStart = Math.Clamp(selStart, 0, front.Length);
        selEnd = Math.Clamp(selEnd, 0, front.Length);
        if (selEnd < selStart)
            (selStart, selEnd) = (selEnd, selStart);

        var maxOrdinal = 0;
        foreach (Match m in ClozeOrdinalPattern.Matches(front))
        {
            if (int.TryParse(m.Groups[1].Value, out var o))
                maxOrdinal = Math.Max(maxOrdinal, o);
        }

        var n = maxOrdinal + 1;
        var before = front[..selStart];
        var after = front[selEnd..];
        var selectedLength = selEnd - selStart;
        var selected = selectedLength > 0 ? front.Substring(selStart, selectedLength) : string.Empty;

        var wrapped = selected.Length > 0
            ? $"{{{{c{n}::{selected}}}}}"
            : $"{{{{c{n}::}}}}";

        var newText = before + wrapped + after;
        var caret = selected.Length > 0
            ? selStart + wrapped.Length
            : selStart + wrapped.IndexOf("::", StringComparison.Ordinal) + 2;
        return (newText, caret);
    }
}
