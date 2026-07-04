using System;
using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Statistics;
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
/// ViewModel for the Recent Decks widget.
/// </summary>
public partial class RecentDecksWidgetViewModel : WidgetViewModelBase
{
    private const int MaxItems = 6;

    private readonly IStatisticsManager _statistics;
    private readonly IFlashcardDeckService _decks;
    private readonly INavigationService _navigation;
    private readonly ILoggerService _logger;
    private readonly ILocalizationService _localization;
    private readonly IDateDisplayService _dateDisplay;

    public RecentDecksWidgetViewModel(
        IStatisticsManager statistics,
        IFlashcardDeckService decks,
        INavigationService navigation,
        ILoggerService logger,
        ILocalizationService localization,
        IDateDisplayService dateDisplay)
    {
        _statistics = statistics;
        _decks = decks;
        _navigation = navigation;
        _logger = logger;
        _localization = localization;
        _dateDisplay = dateDisplay;
    }

    [RelayCommand]
    private void OpenDeck(string? deckId)
    {
        if (string.IsNullOrWhiteSpace(deckId))
            return;
        _navigation.NavigateTo("flashcard-deck", new FlashcardDeckNavigationParameter(deckId.Trim()));
    }

    public ObservableCollection<RecentDeckItem> RecentDecks { get; } = new();

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();
        RecentDecks.Clear();

        try
        {
            var summaries = await _statistics.QueryAsync(new StatisticsQuery
            {
                Namespace = StatisticsNamespaces.Flashcards,
                Kind = FlashcardStatKinds.DeckSummary,
                Limit = 32,
                OrderByUpdatedDescending = true
            }).ConfigureAwait(false);

            if (!summaries.IsSuccess || summaries.Value == null || summaries.Value.Count == 0)
                return;

            var allDecks = (await _decks.ListDecksAsync().ConfigureAwait(false))
                .ToDictionary(d => d.Id, StringComparer.Ordinal);

            var added = 0;
            foreach (var record in summaries.Value)
            {
                if (added >= MaxItems) break;

                var deckId = record.Key.StartsWith("deck:", StringComparison.Ordinal)
                    ? record.Key["deck:".Length..]
                    : record.Key;

                if (!allDecks.TryGetValue(deckId, out var deck))
                    continue;

                var lastPracticed = ReadDateTime(record, "last_practiced") ?? deck.LastStudied?.UtcDateTime ?? default;
                var subject = deck.Tags?.Count > 0 ? deck.Tags[0] : string.Empty;
                var cardsLine = $"{deck.Cards?.Count ?? 0} {_localization.T("cards", "Overview")}";

                RecentDecks.Add(new RecentDeckItem
                {
                    DeckId = deckId,
                    Name = deck.Name,
                    MetaText = string.IsNullOrWhiteSpace(subject) ? cardsLine : $"{subject} • {cardsLine}",
                    LastPracticedText = lastPracticed == default ? "—" : _dateDisplay.FormatSmart(lastPracticed)
                });
                added++;
            }
        }
        catch (Exception ex)
        {
            _logger?.Error("Overview", "Loading recent decks widget failed.", ex);
        }
    }

    private static DateTime? ReadDateTime(StatisticsRecord record, string field)
    {
        if (!record.Fields.TryGetValue(field, out var v)) return null;
        if (v.Type != StatValueType.DateTime) return null;
        return v.AsDateTime().UtcDateTime;
    }
}
