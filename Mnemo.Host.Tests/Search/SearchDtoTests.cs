using Mnemo.Core.Services.Search;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Tests.Search;

/// <summary>
/// The global search response as it crosses the wire. <see cref="SearchResultItem.NavigationTarget"/>
/// carries an <c>object? Parameter</c> the desktop shell hands straight to its in-process
/// navigation, which does not survive JSON. This is the contract that every provider's navigation
/// need still reaches the client through a plain field instead: <c>Id</c> for deck, note and
/// setting hits; <see cref="SearchFlashcardMetadataDto.DeckId"/> for flashcard hits; <c>GroupId</c>
/// for the deck-card-summary topic clusters <c>GlobalSearchService</c> synthesizes; <c>Href</c> for
/// navigation hits.
/// </summary>
public sealed class SearchDtoTests
{
    [Fact]
    public void FlashcardHit_CarriesItsDeckThroughMetadata_NotThroughNavigationTarget()
    {
        var model = new SearchResultItem
        {
            Id = "card-1",
            Type = SearchResultType.Flashcard,
            ProviderId = "flashcards",
            Title = "Amiodarone",
            Score = 0.9,
            Href = "flashcard-deck",
            Flashcard = new FlashcardSearchMetadata { DeckId = "deck-1", DeckTitle = "Pharmacology", FrontText = "Amiodarone", Tags = ["cardio"] },
            NavigationTarget = new SearchNavigationTarget { Route = "flashcard-deck", Href = "flashcard-deck", Parameter = new { Ignored = true } },
        };

        var dto = SearchResultItemDto.FromModel(model);

        Assert.Equal("card-1", dto.Id);
        Assert.Equal("flashcard", dto.Type);
        Assert.NotNull(dto.Flashcard);
        Assert.Equal("deck-1", dto.Flashcard!.DeckId);
        Assert.Equal("flashcard-deck", dto.Href);
    }

    [Fact]
    public void DeckHit_NavigatesOnItsOwnId()
    {
        var model = new SearchResultItem
        {
            Id = "deck-42",
            Type = SearchResultType.Deck,
            ProviderId = "decks",
            Title = "Pharmacology",
            Href = "flashcard-deck",
        };

        var dto = SearchResultItemDto.FromModel(model);

        Assert.Equal("deck", dto.Type);
        Assert.Equal("deck-42", dto.Id);
        Assert.Null(dto.Flashcard);
    }

    [Fact]
    public void TopicClusterHit_CarriesItsDominantDeckThroughGroupId()
    {
        // GlobalSearchService synthesizes these across decks: the id is a cluster key, not
        // anything navigable, and only GroupId names the deck the client opens.
        var model = new SearchResultItem
        {
            Id = "cluster:amiodarone",
            Type = SearchResultType.DeckCardSummary,
            ProviderId = "topic-clusters",
            Title = "Amiodarone",
            GroupId = "deck-1",
            Href = "flashcard-deck",
        };

        var dto = SearchResultItemDto.FromModel(model);

        Assert.Equal("deck-card-summary", dto.Type);
        Assert.Equal("deck-1", dto.GroupId);
    }

    [Fact]
    public void NavigationHit_HasNoIdBeyondItsHref()
    {
        var model = new SearchResultItem
        {
            Id = "nav:settings",
            Type = SearchResultType.Navigation,
            ProviderId = "navigation",
            Title = "Navigate to Settings",
            Href = "settings",
        };

        var dto = SearchResultItemDto.FromModel(model);

        Assert.Equal("navigation", dto.Type);
        Assert.Equal("settings", dto.Href);
    }

    [Fact]
    public void GroupDto_ComputesHasMoreFromTotalMatchedVsItemCount()
    {
        var shown = new SearchResultItem { Id = "a", ProviderId = "notes", Title = "A" };
        var model = new SearchResultGroup
        {
            GroupKey = "notes",
            GroupDisplayName = "Notes",
            GroupOrder = 3,
            ResultType = SearchResultType.Note,
            Items = [shown],
            TotalMatched = 5,
        };

        var dto = SearchResultGroupDto.FromModel(model);

        Assert.True(dto.HasMore);
        Assert.Equal(5, dto.TotalMatched);
        Assert.Single(dto.Items);
    }

    [Fact]
    public void GroupDto_ReportsNoMore_WhenEveryMatchIsShown()
    {
        var model = new SearchResultGroup
        {
            GroupKey = "settings",
            GroupDisplayName = "Settings",
            GroupOrder = 5,
            ResultType = SearchResultType.Setting,
            Items = [],
            TotalMatched = 0,
        };

        Assert.False(SearchResultGroupDto.FromModel(model).HasMore);
    }

    [Fact]
    public void ResponseDto_FlattensBestMatchesAndGroupsIndependently()
    {
        var item = new SearchResultItem { Id = "a", ProviderId = "notes", Title = "A" };
        var model = new GlobalSearchResponse
        {
            BestMatches = [item],
            Groups =
            [
                new SearchResultGroup
                {
                    GroupKey = "notes",
                    GroupDisplayName = "Notes",
                    GroupOrder = 3,
                    ResultType = SearchResultType.Note,
                    Items = [item],
                    TotalMatched = 1,
                },
            ],
        };

        var dto = GlobalSearchResponseDto.FromModel(model);

        Assert.Single(dto.BestMatches);
        Assert.Single(dto.Groups);
        Assert.Equal("a", dto.BestMatches[0].Id);
    }
}
