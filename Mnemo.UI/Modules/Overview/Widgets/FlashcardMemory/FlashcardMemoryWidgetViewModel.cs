using System;
using System.Collections.Generic;
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

namespace Mnemo.UI.Modules.Overview.Widgets.FlashcardMemory;

/// <summary>
/// ViewModel for the flashcard <b>Memory</b> widget: overall true retention over a 30-day window
/// and a 14-day retention trend. Sourced exclusively from <see cref="IFlashcardStatsService"/>
/// (the append-only FSRS review log), never from Test scores or Activity effort counters, so
/// off-schedule practice can never poison the reading.
/// </summary>
/// <remarks>
/// Headline is a review-volume-weighted mean of each deck's <see cref="IFlashcardStatsService.GetTrueRetentionAsync"/>
/// across all decks with at least one review in the window; decks with zero reviews are skipped
/// entirely rather than dragging the mean toward 0. The trend line follows the single deck with
/// the highest review volume in the window (labelled with its name) rather than aggregating every
/// deck's daily trend into a weighted-per-day mean; the latter is disproportionate effort for a
/// sparkline (would require re-deriving weights per day, per deck) and the highest-volume deck is
/// the most representative single series available from the current stats surface.
/// </remarks>
public partial class FlashcardMemoryWidgetViewModel : WidgetViewModelBase
{
    private const int RetentionWindowDays = 30;
    private const int TrendWindowDays = 14;

    private readonly IWidgetContext _context;

    /// <summary>True once a load completed and found no deck with any reviews in the window.</summary>
    [ObservableProperty]
    private bool _isEmpty;

    [ObservableProperty]
    private int _retentionPercent;

    [ObservableProperty]
    private string _trendDeckName = string.Empty;

    public ObservableCollection<double> TrendValues { get; } = new();

    public FlashcardMemoryWidgetViewModel(WidgetManifest manifest, WidgetInstance instance, IWidgetContext context)
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

            var weighted = new List<(FlashcardDeckSummary Deck, int RetentionPercent, int Volume)>();
            foreach (var deck in decks)
            {
                cancellationToken.ThrowIfCancellationRequested();

                // Review volume in the window drives both the weight and the "most active deck"
                // pick for the trend line; a deck with zero reviews contributes nothing to either.
                var trend = await _context.Stats.GetRetentionTrendAsync(deck.Id, RetentionWindowDays, cancellationToken);
                var volume = trend.Sum(p => p.ReviewsCount);
                if (volume <= 0)
                    continue;

                var retention = await _context.Stats.GetTrueRetentionAsync(deck.Id, RetentionWindowDays, cancellationToken);
                weighted.Add((deck, retention, volume));
            }

            if (weighted.Count == 0)
            {
                Reset();
                return;
            }

            var totalVolume = weighted.Sum(w => w.Volume);
            var weightedSum = weighted.Sum(w => (double)w.RetentionPercent * w.Volume);
            RetentionPercent = (int)Math.Round(weightedSum / totalVolume, MidpointRounding.AwayFromZero);

            var busiest = weighted.OrderByDescending(w => w.Volume).First();
            TrendDeckName = busiest.Deck.Name;

            var trendPoints = await _context.Stats.GetRetentionTrendAsync(busiest.Deck.Id, TrendWindowDays, cancellationToken);
            TrendValues.Clear();
            foreach (var point in trendPoints)
                TrendValues.Add(point.RetentionPercent);

            IsEmpty = false;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _context.Logger.Error("Overview", "Loading flashcard memory widget failed.", ex);
            Reset();
        }
    }

    private void Reset()
    {
        RetentionPercent = 0;
        TrendDeckName = string.Empty;
        TrendValues.Clear();
        IsEmpty = true;
    }
}
