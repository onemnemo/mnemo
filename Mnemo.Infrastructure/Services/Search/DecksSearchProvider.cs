using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Search;
using Mnemo.Infrastructure.Services.Tools;

namespace Mnemo.Infrastructure.Services.Search;

public sealed class DecksSearchProvider : ISearchProvider
{
    private readonly IFlashcardLibraryService _flashcardLibraryService;

    public DecksSearchProvider(IFlashcardLibraryService flashcardLibraryService)
    {
        _flashcardLibraryService = flashcardLibraryService;
    }

    public string ProviderId => "decks";
    public string GroupKey => "decks";
    public string GroupDisplayName => "Decks";
    public int GroupOrder => 1;

    public async Task<IReadOnlyList<SearchResultItem>> SearchAsync(SearchQuery query, CancellationToken cancellationToken)
    {
        var decks = await _flashcardLibraryService.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        var results = new List<SearchResultItem>();

        foreach (var deck in decks)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var haystack = $"{deck.Name}\n{deck.Header.Description}\n{string.Join(' ', deck.Header.Tags)}";
            var titleExact = string.Equals(deck.Name, query.Text, System.StringComparison.OrdinalIgnoreCase);
            var titleStartsWith = deck.Name.StartsWith(query.Text, System.StringComparison.OrdinalIgnoreCase);
            var titleContains = deck.Name.Contains(query.Text, System.StringComparison.OrdinalIgnoreCase);

            var hasAnyMatch = titleExact || titleStartsWith || titleContains ||
                              TextSearchMatch.MatchTokens(haystack, query.Tokens, query.MatchAllTokens, query.Fuzzy);
            if (!hasAnyMatch)
            {
                continue;
            }

            var subtitle = BuildSubtitle(deck);
            var score = ComputeDeckScore(deck, query);
            var preview = string.IsNullOrWhiteSpace(deck.Header.Description) ? null : deck.Header.Description;

            results.Add(new SearchResultItem
            {
                Id = deck.Id,
                Type = SearchResultType.Deck,
                ProviderId = ProviderId,
                Title = deck.Name,
                Subtitle = subtitle,
                Preview = preview,
                GroupName = GroupDisplayName,
                GroupId = deck.Id,
                Score = score,
                NavigationTarget = new SearchNavigationTarget
                {
                    Route = "flashcard-deck",
                    Parameter = new FlashcardSearchNavigationParameter(deck.Id, query.Text),
                    Href = "flashcard-deck"
                },
                Href = "flashcard-deck",
                Payload = deck.Id
            });
        }

        return results;
    }

    private static string? BuildSubtitle(FlashcardDeckSummary deck)
    {
        var cardCount = deck.TotalCards;
        if (deck.Header.Tags.Count == 0)
        {
            return $"{cardCount} cards";
        }

        return $"{cardCount} cards - {string.Join(", ", deck.Header.Tags)}";
    }

    private static double ComputeDeckScore(FlashcardDeckSummary deck, SearchQuery query)
    {
        var score = 0d;
        var queryText = query.Text;
        if (string.Equals(deck.Name, queryText, System.StringComparison.OrdinalIgnoreCase))
        {
            score += 1.0;
        }
        else if (deck.Name.StartsWith(queryText, System.StringComparison.OrdinalIgnoreCase))
        {
            score += 0.8;
        }
        else if (deck.Name.Contains(queryText, System.StringComparison.OrdinalIgnoreCase))
        {
            score += 0.6;
        }

        if (!string.IsNullOrWhiteSpace(deck.Header.Description) &&
            deck.Header.Description.Contains(queryText, System.StringComparison.OrdinalIgnoreCase))
        {
            score += 0.2;
        }

        if (deck.Header.Tags.Any(tag => tag.Contains(queryText, System.StringComparison.OrdinalIgnoreCase)))
        {
            score += 0.15;
        }

        return System.Math.Clamp(score, 0d, 1.8d);
    }
}
