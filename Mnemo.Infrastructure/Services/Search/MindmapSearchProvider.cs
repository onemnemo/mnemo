using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Services.Search;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Mnemo.Infrastructure.Services.Tools;

namespace Mnemo.Infrastructure.Services.Search;

/// <summary>
/// Maps in the global search: one hit per map, matched on its title the way the notes provider
/// matches a note and on its node text through the FTS mirror, so a map is found by what is written
/// inside it without a single document being deserialized. A hit opens the map.
/// </summary>
public sealed class MindmapSearchProvider : ISearchProvider
{
    /// <summary>
    /// How many maps the mirror is asked for, one node each. Generous because a common word can
    /// match a node on most maps of a large library, and every map that says it is an item.
    /// </summary>
    private const int MapHitLimit = 200;

    private const int PreviewLength = 120;

    private readonly IMindmapStore _store;

    public MindmapSearchProvider(IMindmapStore store)
    {
        _store = store;
    }

    public string ProviderId => "mindmaps";
    public string GroupKey => "mindmaps";
    public string GroupDisplayName => "Mindmaps";
    public int GroupOrder => 4;

    public async Task<IReadOnlyList<SearchResultItem>> SearchAsync(SearchQuery query, CancellationToken cancellationToken)
    {
        var maps = await _store.ListAsync(cancellationToken).ConfigureAwait(false);
        var nodeHits = await _store.SearchAllAsync(query.Text, MapHitLimit, cancellationToken).ConfigureAwait(false);
        var hitsByMap = nodeHits
            .GroupBy(hit => hit.MapId)
            .ToDictionary(group => group.Key, group => group.Select(hit => hit.Text).ToList());

        var results = new List<SearchResultItem>();
        foreach (var map in maps)
        {
            cancellationToken.ThrowIfCancellationRequested();

            hitsByMap.TryGetValue(map.Id, out var hits);
            var titleMatches = TextSearchMatch.MatchTokens(map.Title, query.Tokens, query.MatchAllTokens, query.Fuzzy);
            if (!titleMatches && hits is null)
            {
                continue;
            }

            var body = hits is null ? null : string.Join('\n', hits);
            var score = SimpleSearchScorer.Compute(map.Title, null, body, query.Tokens, query.Fuzzy, query.MatchAllTokens);

            results.Add(new SearchResultItem
            {
                Id = map.Id,
                Type = SearchResultType.Mindmap,
                ProviderId = ProviderId,
                Title = map.Title,
                Preview = Preview(hits),
                GroupName = GroupDisplayName,
                Score = score,
                NavigationTarget = new SearchNavigationTarget
                {
                    Route = "mindmap",
                    Parameter = map.Id,
                    Href = "mindmap"
                },
                Href = "mindmap",
                Payload = map.Id
            });
        }

        return results;
    }

    /// <summary>The first node that matched, which is what tells a title-only list apart from a map that says it.</summary>
    private static string? Preview(IReadOnlyList<string>? hits)
    {
        var text = hits?.FirstOrDefault(hit => !string.IsNullOrWhiteSpace(hit))?.Trim();
        if (text is null)
        {
            return null;
        }

        return text.Length <= PreviewLength ? text : $"{text[..PreviewLength]}...";
    }
}
