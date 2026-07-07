using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview.Widgets.RecentDecks;

/// <summary>
/// Represents a recently practiced deck, joined from per-deck stats summary and live deck metadata.
/// </summary>
public partial class RecentDeckItem : ObservableObject
{
    [ObservableProperty]
    private string _deckId = string.Empty;

    [ObservableProperty]
    private string _name = string.Empty;

    /// <summary>Subject and card count on one line ("Biology • 63 cards"); subject omitted when the deck has no tags.</summary>
    [ObservableProperty]
    private string _metaText = string.Empty;

    [ObservableProperty]
    private string _lastPracticedText = "—";
}

/// <summary>
/// ViewModel for the Recent Decks widget. Settings: <c>days_to_show</c> window over the
/// last-practiced date, <c>sort_by</c> ("date" = last practiced, "study_count" = total cards
/// reviewed in the deck), and <c>limit</c>.
/// </summary>
public partial class RecentDecksWidgetViewModel : WidgetViewModelBase
{
    private readonly IWidgetContext _context;

    public ObservableCollection<RecentDeckItem> RecentDecks { get; } = new();

    /// <summary>True after a load that produced no rows; drives the widget's empty message.</summary>
    [ObservableProperty]
    private bool _isEmpty;

    public RecentDecksWidgetViewModel(WidgetManifest manifest, WidgetInstance instance, IWidgetContext context)
        : base(manifest, instance)
    {
        _context = context;
    }

    public override async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var daysToShow = GetIntSetting("days_to_show");
            var sortBy = GetStringSetting("sort_by");
            var limit = GetIntSetting("limit");
            var cutoffUtc = DateTime.UtcNow.AddDays(-daysToShow);

            var summaries = await _context.Statistics.QueryAsync(new StatisticsQuery
            {
                Namespace = StatisticsNamespaces.Flashcards,
                Kind = FlashcardStatKinds.DeckSummary,
                Limit = 64,
                OrderByUpdatedDescending = true
            }, cancellationToken);

            RecentDecks.Clear();
            if (!summaries.IsSuccess || summaries.Value == null || summaries.Value.Count == 0)
            {
                IsEmpty = true;
                return;
            }

            var allDecks = (await _context.Decks.ListDecksAsync(cancellationToken))
                .ToDictionary(d => d.Id, StringComparer.Ordinal);

            var candidates = new List<(FlashcardDeckSummary Deck, DateTime LastPracticed, long TotalReviewed)>();
            foreach (var record in summaries.Value)
            {
                var deckId = record.Key.StartsWith("deck:", StringComparison.Ordinal)
                    ? record.Key["deck:".Length..]
                    : record.Key;

                if (!allDecks.TryGetValue(deckId, out var deck))
                    continue;

                var lastPracticed = ReadDateTime(record, "last_practiced") ?? deck.Header.LastStudied?.UtcDateTime ?? default;
                if (lastPracticed == default || lastPracticed < cutoffUtc)
                    continue;

                candidates.Add((deck, lastPracticed, ReadInt(record, "total_reviewed")));
            }

            var ordered = string.Equals(sortBy, "study_count", StringComparison.Ordinal)
                ? candidates.OrderByDescending(c => c.TotalReviewed).ThenByDescending(c => c.LastPracticed)
                : candidates.OrderByDescending(c => c.LastPracticed);

            foreach (var (deck, lastPracticed, _) in ordered.Take(limit))
            {
                var subject = deck.Header.Tags?.Count > 0 ? deck.Header.Tags[0] : string.Empty;
                var cardsLine = $"{deck.TotalCards} {_context.Localization.T("cards", "Overview")}";

                RecentDecks.Add(new RecentDeckItem
                {
                    DeckId = deck.Id,
                    Name = deck.Name,
                    MetaText = string.IsNullOrWhiteSpace(subject) ? cardsLine : $"{subject} • {cardsLine}",
                    LastPracticedText = _context.DateDisplay.FormatSmart(lastPracticed)
                });
            }

            IsEmpty = RecentDecks.Count == 0;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _context.Logger.Error("Overview", "Loading recent decks widget failed.", ex);
            RecentDecks.Clear();
            IsEmpty = true;
        }
    }

    [RelayCommand]
    private void OpenDeck(string? deckId)
    {
        if (IsEditing || string.IsNullOrWhiteSpace(deckId))
            return;
        _context.Navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(deckId.Trim()));
    }

    private static DateTime? ReadDateTime(StatisticsRecord record, string field)
    {
        if (!record.Fields.TryGetValue(field, out var v)) return null;
        if (v.Type != StatValueType.DateTime) return null;
        return v.AsDateTime().UtcDateTime;
    }

    private static long ReadInt(StatisticsRecord record, string field)
    {
        return record.Fields.TryGetValue(field, out var v) && v.Type == StatValueType.Integer
            ? v.AsInt()
            : 0L;
    }
}
