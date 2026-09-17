using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services.Search;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Mnemo.Infrastructure.Services.Search;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// The global search's mindmap group, over a real store so the cross-map FTS read is the one under
/// test: found by title, found by a node, one item per map, held maps left out, and an item that
/// opens the map.
/// </summary>
public sealed class MindmapSearchProviderTests
{
    [Fact]
    public async Task FindsAMapByAWordInItsTitle()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Rock cycle", Node("n1", "granite")));
        await SaveAsync(h, Doc("m2", "Water cycle", Node("n2", "rain")));

        var results = await SearchAsync(h, "rock");

        var item = Assert.Single(results);
        Assert.Equal("m1", item.Id);
        Assert.Equal(SearchResultType.Mindmap, item.Type);
        Assert.Equal("Rock cycle", item.Title);
        Assert.Null(item.Preview);
    }

    [Fact]
    public async Task FindsAMapByANodeInsideItAndPreviewsThatNode()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Geology", Node("n1", "granite"), Node("n2", "basalt")));
        await SaveAsync(h, Doc("m2", "Weather", Node("n3", "rain")));

        var results = await SearchAsync(h, "basalt");

        var item = Assert.Single(results);
        Assert.Equal("m1", item.Id);
        Assert.Equal("basalt", item.Preview);
    }

    [Fact]
    public async Task FindsANodeByTheStartOfAWord()
    {
        // The same read serves a find bar that runs on every keystroke, so "photo" has to reach
        // "photosynthesis" before the whole word is typed.
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Biology", Node("n1", "photosynthesis")));

        var results = await SearchAsync(h, "photo");

        Assert.Equal("m1", Assert.Single(results).Id);
    }

    [Fact]
    public async Task AnswersOneItemPerMapHoweverManyNodesMatched()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Geology", Node("n1", "igneous rock"), Node("n2", "sedimentary rock"), Node("n3", "metamorphic rock")));

        var results = await SearchAsync(h, "rock");

        var item = Assert.Single(results);
        Assert.Equal("m1", item.Id);
        Assert.True(item.Score > 0);
    }

    [Fact]
    public async Task FindsAMapWhoseNodesHoldTheWordsBetweenThem()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Cell biology", Node("n1", "Mitochondria"), Node("n2", "Ribosome")));

        // The other providers match any word anywhere in the item, so a map is found the same way.
        var results = await SearchAsync(h, "mitochondria ribosome");

        Assert.Equal("m1", Assert.Single(results).Id);
    }

    [Fact]
    public async Task PreviewsTheNodeThatSaysTheMostOfTheQuery()
    {
        await using var h = new MindmapTestHarness();
        // The one-word node is stored first; a preview picked by storage order would show it.
        await SaveAsync(h, Doc("m1", "Geology", Node("n1", "rock"), Node("n2", "rock cycle")));

        var results = await SearchAsync(h, "rock cycle");

        Assert.Equal("rock cycle", Assert.Single(results).Preview);
    }

    [Fact]
    public async Task AMapThatSaysTheWordEverywhereDoesNotHideTheOthers()
    {
        await using var h = new MindmapTestHarness();
        var crowded = Enumerable.Range(1, 201).Select(i => Node($"n{i}", $"cell {i}")).ToArray();
        await SaveAsync(h, Doc("m1", "Cytology", crowded));
        await SaveAsync(h, Doc("m2", "Membranes", Node("x1", "cell membrane")));

        var results = await SearchAsync(h, "cell");

        Assert.Equal(new[] { "m1", "m2" }, results.Select(item => item.Id).OrderBy(id => id));
    }

    [Fact]
    public async Task LeavesAHeldMapOut()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Rock cycle", Node("n1", "granite")));
        await SaveAsync(h, Doc("m2", "Rock types", Node("n2", "granite")));
        await h.Store.CaptureMapAsync("m1", "e1");

        var results = await SearchAsync(h, "granite");

        Assert.Equal("m2", Assert.Single(results).Id);
    }

    [Fact]
    public async Task AnItemOpensTheMap()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Rock cycle", Node("n1", "granite")));

        var item = Assert.Single(await SearchAsync(h, "rock"));

        Assert.Equal("mindmap", item.Href);
        Assert.NotNull(item.NavigationTarget);
        Assert.Equal("mindmap", item.NavigationTarget!.Route);
        Assert.Equal("m1", item.NavigationTarget.Parameter);
    }

    [Fact]
    public async Task ATitleHitOutranksANodeHit()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Volcanoes", Node("n1", "magma")));
        await SaveAsync(h, Doc("m2", "Geology", Node("n2", "volcanoes")));

        var results = (await SearchAsync(h, "volcanoes")).OrderByDescending(item => item.Score).ToList();

        Assert.Equal(2, results.Count);
        Assert.Equal("m1", results[0].Id);
    }

    private static async Task<IReadOnlyList<SearchResultItem>> SearchAsync(MindmapTestHarness h, string text)
    {
        var provider = new MindmapSearchProvider(h.Store);
        return await provider.SearchAsync(SearchQuery.Create(text), CancellationToken.None);
    }

    private static Task SaveAsync(MindmapTestHarness h, MindmapDocument document) =>
        h.Store.SaveAsync(document, new MindmapSearchDelta
        {
            FullReplace = true,
            Upserts = document.Elements
                .Select(e => new MindmapSearchEntry(e.Id, ((TextContent)e.Content).Text))
                .ToList(),
        });

    private static MindmapDocument Doc(string id, string title, params MindmapElement[] elements) =>
        new()
        {
            Id = id,
            Title = title,
            Revision = 1,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow,
            Elements = elements,
        };

    private static MindmapElement Node(string id, string text) =>
        new() { Id = id, Kind = ElementKind.Node, Content = new TextContent { Text = text } };
}
