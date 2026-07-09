using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapChangeAndFindTests
{
    private static async Task<(MindmapDocument Map, IReadOnlyDictionary<string, string> Ids)> SeedAsync(
        MindmapTestHarness h, params MindmapNodeSpec[] specs)
    {
        var map = (await h.Service.CreateAsync("M")).Value!;
        var result = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = specs },
        })).Value!;
        return (map, result.CreatedIds);
    }

    // ---------------------------------------------------------------- find

    [Fact]
    public async Task Find_AssemblesAncestorPath()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "r",
            Text = "Root",
            Children = new List<MindmapNodeSpec>
            {
                new() { Ref = "p", Text = "Parent", Children = new List<MindmapNodeSpec> { new() { Ref = "leaf", Text = "Leaf" } } },
            },
        });

        var result = await h.Service.FindInMapAsync(map.Id, "Leaf", 10);

        Assert.True(result.IsSuccess);
        var hit = Assert.Single(result.Value!.Hits);
        Assert.Equal(ids["leaf"], hit.ElementId);
        Assert.Equal("Root > Parent", hit.Path);
        Assert.Equal(2, result.Value.Revision);
    }

    [Fact]
    public async Task Find_RootNode_HasEmptyPath()
    {
        await using var h = new MindmapTestHarness();
        var (map, _) = await SeedAsync(h, new MindmapNodeSpec { Ref = "r", Text = "solo" });

        var hit = Assert.Single((await h.Service.FindInMapAsync(map.Id, "solo", 10)).Value!.Hits);
        Assert.Equal(string.Empty, hit.Path);
    }

    [Fact]
    public async Task Find_EmptyQuery_ReturnsRevisionWithNoHits()
    {
        await using var h = new MindmapTestHarness();
        var (map, _) = await SeedAsync(h, new MindmapNodeSpec { Ref = "r", Text = "text" });

        var result = await h.Service.FindInMapAsync(map.Id, "   ", 10);

        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value!.Hits);
        Assert.Equal(2, result.Value.Revision);
    }

    [Fact]
    public async Task Find_UnknownMap_Fails()
    {
        await using var h = new MindmapTestHarness();
        var result = await h.Service.FindInMapAsync("nope", "x", 10);
        Assert.False(result.IsSuccess);
    }

    // ---------------------------------------------------------------- change event

    [Fact]
    public async Task Changed_FiresWithKindAndRevision_ForEachMutation()
    {
        await using var h = new MindmapTestHarness();
        var events = new List<MindmapChangedEventArgs>();
        h.Service.Changed += (_, e) => events.Add(e);

        var map = (await h.Service.CreateAsync("M")).Value!;
        Assert.Contains(events, e => e.MapId == map.Id && e.Kind == MindmapChangeKind.Created && e.Revision == 1);

        await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new List<MindmapNodeSpec> { new() { Text = "n" } } },
        });
        Assert.Contains(events, e => e.Kind == MindmapChangeKind.Edited && e.Revision == 2);

        await h.Service.RenameAsync(map.Id, "M2");
        Assert.Contains(events, e => e.Kind == MindmapChangeKind.Renamed && e.Revision == 3);

        await h.Service.DeleteAsync(map.Id);
        Assert.Contains(events, e => e.Kind == MindmapChangeKind.Deleted && e.MapId == map.Id && e.Revision == 3);
    }

    [Fact]
    public async Task Changed_DoesNotFire_OnFailedApply()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var events = new List<MindmapChangedEventArgs>();
        h.Service.Changed += (_, e) => events.Add(e);

        var result = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new SetOp { Id = "zzzz", Text = "x" },
        })).Value!;

        Assert.False(result.Success);
        Assert.Empty(events);
    }

    [Fact]
    public async Task Changed_ThrowingHandler_DoesNotFailTheCommit()
    {
        await using var h = new MindmapTestHarness();
        h.Service.Changed += (_, _) => throw new System.InvalidOperationException("boom");

        // The create must still succeed and persist despite a throwing subscriber.
        var created = await h.Service.CreateAsync("M");
        Assert.True(created.IsSuccess);
        Assert.NotNull((await h.Service.GetAsync(created.Value!.Id)).Value);
    }

    // ---------------------------------------------------------------- suggestions

    [Fact]
    public async Task Apply_NotFound_SuggestsNearbyId()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "hello" });
        var typo = ids["n"][..^1] + (ids["n"][^1] == 'a' ? 'b' : 'a');

        var result = (await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new SetOp { Id = typo, Text = "x" },
        })).Value!;

        Assert.Equal(MindmapEditErrorCode.NotFound, result.Error!.Code);
        Assert.NotNull(result.Error.Suggestions);
        Assert.Contains(result.Error.Suggestions!, s => s.StartsWith(ids["n"]));
    }

    [Fact]
    public void Suggestions_OnlyNearby_CappedAtThree_WithText()
    {
        var elements = new[]
        {
            Node("ab13", "alpha"),
            Node("ab14", "beta"),
            Node("ab15", "gamma"),
            Node("ab16", "delta"),
            Node("zzzz", "unrelated"),
        };

        var suggestions = MindmapSuggestions.NearestElementIds(elements, "ab12");

        Assert.NotNull(suggestions);
        Assert.Equal(3, suggestions!.Count);                                  // capped
        Assert.DoesNotContain(suggestions, s => s.StartsWith("zzzz"));        // far id excluded (distance > 2)
        Assert.Contains(suggestions, s => s.Contains(": "));                  // "{id}: {text}" format
    }

    [Fact]
    public void Suggestions_NothingClose_ReturnsNull()
    {
        var elements = new[] { Node("wxyz", "far") };
        Assert.Null(MindmapSuggestions.NearestElementIds(elements, "ab12"));
    }

    private static MindmapElement Node(string id, string text) =>
        new() { Id = id, Kind = ElementKind.Node, Content = new TextContent { Text = text } };
}
