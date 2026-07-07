using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Statistics;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>
/// The study session shell, shared by Review and Cram. The stateful <see cref="IFlashcardSession"/>
/// engine owns the queue, in-session requeue, persistence (Review only) and single-step undo; this
/// ViewModel is a thin projection over it: it renders the current card (markdown front/back with cloze
/// masking + first-class attachments), computes the four next-interval previews from the deck's preset,
/// drives the auto-reveal timer, and routes grade / undo / edit / flag / close through the engine. It
/// never grades or persists directly — every mutation goes through the engine so the "Review persists,
/// Cram persists nothing / Again requeues in-session" invariants hold by construction.
/// </summary>
public partial class FlashcardSessionViewModel : ViewModelBase, INavigationAware, IDisposable
{
    private readonly IFlashcardStudyService _study;
    private readonly IFlashcardCardService _cards;
    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardPresetService _presets;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILocalizationService _localization;
    private readonly IStatisticsManager _statistics;
    private readonly ILoggerService _logger;

    private IFlashcardSession? _session;
    private FlashcardAutoReveal _autoReveal = FlashcardAutoReveal.Off;

    /// <summary>Cancels an in-flight start/grade/undo, and is signalled on dispose.</summary>
    private readonly CancellationTokenSource _lifetimeCts = new();

    /// <summary>Cancels a pending auto-reveal when the card changes / the user reveals manually.</summary>
    private CancellationTokenSource? _autoRevealCts;

    /// <summary>Grades performed minus undos — drives <see cref="CanUndo"/> without an engine query.</summary>
    private int _undoDepth;

    /// <summary>Cards graded this session (for the Activity stat bucket on leave).</summary>
    private int _cardsGraded;

    private DateTimeOffset _startedAt;
    private bool _activityRecorded;
    private bool _disposed;
    private bool _busy;

    public FlashcardSessionViewModel(
        IFlashcardStudyService study,
        IFlashcardCardService cards,
        IFlashcardLibraryService library,
        IFlashcardPresetService presets,
        INavigationService navigation,
        IOverlayService overlay,
        ILocalizationService localization,
        IStatisticsManager statistics,
        ILoggerService logger)
    {
        _study = study;
        _cards = cards;
        _library = library;
        _presets = presets;
        _navigation = navigation;
        _overlay = overlay;
        _localization = localization;
        _statistics = statistics;
        _logger = logger;

        CloseCommand = new AsyncRelayCommand(CloseAsync);
        RevealCommand = new RelayCommand(Reveal, () => IsActive && !IsRevealed);
        GradeAgainCommand = new AsyncRelayCommand(() => GradeAsync(FlashcardReviewGrade.Again), () => CanGrade);
        GradeHardCommand = new AsyncRelayCommand(() => GradeAsync(FlashcardReviewGrade.Hard), () => CanGrade);
        GradeGoodCommand = new AsyncRelayCommand(() => GradeAsync(FlashcardReviewGrade.Good), () => CanGrade);
        GradeEasyCommand = new AsyncRelayCommand(() => GradeAsync(FlashcardReviewGrade.Easy), () => CanGrade);
        UndoCommand = new AsyncRelayCommand(UndoAsync, () => CanUndo);
        EditCommand = new RelayCommand(RaiseEditRequested, () => IsActive);
        FlagCommand = new AsyncRelayCommand(ToggleFlagAsync, () => IsActive);
        SpaceCommand = new AsyncRelayCommand(OnSpaceAsync);
        BackToDeckCommand = new RelayCommand(NavigateBackToDeck);
    }

    // --- Commands ----------------------------------------------------------

    public IAsyncRelayCommand CloseCommand { get; }
    public IRelayCommand RevealCommand { get; }
    public IAsyncRelayCommand GradeAgainCommand { get; }
    public IAsyncRelayCommand GradeHardCommand { get; }
    public IAsyncRelayCommand GradeGoodCommand { get; }
    public IAsyncRelayCommand GradeEasyCommand { get; }
    public IAsyncRelayCommand UndoCommand { get; }
    public IRelayCommand EditCommand { get; }
    public IAsyncRelayCommand FlagCommand { get; }

    /// <summary>Space: reveal before the answer is shown, grade Good after. Routed from the view.</summary>
    public IAsyncRelayCommand SpaceCommand { get; }

    public IRelayCommand BackToDeckCommand { get; }

    /// <summary>Raised for E / edit-icon: the view opens the card editor overlay for <see cref="CurrentCardId"/>.</summary>
    public event Action<string>? EditRequested;

    /// <summary>The card currently on screen (null off the active state); the view uses it to re-open the editor.</summary>
    public string? CurrentCardId => _session?.Current?.Card.Id;

    /// <summary>Deck id of the running session (for the view's session-settings launcher).</summary>
    public string? SessionDeckId => _session?.DeckId;

    // --- Header / mode -----------------------------------------------------

    [ObservableProperty]
    private string _deckName = string.Empty;

    [ObservableProperty]
    private bool _isCram;

    /// <summary>Mode chip label: "Review · scheduled" or "Cram · won't change your schedule".</summary>
    [ObservableProperty]
    private string _modeChipText = string.Empty;

    // --- Counters + progress ----------------------------------------------

    [ObservableProperty]
    private int _newCount;

    [ObservableProperty]
    private int _learningCount;

    [ObservableProperty]
    private int _dueCount;

    public bool HasNew => NewCount > 0;
    public bool HasLearning => LearningCount > 0;
    public bool HasDue => DueCount > 0;

    /// <summary>Filled width in px of the 160px progress bar (0..160).</summary>
    [ObservableProperty]
    private double _progressFillWidth;

    /// <summary>Done / total, mono ("12 / 63").</summary>
    [ObservableProperty]
    private string _progressText = string.Empty;

    /// <summary>OS-specific undo-modifier label for the footer kbd chip ("⌘Z" on macOS, else "Ctrl+Z").</summary>
    public string UndoKeyLabel { get; } =
        OperatingSystem.IsMacOS() ? "⌘Z" : "Ctrl+Z";

    // --- View state --------------------------------------------------------

    [ObservableProperty]
    private bool _isLoading = true;

    /// <summary>An active card is on screen (front or answer).</summary>
    [ObservableProperty]
    private bool _isActive;

    /// <summary>The answer has been revealed (shows the divider, back, and grade row).</summary>
    [ObservableProperty]
    private bool _isRevealed;

    /// <summary>Queue exhausted after studying at least one card.</summary>
    [ObservableProperty]
    private bool _isComplete;

    /// <summary>A Review session that started with nothing scheduled (the "all caught up" nudge).</summary>
    [ObservableProperty]
    private bool _isAllCaughtUp;

    // --- Card content ------------------------------------------------------

    /// <summary>Front markdown, with cloze deletions masked to <c>[…]</c> for cloze cards.</summary>
    [ObservableProperty]
    private string _frontText = string.Empty;

    /// <summary>Answer markdown: back text, or the cloze card's front with deletions revealed emphasized.</summary>
    [ObservableProperty]
    private string _answerText = string.Empty;

    [ObservableProperty]
    private bool _isFlagged;

    /// <summary>Front-side attachments of the current card (framed figures / carousel under the front).</summary>
    public FlashcardAttachmentCarousel FrontAttachments { get; } = new();

    /// <summary>Back-side attachments, shown beside the answer once revealed.</summary>
    public FlashcardAttachmentCarousel BackAttachments { get; } = new();

    // --- Grade interval previews ------------------------------------------

    [ObservableProperty]
    private string _againInterval = string.Empty;

    [ObservableProperty]
    private string _hardInterval = string.Empty;

    [ObservableProperty]
    private string _goodInterval = string.Empty;

    [ObservableProperty]
    private string _easyInterval = string.Empty;

    // --- Completion summary ------------------------------------------------

    [ObservableProperty]
    private string _summaryText = string.Empty;

    private bool CanGrade => IsActive && IsRevealed && !_busy;
    public bool CanUndo => _undoDepth > 0 && !_busy;

    // --- Navigation lifecycle ---------------------------------------------

    public void OnNavigatedTo(object? parameter)
    {
        var request = parameter switch
        {
            FlashcardSessionNavigationParameter p => new FlashcardSessionRequest(p.DeckId, p.Mode, p.Scope),
            _ => null
        };

        if (request is null || string.IsNullOrWhiteSpace(request.DeckId))
        {
            _navigation.NavigateTo("flashcards");
            return;
        }

        _startedAt = DateTimeOffset.UtcNow;
        IsCram = request.Mode == FlashcardSessionMode.Cram;
        ModeChipText = _localization.T(IsCram ? "StudyModeChipCram" : "StudyModeChipReview", "Flashcards");
        _ = StartAsync(request);
    }

    public void OnNavigatedFrom() => _ = RecordActivityAsync();

    private async Task StartAsync(FlashcardSessionRequest request)
    {
        var token = _lifetimeCts.Token;
        try
        {
            // Deck header (name) + the deck's preset (auto-reveal) — the header comes from the library
            // service; the study service exposes only the session + due counts.
            var summary = await _library.GetDeckAsync(request.DeckId, token).ConfigureAwait(false);
            var deckDisplayName = summary?.Header.Name ?? string.Empty;
            if (summary is not null)
            {
                var preset = await _presets.GetPresetAsync(summary.Header.PresetId, token).ConfigureAwait(false);
                _autoReveal = preset?.AutoReveal ?? FlashcardAutoReveal.Off;
            }

            var session = await _study.StartSessionAsync(request, token).ConfigureAwait(false);
            if (token.IsCancellationRequested)
                return;

            _session = session;

            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                DeckName = deckDisplayName;
                IsLoading = false;
                if (session.IsFinished)
                {
                    // Review with an empty scheduled queue → "all caught up"; Cram with an empty scope
                    // → the ordinary completion state (nothing to practise).
                    if (!IsCram)
                        IsAllCaughtUp = true;
                    else
                        ShowComplete();
                    RefreshProgress();
                }
                else
                {
                    PresentCurrent();
                }
                NotifyCommandStates();
            });
        }
        catch (OperationCanceledException)
        {
            // Navigated away mid-start.
        }
        catch (Exception ex)
        {
            _logger?.Error("Flashcards", "Starting study session failed.", ex);
            await Dispatcher.UIThread.InvokeAsync(() => _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(request.DeckId)));
        }
    }

    // --- Presenting the current card --------------------------------------

    private void PresentCurrent()
    {
        var view = _session?.Current;
        if (view is null)
        {
            ShowComplete();
            return;
        }

        var card = view.Card;
        IsActive = true;
        IsRevealed = false;
        IsComplete = false;
        IsAllCaughtUp = false;
        IsFlagged = card.IsFlagged;

        var isCloze = card.Type == FlashcardType.Cloze;
        FrontText = isCloze ? FlashcardClozeText.Mask(card.Front) : card.Front;
        AnswerText = isCloze ? FlashcardClozeText.Reveal(card.Front) : card.Back;

        FrontAttachments.Set(card.Attachments, FlashcardAttachment.FrontSide);
        BackAttachments.Set(card.Attachments, FlashcardAttachment.BackSide);

        // Compute all four previews up front (the engine reads the current card + deck preset).
        AgainInterval = _session!.DescribeInterval(FlashcardReviewGrade.Again);
        HardInterval = _session.DescribeInterval(FlashcardReviewGrade.Hard);
        GoodInterval = _session.DescribeInterval(FlashcardReviewGrade.Good);
        EasyInterval = _session.DescribeInterval(FlashcardReviewGrade.Easy);

        RefreshProgress();
        OnPropertyChanged(nameof(CurrentCardId));
        NotifyCommandStates();
        StartAutoRevealTimer();
    }

    private void RefreshProgress()
    {
        var progress = _session?.Progress ?? FlashcardSessionProgress.Empty;
        NewCount = progress.New;
        LearningCount = progress.Learning;
        DueCount = progress.Due;
        OnPropertyChanged(nameof(HasNew));
        OnPropertyChanged(nameof(HasLearning));
        OnPropertyChanged(nameof(HasDue));

        var total = progress.Total;
        var fraction = total <= 0 ? 0d : Math.Clamp((double)progress.Completed / total, 0d, 1d);
        ProgressFillWidth = 160d * fraction;
        ProgressText = string.Format(CultureInfo.CurrentCulture,
            _localization.T("StudyProgressFormat", "Flashcards"), progress.Completed, total);
    }

    private void ShowComplete()
    {
        CancelAutoReveal();
        IsActive = false;
        IsRevealed = false;
        IsComplete = true;
        IsAllCaughtUp = false;
        var progress = _session?.Progress ?? FlashcardSessionProgress.Empty;
        SummaryText = string.Format(CultureInfo.CurrentCulture,
            _localization.T("StudyCompleteSummaryFormat", "Flashcards"), progress.Completed);
        RefreshProgress();
        OnPropertyChanged(nameof(CurrentCardId));
        NotifyCommandStates();
    }

    // --- Reveal + auto-reveal ---------------------------------------------

    private void Reveal()
    {
        if (!IsActive || IsRevealed)
            return;
        CancelAutoReveal();
        IsRevealed = true;
        NotifyCommandStates();
    }

    private void StartAutoRevealTimer()
    {
        CancelAutoReveal();
        var seconds = _autoReveal switch
        {
            FlashcardAutoReveal.FiveSeconds => 5,
            FlashcardAutoReveal.TenSeconds => 10,
            _ => 0
        };
        if (seconds <= 0)
            return;

        var cts = CancellationTokenSource.CreateLinkedTokenSource(_lifetimeCts.Token);
        _autoRevealCts = cts;
        _ = AutoRevealAsync(seconds, cts.Token);
    }

    private async Task AutoRevealAsync(int seconds, CancellationToken token)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(seconds), token).ConfigureAwait(true);
            if (!token.IsCancellationRequested && IsActive && !IsRevealed)
                Reveal();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a manual reveal, a new card, or dispose.
        }
    }

    private void CancelAutoReveal()
    {
        _autoRevealCts?.Cancel();
        _autoRevealCts?.Dispose();
        _autoRevealCts = null;
    }

    // --- Grading -----------------------------------------------------------

    private async Task GradeAsync(FlashcardReviewGrade grade)
    {
        if (!CanGrade || _session is null)
            return;

        _busy = true;
        NotifyCommandStates();
        CancelAutoReveal();
        try
        {
            await _session.GradeAsync(grade, _lifetimeCts.Token).ConfigureAwait(true);
            _undoDepth++;
            _cardsGraded++;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _logger?.Error("Flashcards", "Grading a card failed.", ex);
        }
        finally
        {
            _busy = false;
        }

        if (_session.IsFinished)
            ShowComplete();
        else
            PresentCurrent();
    }

    private async Task OnSpaceAsync()
    {
        if (IsActive && !IsRevealed)
            Reveal();
        else if (CanGrade)
            await GradeAsync(FlashcardReviewGrade.Good).ConfigureAwait(true);
    }

    // --- Undo --------------------------------------------------------------

    private async Task UndoAsync()
    {
        if (!CanUndo || _session is null)
            return;

        _busy = true;
        NotifyCommandStates();
        CancelAutoReveal();
        try
        {
            var undone = await _session.UndoAsync(_lifetimeCts.Token).ConfigureAwait(true);
            if (undone)
            {
                _undoDepth = Math.Max(0, _undoDepth - 1);
                _cardsGraded = Math.Max(0, _cardsGraded - 1);
            }
            else
            {
                // Engine had nothing to undo — resync our depth so the button disables.
                _undoDepth = 0;
            }
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _logger?.Error("Flashcards", "Undoing a review failed.", ex);
        }
        finally
        {
            _busy = false;
        }

        // The undone card is back at the front (or the queue is unchanged); re-present it unrevealed
        // with fresh counters and refreshed command states.
        PresentCurrent();
    }

    // --- Edit + flag -------------------------------------------------------

    private void RaiseEditRequested()
    {
        if (CurrentCardId is { } id)
            EditRequested?.Invoke(id);
    }

    /// <summary>
    /// Called by the view after the card editor overlay closes: re-reads the current card's content
    /// so edits (front/back/attachments/flag) show immediately, preserving reveal state.
    /// </summary>
    public async Task RefreshCurrentCardAsync()
    {
        if (_session?.Current is not { } view)
            return;
        try
        {
            var updated = await _cards.GetCardAsync(view.Card.Id, _lifetimeCts.Token).ConfigureAwait(true);
            if (updated is null)
                return;

            IsFlagged = updated.IsFlagged;
            var isCloze = updated.Type == FlashcardType.Cloze;
            FrontText = isCloze ? FlashcardClozeText.Mask(updated.Front) : updated.Front;
            AnswerText = isCloze ? FlashcardClozeText.Reveal(updated.Front) : updated.Back;
            FrontAttachments.Set(updated.Attachments, FlashcardAttachment.FrontSide);
            BackAttachments.Set(updated.Attachments, FlashcardAttachment.BackSide);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger?.Error("Flashcards", "Refreshing the edited card failed.", ex);
        }
    }

    private async Task ToggleFlagAsync()
    {
        if (_session?.Current is not { } view)
            return;
        var next = !IsFlagged;
        try
        {
            await _cards.SetFlaggedAsync(new[] { view.Card.Id }, next, _lifetimeCts.Token).ConfigureAwait(true);
            IsFlagged = next;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger?.Error("Flashcards", "Toggling the card flag failed.", ex);
        }
    }

    // --- Close / back ------------------------------------------------------

    private async Task CloseAsync()
    {
        // Confirm only when a session is mid-flight with real progress.
        var midSession = IsActive && _cardsGraded > 0;
        if (midSession)
        {
            var leaveLabel = _localization.T("StudyLeaveConfirm", "Flashcards");
            var cancelLabel = _localization.T("Cancel", "Common");
            var result = await _overlay.CreateDialogAsync(
                _localization.T("StudyLeaveTitle", "Flashcards"),
                _localization.T("StudyLeaveMessage", "Flashcards"),
                leaveLabel,
                cancelLabel,
                severity: DialogSeverity.Default).ConfigureAwait(true);
            if (!string.Equals(result, leaveLabel, StringComparison.Ordinal))
                return;
        }
        NavigateBackToDeck();
    }

    private void NavigateBackToDeck()
    {
        var deckId = _session?.DeckId;
        if (string.IsNullOrWhiteSpace(deckId))
            _navigation.NavigateTo("flashcards");
        else
            _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(deckId));
    }

    // --- Activity stats ----------------------------------------------------

    private async Task RecordActivityAsync()
    {
        if (_activityRecorded || _cardsGraded <= 0)
            return;
        _activityRecorded = true;

        var deckId = _session?.DeckId ?? string.Empty;
        var completedAt = DateTimeOffset.UtcNow;
        var minutes = (int)Math.Max(1, Math.Round((completedAt - _startedAt).TotalMinutes, MidpointRounding.AwayFromZero));
        var mode = IsCram ? "cram" : "review";
        await StatisticsRecorder.RecordFlashcardActivityAsync(
            _statistics, _logger, deckId, DeckName, mode, _cardsGraded, minutes, completedAt).ConfigureAwait(false);
    }

    // --- Command notify ----------------------------------------------------

    private void NotifyCommandStates()
    {
        RevealCommand.NotifyCanExecuteChanged();
        GradeAgainCommand.NotifyCanExecuteChanged();
        GradeHardCommand.NotifyCanExecuteChanged();
        GradeGoodCommand.NotifyCanExecuteChanged();
        GradeEasyCommand.NotifyCanExecuteChanged();
        UndoCommand.NotifyCanExecuteChanged();
        EditCommand.NotifyCanExecuteChanged();
        FlagCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(CanUndo));
    }

    partial void OnIsActiveChanged(bool value) => NotifyCommandStates();
    partial void OnIsRevealedChanged(bool value) => NotifyCommandStates();

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;

        // Fire-and-forget the activity write if the VM is disposed before OnNavigatedFrom recorded it
        // (defensive; NavigationService calls OnNavigatedFrom before disposing on normal navigations).
        _ = RecordActivityAsync();

        CancelAutoReveal();
        _lifetimeCts.Cancel();
        _lifetimeCts.Dispose();
    }
}
