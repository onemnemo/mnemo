using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Search;

namespace Mnemo.Infrastructure.Services.Search;

public sealed class FlashcardsSearchProvider : ISearchProvider
{
    private readonly IFlashcardCardService _flashcardCardService;
    private readonly IFlashcardLibraryService _flashcardLibraryService;

    public FlashcardsSearchProvider(IFlashcardCardService flashcardCardService, IFlashcardLibraryService flashcardLibraryService)
    {
        _flashcardCardService = flashcardCardService;
        _flashcardLibraryService = flashcardLibraryService;
    }

    public string ProviderId => "flashcards";
    public string GroupKey => "flashcards";
    public string GroupDisplayName => "Flashcards";
    public int GroupOrder => 2;

    public async Task<IReadOnlyList<SearchResultItem>> SearchAsync(SearchQuery query, CancellationToken cancellationToken)
    {
        // FTS5-ranked (bm25 -> UpdatedAt desc); suspended cards already excluded by the default scope.
        var cards = await _flashcardCardService.SearchAsync(query.Text, FlashcardSearchScope.ActiveOnly, cancellationToken)
            .ConfigureAwait(false);

        if (cards.Count == 0)
        {
            return [];
        }

        var decks = await _flashcardLibraryService.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        var deckNamesById = decks.ToDictionary(d => d.Id, d => d.Name, System.StringComparer.Ordinal);

        var results = new List<SearchResultItem>();
        var rank = cards.Count;
        foreach (var card in cards)
        {
            cancellationToken.ThrowIfCancellationRequested();

            deckNamesById.TryGetValue(card.DeckId, out var deckName);
            var preview = BuildPreview(card);
            var subtitle = string.IsNullOrWhiteSpace(deckName) ? null : $"Deck: {deckName}";

            // The service already returns results ranked (bm25 -> UpdatedAt desc); preserve that
            // order through the downstream Score-based sort/truncation instead of re-scoring.
            var score = (double)rank-- / cards.Count;

            results.Add(new SearchResultItem
            {
                Id = card.Id,
                Type = SearchResultType.Flashcard,
                ProviderId = ProviderId,
                Title = card.Front,
                Subtitle = subtitle,
                Preview = preview,
                GroupName = deckName ?? string.Empty,
                GroupId = card.DeckId,
                Score = score,
                NavigationTarget = new SearchNavigationTarget
                {
                    Route = "flashcard-deck",
                    Parameter = new FlashcardSearchNavigationParameter(card.DeckId, query.Text, card.Id),
                    Href = "flashcard-deck"
                },
                Href = "flashcard-deck",
                Flashcard = new FlashcardSearchMetadata
                {
                    DeckId = card.DeckId,
                    DeckTitle = deckName,
                    FrontText = card.Front,
                    BackText = card.Back,
                    Tags = card.Tags.ToArray()
                },
                Payload = card.Id
            });
        }

        return results;
    }

    private static string? BuildPreview(Flashcard card)
    {
        if (!string.IsNullOrWhiteSpace(card.Back))
        {
            return card.Back.Length <= 140 ? card.Back : $"{card.Back[..140]}...";
        }

        return null;
    }
}
