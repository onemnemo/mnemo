using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
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
/// The Test session shell: a typed, self-checked practice mode with its <b>own</b> scoring domain,
/// fully isolated from FSRS. It never calls <see cref="IFlashcardStudyService.RecordReviewAsync"/> and
/// never reads/writes scheduling beyond displaying card content; on completion it writes exactly one
/// <see cref="FlashcardTestAttempt"/> via <see cref="IFlashcardStatsService.RecordTestAttemptAsync"/>
/// (nothing is written when the session is abandoned).
///
/// The queue is Test's own: every active (non-suspended) card of the deck, ordered by due date, or
/// shuffled when the deck preset's <c>ShuffleOrder</c> is on. Grading is a three-way tally
/// (Missed / Close / Got it) held in memory — there is no per-card persistence — and single-step undo
/// simply steps back to the previous card, restores its typed answer and decrements its tally.
/// </summary>
public partial class FlashcardTestViewModel : ViewModelBase, INavigationAware, IDisposable
{
    /// <summary>Upper bound on the Test queue; decks larger than this are truncated (a Test is a session, not the library).</summary>
    private const int MaxCards = 2000;

    /// <summary>Test's own self-check grade — deliberately distinct from FSRS <see cref="FlashcardReviewGrade"/>.</summary>
    private enum TestGrade
    {
        Missed = 0,
        Close = 1,
        GotIt = 2
    }

    private readonly IFlashcardCardService _cards;
    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardPresetService _presets;
    private readonly IFlashcardStatsService _stats;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILocalizationService _localization;
    private readonly IStatisticsManager _statistics;
    private readonly ILoggerService _logger;

    /// <summary>Cancels an in-flight start/grade/record, and is signalled on dispose.</summary>
    private readonly CancellationTokenSource _lifetimeCts = new();

    private string _deckId = string.Empty;

    /// <summary>The ordered Test queue (all active cards; due-order or shuffled per preset).</summary>
    private IReadOnlyList<Flashcard> _queue = Array.Empty<Flashcard>();

    /// <summary>Per-card typed answer, indexed by queue position (persists across undo).</summary>
    private string[] _typedAnswers = Array.Empty<string>();

    /// <summary>Per-card recorded grade (null = not yet graded), indexed by queue position.</summary>
    private TestGrade?[] _grades = Array.Empty<TestGrade?>();

    private int _index;
    private int _gotItCount;
    private int _closeCount;
    private int _missedCount;

    private DateTimeOffset _startedAt;
    private bool _attemptRecorded;
    private bool _activityRecorded;
    private bool _disposed;

    public FlashcardTestViewModel(
        IFlashcardCardService cards,
        IFlashcardLibraryService library,
        IFlashcardPresetService presets,
        IFlashcardStatsService stats,
        INavigationService navigation,
        IOverlayService overlay,
        ILocalizationService localization,
        IStatisticsManager statistics,
        ILoggerService logger)
    {
        _cards = cards;
        _library = library;
        _presets = presets;
        _stats = stats;
        _navigation = navigation;
        _overlay = overlay;
        _localization = localization;
        _statistics = statistics;
        _logger = logger;

        CloseCommand = new AsyncRelayCommand(CloseAsync);
        RevealCommand = new RelayCommand(Reveal, () => IsActive && !IsRevealed);
        GradeMissedCommand = new RelayCommand(() => Grade(TestGrade.Missed), () => CanGrade);
        GradeCloseCommand = new RelayCommand(() => Grade(TestGrade.Close), () => CanGrade);
        GradeGotItCommand = new RelayCommand(() => Grade(TestGrade.GotIt), () => CanGrade);
        UndoCommand = new RelayCommand(Undo, () => CanUndo);
        EditCommand = new RelayCommand(RaiseEditRequested, () => IsActive);
        FlagCommand = new AsyncRelayCommand(ToggleFlagAsync, () => IsActive);
        BackToDeckCommand = new RelayCommand(NavigateBackToDeck);
    }

    // --- Commands ----------------------------------------------------------

    public IAsyncRelayCommand CloseCommand { get; }
    public IRelayCommand RevealCommand { get; }
    public IRelayCommand GradeMissedCommand { get; }
    public IRelayCommand GradeCloseCommand { get; }
    public IRelayCommand GradeGotItCommand { get; }
    public IRelayCommand UndoCommand { get; }
    public IRelayCommand EditCommand { get; }
    public IAsyncRelayCommand FlagCommand { get; }
    public IRelayCommand BackToDeckCommand { get; }

    /// <summary>Raised for E / edit-icon: the view opens the card editor overlay for <see cref="CurrentCardId"/>.</summary>
    public event Action<string>? EditRequested;

    /// <summary>Raised each time an unrevealed card is presented, so the view can focus the answer box.</summary>
    public event Action? CardPresented;

    /// <summary>The card currently on screen (null off the active state); the view uses it to re-open the editor.</summary>
    public string? CurrentCardId => IsActive && _index < _queue.Count ? _queue[_index].Id : null;

    /// <summary>Deck id of the running session (for the view's session-settings launcher).</summary>
    public string? SessionDeckId => string.IsNullOrWhiteSpace(_deckId) ? null : _deckId;

    // --- Header ------------------------------------------------------------

    [ObservableProperty]
    private string _deckName = string.Empty;

    // --- Counters + progress ----------------------------------------------

    [ObservableProperty]
    private int _gotItTally;

    [ObservableProperty]
    private int _closeTally;

    [ObservableProperty]
    private int _missedTally;

    public bool HasGotIt => GotItTally > 0;
    public bool HasClose => CloseTally > 0;
    public bool HasMissed => MissedTally > 0;

    /// <summary>Filled width in px of the 160px progress bar (0..160).</summary>
    [ObservableProperty]
    private double _progressFillWidth;

    /// <summary>Done / total, mono ("13 / 20").</summary>
    [ObservableProperty]
    private string _progressText = string.Empty;

    /// <summary>OS-specific undo-modifier label for the footer kbd chip ("⌘Z" on macOS, else "Ctrl+Z").</summary>
    public string UndoKeyLabel { get; } =
        OperatingSystem.IsMacOS() ? "⌘Z" : "Ctrl+Z";

    // --- View state --------------------------------------------------------

    [ObservableProperty]
    private bool _isLoading = true;

    /// <summary>An active card is on screen (typed-answer or reveal state).</summary>
    [ObservableProperty]
    private bool _isActive;

    /// <summary>The correct answer has been revealed (shows the read-only typed answer, back, and grade row).</summary>
    [ObservableProperty]
    private bool _isRevealed;

    /// <summary>The end-of-session score screen is shown.</summary>
    [ObservableProperty]
    private bool _isComplete;

    /// <summary>The deck had no active cards to test (the "nothing to test" state).</summary>
    [ObservableProperty]
    private bool _isEmpty;

    // --- Card content ------------------------------------------------------

    /// <summary>Front markdown, with cloze deletions masked to <c>[…]</c> for cloze cards.</summary>
    [ObservableProperty]
    private string _frontText = string.Empty;

    /// <summary>Correct-answer markdown: back text, or the cloze card's full front with deletions revealed.</summary>
    [ObservableProperty]
    private string _answerText = string.Empty;

    /// <summary>The learner's typed answer for the current card (two-way bound to the input box).</summary>
    [ObservableProperty]
    private string _typedAnswer = string.Empty;

    /// <summary>True once the current card's typed answer is non-empty (enables the Reveal affordance styling).</summary>
    public bool HasTypedAnswer => !string.IsNullOrWhiteSpace(TypedAnswer);

    [ObservableProperty]
    private bool _isFlagged;

    /// <summary>Back-side attachments, shown beside the correct answer once revealed (framed figure / carousel).</summary>
    public FlashcardAttachmentCarousel BackAttachments { get; } = new();

    // --- Score screen ------------------------------------------------------

    /// <summary>Final score, formatted "84%".</summary>
    [ObservableProperty]
    private string _scorePercentText = string.Empty;

    /// <summary>"You did better than last time" / worse / first-attempt line.</summary>
    [ObservableProperty]
    private string _deltaText = string.Empty;

    /// <summary>Best score to date, formatted "91%".</summary>
    [ObservableProperty]
    private string _bestScoreText = string.Empty;

    [ObservableProperty]
    private bool _hasBestScore;

    /// <summary>Final Got-it / Close / Missed counts for the score-screen count row.</summary>
    [ObservableProperty]
    private int _finalGotIt;

    [ObservableProperty]
    private int _finalClose;

    [ObservableProperty]
    private int _finalMissed;

    /// <summary>Sparkline points (0..100 score per past attempt, oldest→newest incl. the current one).</summary>
    [ObservableProperty]
    private IReadOnlyList<double> _trendScores = Array.Empty<double>();

    [ObservableProperty]
    private bool _hasTrend;

    private bool CanGrade => IsActive && IsRevealed;
    public bool CanUndo => _index > 0;

    // --- Navigation lifecycle ---------------------------------------------

    public void OnNavigatedTo(object? parameter)
    {
        var deckId = parameter switch
        {
            FlashcardSessionNavigationParameter p => p.DeckId,
            _ => null
        };

        if (string.IsNullOrWhiteSpace(deckId))
        {
            _navigation.NavigateTo("flashcards");
            return;
        }

        _deckId = deckId;
        _startedAt = DateTimeOffset.UtcNow;
        _ = StartAsync(deckId);
    }

    public void OnNavigatedFrom() => _ = RecordActivityAsync();

    private async Task StartAsync(string deckId)
    {
        var token = _lifetimeCts.Token;
        try
        {
            var summary = await _library.GetDeckAsync(deckId, token).ConfigureAwait(false);
            var deckDisplayName = summary?.Header.Name ?? string.Empty;

            var shuffle = false;
            if (summary is not null)
            {
                var preset = await _presets.GetPresetAsync(summary.Header.PresetId, token).ConfigureAwait(false);
                shuffle = preset?.ShuffleOrder ?? false;
            }

            // Test drives its own queue: all active (non-suspended) cards of the deck, due-order. The
            // study service's StartSessionAsync throws for Test by design, so we build from the card
            // service. State filter All also returns suspended rows, so we filter to Active here.
            var page = await _cards.ListCardsAsync(
                new FlashcardCardQuery(deckId, State: FlashcardCardStateFilter.All,
                    Sort: FlashcardCardSort.Due, Limit: MaxCards),
                token).ConfigureAwait(false);

            var active = page.Items
                .Where(v => v.Card.State == FlashcardCardState.Active)
                .Select(v => v.Card)
                .ToList();

            IReadOnlyList<Flashcard> ordered = shuffle
                ? active.OrderBy(_ => Guid.NewGuid()).ToList()
                : active;

            if (token.IsCancellationRequested)
                return;

            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                DeckName = deckDisplayName;
                IsLoading = false;
                _queue = ordered;
                _typedAnswers = new string[ordered.Count];
                _grades = new TestGrade?[ordered.Count];
                for (var i = 0; i < _typedAnswers.Length; i++)
                    _typedAnswers[i] = string.Empty;

                if (ordered.Count == 0)
                {
                    IsEmpty = true;
                    NotifyCommandStates();
                }
                else
                {
                    _index = 0;
                    PresentCurrent();
                }
            });
        }
        catch (OperationCanceledException)
        {
            // Navigated away mid-start.
        }
        catch (Exception ex)
        {
            _logger?.Error("Flashcards", "Starting test session failed.", ex);
            await Dispatcher.UIThread.InvokeAsync(() =>
                _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(deckId)));
        }
    }

    // --- Presenting the current card --------------------------------------

    private void PresentCurrent()
    {
        if (_index >= _queue.Count)
        {
            _ = CompleteAsync();
            return;
        }

        var card = _queue[_index];
        IsActive = true;
        IsRevealed = false;
        IsComplete = false;
        IsEmpty = false;
        IsFlagged = card.IsFlagged;

        var isCloze = card.Type == FlashcardType.Cloze;
        FrontText = isCloze ? FlashcardClozeText.Mask(card.Front) : card.Front;
        AnswerText = isCloze ? FlashcardClozeText.Reveal(card.Front) : card.Back;
        TypedAnswer = _typedAnswers[_index];

        // Only the correct answer's attachments show (beside the correct answer after reveal).
        BackAttachments.Set(card.Attachments, FlashcardAttachment.BackSide);

        RefreshProgress();
        OnPropertyChanged(nameof(CurrentCardId));
        NotifyCommandStates();
        CardPresented?.Invoke();
    }

    private void RefreshProgress()
    {
        var total = _queue.Count;
        var completed = _index; // graded cards precede the current one
        var fraction = total <= 0 ? 0d : Math.Clamp((double)completed / total, 0d, 1d);
        ProgressFillWidth = 160d * fraction;
        ProgressText = string.Format(CultureInfo.CurrentCulture,
            _localization.T("StudyProgressFormat", "Flashcards"), completed, total);

        GotItTally = _gotItCount;
        CloseTally = _closeCount;
        MissedTally = _missedCount;
        OnPropertyChanged(nameof(HasGotIt));
        OnPropertyChanged(nameof(HasClose));
        OnPropertyChanged(nameof(HasMissed));
    }

    // --- Reveal ------------------------------------------------------------

    private void Reveal()
    {
        if (!IsActive || IsRevealed)
            return;
        // Freeze the typed answer for this card so undo can restore it.
        _typedAnswers[_index] = TypedAnswer;
        IsRevealed = true;
        NotifyCommandStates();
    }

    // --- Grading -----------------------------------------------------------

    private void Grade(TestGrade grade)
    {
        if (!CanGrade)
            return;

        _typedAnswers[_index] = TypedAnswer;
        _grades[_index] = grade;
        ApplyTally(grade, +1);

        _index++;
        if (_index >= _queue.Count)
            _ = CompleteAsync();
        else
            PresentCurrent();
    }

    private void ApplyTally(TestGrade grade, int delta)
    {
        switch (grade)
        {
            case TestGrade.GotIt:
                _gotItCount = Math.Max(0, _gotItCount + delta);
                break;
            case TestGrade.Close:
                _closeCount = Math.Max(0, _closeCount + delta);
                break;
            default:
                _missedCount = Math.Max(0, _missedCount + delta);
                break;
        }
    }

    // --- Undo (single step, in-memory) ------------------------------------

    private void Undo()
    {
        if (!CanUndo)
            return;

        // Step back to the previous card, undo its tally, and restore its typed answer for re-grading.
        _index--;
        if (_grades[_index] is { } prev)
        {
            ApplyTally(prev, -1);
            _grades[_index] = null;
        }
        PresentCurrent();
        // Re-present shows the front unrevealed with the restored answer; the learner reveals + re-grades.
    }

    // --- Edit + flag -------------------------------------------------------

    private void RaiseEditRequested()
    {
        if (CurrentCardId is { } id)
            EditRequested?.Invoke(id);
    }

    /// <summary>
    /// Called by the view after the card editor overlay closes: re-reads the current card's content so
    /// edits (front/back/attachments/flag) show immediately, preserving reveal + typed-answer state.
    /// </summary>
    public async Task RefreshCurrentCardAsync()
    {
        if (!IsActive || _index >= _queue.Count)
            return;
        try
        {
            var updated = await _cards.GetCardAsync(_queue[_index].Id, _lifetimeCts.Token).ConfigureAwait(true);
            if (updated is null)
                return;

            _queue = _queue.Select((c, i) => i == _index ? updated : c).ToList();
            IsFlagged = updated.IsFlagged;
            var isCloze = updated.Type == FlashcardType.Cloze;
            FrontText = isCloze ? FlashcardClozeText.Mask(updated.Front) : updated.Front;
            AnswerText = isCloze ? FlashcardClozeText.Reveal(updated.Front) : updated.Back;
            BackAttachments.Set(updated.Attachments, FlashcardAttachment.BackSide);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger?.Error("Flashcards", "Refreshing the edited test card failed.", ex);
        }
    }

    private async Task ToggleFlagAsync()
    {
        if (!IsActive || _index >= _queue.Count)
            return;
        var card = _queue[_index];
        var next = !IsFlagged;
        try
        {
            await _cards.SetFlaggedAsync(new[] { card.Id }, next, _lifetimeCts.Token).ConfigureAwait(true);
            IsFlagged = next;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger?.Error("Flashcards", "Toggling the test card flag failed.", ex);
        }
    }

    // --- Completion + score screen ----------------------------------------

    private async Task CompleteAsync()
    {
        var tested = _gotItCount + _closeCount + _missedCount;
        if (tested <= 0)
        {
            // No cards graded (empty deck should not reach here, but guard) — just leave.
            NavigateBackToDeck();
            return;
        }

        IsActive = false;
        IsRevealed = false;
        IsComplete = true;

        var completedAt = DateTimeOffset.UtcNow;
        // Canonical score (matches FlashcardTestAttempt.ScorePct's documented formula): a Close counts half.
        var scorePct = (_gotItCount + _closeCount * 0.5) / tested * 100.0;

        FinalGotIt = _gotItCount;
        FinalClose = _closeCount;
        FinalMissed = _missedCount;
        ScorePercentText = FormatPercent(scorePct);

        var attempt = new FlashcardTestAttempt(
            Guid.NewGuid().ToString("N"),
            _deckId,
            _startedAt,
            completedAt,
            tested,
            _gotItCount,
            _closeCount,
            _missedCount,
            scorePct);

        // Record the attempt FIRST so the summary/trend read includes it; the delta then compares the
        // latest (this attempt) against the previous one.
        try
        {
            if (!_attemptRecorded)
            {
                await _stats.RecordTestAttemptAsync(attempt, _lifetimeCts.Token).ConfigureAwait(true);
                _attemptRecorded = true;
            }

            var summary = await _stats.GetTestSummaryAsync(_deckId, _lifetimeCts.Token).ConfigureAwait(true);
            var trend = await _stats.GetTestTrendAsync(_deckId, 10, _lifetimeCts.Token).ConfigureAwait(true);

            ApplySummary(summary, scorePct);
            ApplyTrend(trend);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger?.Error("Flashcards", "Recording the test attempt failed.", ex);
            // Still show the score screen with the just-computed values, without the delta/best/trend.
            DeltaText = _localization.T("TestDeltaUnavailable", "Flashcards");
        }

        NotifyCommandStates();
    }

    private void ApplySummary(FlashcardTestSummary summary, double scorePct)
    {
        if (summary.DeltaVsPrevious is { } delta)
        {
            var rounded = Math.Round(delta, MidpointRounding.AwayFromZero);
            if (rounded > 0)
                DeltaText = string.Format(CultureInfo.CurrentCulture,
                    _localization.T("TestDeltaBetter", "Flashcards"), Math.Abs((int)rounded));
            else if (rounded < 0)
                DeltaText = string.Format(CultureInfo.CurrentCulture,
                    _localization.T("TestDeltaWorse", "Flashcards"), Math.Abs((int)rounded));
            else
                DeltaText = _localization.T("TestDeltaSame", "Flashcards");
        }
        else
        {
            DeltaText = _localization.T("TestDeltaFirst", "Flashcards");
        }

        HasBestScore = summary.HasAttempts;
        BestScoreText = summary.HasAttempts ? FormatPercent(summary.BestScorePct) : string.Empty;
    }

    private void ApplyTrend(IReadOnlyList<FlashcardTestAttempt> trend)
    {
        // GetTestTrendAsync returns chronological (oldest first). Render at least two points for a line.
        var scores = trend.Select(a => Math.Clamp(a.ScorePct, 0d, 100d)).ToList();
        TrendScores = scores;
        HasTrend = scores.Count >= 2;
    }

    private string FormatPercent(double pct) =>
        string.Format(CultureInfo.CurrentCulture,
            _localization.T("TestScorePercentFormat", "Flashcards"),
            (int)Math.Round(pct, MidpointRounding.AwayFromZero));

    // --- Close / back ------------------------------------------------------

    private async Task CloseAsync()
    {
        // Confirm when a session is mid-flight with real progress — abandoning discards the attempt.
        var midSession = IsActive && (_gotItCount + _closeCount + _missedCount) > 0;
        if (midSession)
        {
            var leaveLabel = _localization.T("StudyLeaveConfirm", "Flashcards");
            var cancelLabel = _localization.T("Cancel", "Common");
            var result = await _overlay.CreateDialogAsync(
                _localization.T("TestLeaveTitle", "Flashcards"),
                _localization.T("TestLeaveMessage", "Flashcards"),
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
        if (string.IsNullOrWhiteSpace(_deckId))
            _navigation.NavigateTo("flashcards");
        else
            _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(_deckId));
    }

    // --- Activity stats (labeled "test"; never touches Memory/FSRS) --------

    private async Task RecordActivityAsync()
    {
        var tested = _gotItCount + _closeCount + _missedCount;
        if (_activityRecorded || tested <= 0)
            return;
        _activityRecorded = true;

        var completedAt = DateTimeOffset.UtcNow;
        var minutes = (int)Math.Max(1, Math.Round((completedAt - _startedAt).TotalMinutes, MidpointRounding.AwayFromZero));
        await StatisticsRecorder.RecordFlashcardActivityAsync(
            _statistics, _logger, _deckId, DeckName, "test", tested, minutes, completedAt).ConfigureAwait(false);
    }

    // --- Command notify ----------------------------------------------------

    private void NotifyCommandStates()
    {
        RevealCommand.NotifyCanExecuteChanged();
        GradeMissedCommand.NotifyCanExecuteChanged();
        GradeCloseCommand.NotifyCanExecuteChanged();
        GradeGotItCommand.NotifyCanExecuteChanged();
        UndoCommand.NotifyCanExecuteChanged();
        EditCommand.NotifyCanExecuteChanged();
        FlagCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(CanUndo));
    }

    partial void OnIsActiveChanged(bool value) => NotifyCommandStates();
    partial void OnIsRevealedChanged(bool value) => NotifyCommandStates();

    partial void OnTypedAnswerChanged(string value)
    {
        if (IsActive && _index < _typedAnswers.Length)
            _typedAnswers[_index] = value;
        OnPropertyChanged(nameof(HasTypedAnswer));
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;

        // Defensive: flush the activity write if disposed before OnNavigatedFrom recorded it.
        _ = RecordActivityAsync();

        _lifetimeCts.Cancel();
        _lifetimeCts.Dispose();
    }
}
