using System;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview.Widgets.FlashcardTests;

/// <summary>
/// Which direction the latest score moved relative to the previous attempt; drives the delta
/// glyph/color (up = green, down = red, none = first attempt for the deck).
/// </summary>
public enum TestScoreTrend
{
    None,
    Up,
    Down
}

/// <summary>
/// ViewModel for the flashcard <b>Test</b> widget: the most recently tested deck's latest score,
/// delta vs. the previous attempt, best score, and a sparkline of the last 10 attempts. Sourced
/// exclusively from <see cref="IFlashcardStatsService"/>'s Test bucket. Test never touches
/// FSRS/retention, so this widget never mixes with the Memory or Activity buckets.
/// </summary>
public partial class FlashcardTestsWidgetViewModel : WidgetViewModelBase
{
    private const int TrendAttempts = 10;

    private readonly IWidgetContext _context;

    [ObservableProperty]
    private bool _isEmpty;

    [ObservableProperty]
    private string _deckName = string.Empty;

    [ObservableProperty]
    private int _latestScorePercent;

    [ObservableProperty]
    private int _bestScorePercent;

    [ObservableProperty]
    private string _bestScoreDisplay = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsTrendUp))]
    [NotifyPropertyChangedFor(nameof(IsTrendDown))]
    [NotifyPropertyChangedFor(nameof(IsTrendNone))]
    private TestScoreTrend _trend;

    /// <summary>Absolute delta vs. the previous attempt, in percentage points (0 when <see cref="Trend"/> is None).</summary>
    [ObservableProperty]
    private int _deltaPercent;

    /// <summary>True when the latest score improved on the previous attempt (▲ green).</summary>
    public bool IsTrendUp => Trend == TestScoreTrend.Up;

    /// <summary>True when the latest score dropped from the previous attempt (▼ red).</summary>
    public bool IsTrendDown => Trend == TestScoreTrend.Down;

    /// <summary>True when this is the deck's first attempt, or the score is unchanged (flat, no arrow).</summary>
    public bool IsTrendNone => Trend == TestScoreTrend.None;

    public ObservableCollection<double> TrendValues { get; } = new();

    public FlashcardTestsWidgetViewModel(WidgetManifest manifest, WidgetInstance instance, IWidgetContext context)
        : base(manifest, instance)
    {
        _context = context;
    }

    public override async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var decks = await _context.Decks.ListDecksAsync(cancellationToken);
            if (decks.Count == 0)
            {
                Reset();
                return;
            }

            FlashcardDeckSummary? latestDeck = null;
            FlashcardTestSummary? latestSummary = null;

            foreach (var deck in decks)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var summary = await _context.Stats.GetTestSummaryAsync(deck.Id, cancellationToken);
                if (!summary.HasAttempts || summary.Latest == null)
                    continue;

                if (latestSummary == null || summary.Latest.CompletedAt > latestSummary.Latest!.CompletedAt)
                {
                    latestDeck = deck;
                    latestSummary = summary;
                }
            }

            if (latestDeck == null || latestSummary == null)
            {
                Reset();
                return;
            }

            DeckName = latestDeck.Name;
            LatestScorePercent = (int)Math.Round(latestSummary.LatestScorePct, MidpointRounding.AwayFromZero);
            BestScorePercent = (int)Math.Round(latestSummary.BestScorePct, MidpointRounding.AwayFromZero);
            BestScoreDisplay = string.Format(
                CultureInfo.CurrentCulture,
                _context.Localization.T("BestScoreFormat", "FlashcardTests"),
                BestScorePercent);

            var delta = latestSummary.DeltaVsPrevious;
            if (delta is null)
            {
                Trend = TestScoreTrend.None;
                DeltaPercent = 0;
            }
            else
            {
                var rounded = (int)Math.Round(delta.Value, MidpointRounding.AwayFromZero);
                Trend = rounded switch
                {
                    > 0 => TestScoreTrend.Up,
                    < 0 => TestScoreTrend.Down,
                    _ => TestScoreTrend.None
                };
                DeltaPercent = Math.Abs(rounded);
            }

            var trendAttempts = await _context.Stats.GetTestTrendAsync(latestDeck.Id, TrendAttempts, cancellationToken);
            TrendValues.Clear();
            foreach (var attempt in trendAttempts)
                TrendValues.Add(attempt.ScorePct);

            IsEmpty = false;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _context.Logger.Error("Overview", "Loading flashcard tests widget failed.", ex);
            Reset();
        }
    }

    private void Reset()
    {
        DeckName = string.Empty;
        LatestScorePercent = 0;
        BestScorePercent = 0;
        BestScoreDisplay = string.Empty;
        Trend = TestScoreTrend.None;
        DeltaPercent = 0;
        TrendValues.Clear();
        IsEmpty = true;
    }
}
