using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services.Search;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// The command-palette global search, fanned out across every registered
/// <see cref="ISearchProvider"/> (decks, flashcards, notes, settings, navigation) by
/// <see cref="IGlobalSearchService"/>. One HTTP surface for a search architecture that already
/// exists; this maps it rather than building a second one.
/// </summary>
public static class SearchEndpoints
{
    private const int DefaultLimitPerGroup = 10;
    private const int MaxLimitPerGroup = 50;

    public static void MapSearch(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/search", async (
            string? q,
            int? limit,
            IGlobalSearchService search,
            CancellationToken cancellationToken) =>
        {
            var text = q?.Trim() ?? string.Empty;
            if (text.Length == 0)
                return GlobalSearchResponseDto.Empty;

            var query = SearchQuery.Create(text, Math.Clamp(limit ?? DefaultLimitPerGroup, 1, MaxLimitPerGroup));
            var response = await search.SearchAsync(query, cancellationToken).ConfigureAwait(false);
            return GlobalSearchResponseDto.FromModel(response);
        });
    }
}
