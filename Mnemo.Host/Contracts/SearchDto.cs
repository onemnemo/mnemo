using Mnemo.Core.Services.Search;

namespace Mnemo.Host.Contracts;

/// <summary>
/// <see cref="SearchResultType"/> as a lowercase wire token, the same convention
/// <see cref="FlashcardWire"/> uses for flashcard enums.
/// </summary>
public static class SearchWire
{
    public static string ResultType(SearchResultType value) => value switch
    {
        SearchResultType.Deck => "deck",
        SearchResultType.Flashcard => "flashcard",
        SearchResultType.Note => "note",
        SearchResultType.Mindmap => "mindmap",
        SearchResultType.Setting => "setting",
        SearchResultType.Navigation => "navigation",
        SearchResultType.DeckCardSummary => "deck-card-summary",
        _ => "unknown",
    };
}

/// <summary>
/// A card's deck context on a flashcard search hit, for rendering and for building the
/// deck-view href the client navigates to.
/// </summary>
public sealed record SearchFlashcardMetadataDto(
    string? DeckId,
    string? DeckTitle,
    string? FrontText,
    string? BackText,
    IReadOnlyList<string> Tags)
{
    public static SearchFlashcardMetadataDto FromModel(FlashcardSearchMetadata model) =>
        new(model.DeckId, model.DeckTitle, model.FrontText, model.BackText, model.Tags);
}

/// <summary>
/// One search hit. The desktop shell's in-process <c>NavigationTarget.Parameter</c> and
/// <c>Payload</c> do not cross the wire: every provider's navigation need is already carried by
/// a serializable field. A client builds the target from <see cref="Type"/>:
/// deck and note and setting hits navigate on <see cref="Id"/> (it is the deck id, note id, or
/// settings key); flashcard hits navigate on <see cref="Flashcard"/>'s <c>DeckId</c>, opening the
/// card at <see cref="Id"/> within it; deck-card-summary (topic cluster) hits navigate on
/// <see cref="GroupId"/>, which carries the cluster's dominant deck id; navigation hits go
/// straight to <see cref="Href"/>.
/// </summary>
public sealed record SearchResultItemDto(
    string Id,
    string Type,
    string ProviderId,
    string Title,
    string? Subtitle,
    string? Preview,
    string GroupName,
    string? GroupId,
    double Score,
    string? Href,
    SearchFlashcardMetadataDto? Flashcard)
{
    public static SearchResultItemDto FromModel(SearchResultItem model) => new(
        model.Id,
        SearchWire.ResultType(model.Type),
        model.ProviderId,
        model.Title,
        model.Subtitle,
        model.Preview,
        model.GroupName,
        model.GroupId,
        model.Score,
        model.Href,
        model.Flashcard is { } metadata ? SearchFlashcardMetadataDto.FromModel(metadata) : null);
}

/// <summary>
/// One provider's results. <see cref="HasMore"/> mirrors the model's computed property: true
/// when the provider matched more rows than fit in this group's limit.
/// </summary>
public sealed record SearchResultGroupDto(
    string GroupKey,
    string GroupDisplayName,
    int GroupOrder,
    string ResultType,
    IReadOnlyList<SearchResultItemDto> Items,
    int TotalMatched,
    bool HasMore)
{
    public static SearchResultGroupDto FromModel(SearchResultGroup model) => new(
        model.GroupKey,
        model.GroupDisplayName,
        model.GroupOrder,
        SearchWire.ResultType(model.ResultType),
        model.Items.Select(SearchResultItemDto.FromModel).ToList(),
        model.TotalMatched,
        model.HasMore);
}

/// <summary>The global search palette's response: a flat best-matches list plus the full groups it was drawn from.</summary>
public sealed record GlobalSearchResponseDto(
    IReadOnlyList<SearchResultItemDto> BestMatches,
    IReadOnlyList<SearchResultGroupDto> Groups)
{
    public static readonly GlobalSearchResponseDto Empty = new([], []);

    public static GlobalSearchResponseDto FromModel(GlobalSearchResponse model) => new(
        model.BestMatches.Select(SearchResultItemDto.FromModel).ToList(),
        model.Groups.Select(SearchResultGroupDto.FromModel).ToList());
}
