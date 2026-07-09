using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Tools;
using Mnemo.Infrastructure.Services.Mindmap.Tools;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapToolServiceTests
{
    private static JsonElement Ops(string json) => JsonDocument.Parse(json).RootElement;

    private static JsonElement Data(ToolInvocationResult result) => JsonSerializer.SerializeToElement(result.Data);

    /// <summary>Creates a map and applies one floating add of the given specs (leaving the map at revision 2).</summary>
    private static async Task<(MindmapToolService Svc, string MapId, IReadOnlyDictionary<string, string> Ids)> SeedAsync(
        MindmapTestHarness h, params MindmapNodeSpec[] specs)
    {
        var svc = new MindmapToolService(h.Service);
        var map = (await h.Service.CreateAsync("M")).Value!;
        var result = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = specs },
        })).Value!;
        return (svc, map.Id, result.CreatedIds);
    }

    // ---------------------------------------------------------------- create

    [Fact]
    public async Task Create_WithOutline_ReportsNodeCountAndRev()
    {
        await using var h = new MindmapTestHarness();
        var svc = new MindmapToolService(h.Service);

        var result = await svc.CreateMindmapAsync(new CreateMindmapParameters
        {
            Title = "Plants",
            Outline = new List<MindmapOutlineNode>
            {
                new() { Text = "Root", Children = new List<MindmapOutlineNode> { new() { Text = "A" }, new() { Text = "B" } } },
            },
        });

        Assert.True(result.Ok);
        var data = Data(result);
        Assert.Equal(3, data.GetProperty("node_count").GetInt32());
        Assert.Equal(1, data.GetProperty("rev").GetInt64());
        Assert.False(string.IsNullOrEmpty(data.GetProperty("id").GetString()));
    }

    [Fact]
    public async Task Create_WithoutOutline_HasNoNodes()
    {
        await using var h = new MindmapTestHarness();
        var svc = new MindmapToolService(h.Service);

        var result = await svc.CreateMindmapAsync(new CreateMindmapParameters { Title = "Empty" });

        Assert.True(result.Ok);
        Assert.Equal(0, Data(result).GetProperty("node_count").GetInt32());
    }

    [Fact]
    public async Task Create_MissingTitle_ValidationError()
    {
        await using var h = new MindmapTestHarness();
        var svc = new MindmapToolService(h.Service);

        var result = await svc.CreateMindmapAsync(new CreateMindmapParameters { Title = "  " });

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.ValidationError, result.Code);
    }

    // ---------------------------------------------------------------- outline

    [Fact]
    public async Task Outline_DepthCut_ReportsHiddenCount()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, _) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "r",
            Text = "R",
            Children = new List<MindmapNodeSpec>
            {
                new() { Ref = "a", Text = "A", Children = new List<MindmapNodeSpec> { new() { Ref = "a1", Text = "A1" } } },
            },
        });

        var depth1 = Data(await svc.OutlineMindmapAsync(new OutlineMindmapParameters { MapId = mapId, Depth = 1 }));
        var root = depth1.GetProperty("roots")[0];
        Assert.Equal("R", root.GetProperty("t").GetString());
        Assert.Equal(2, root.GetProperty("+n").GetInt32());   // A and A1 hidden
        Assert.False(root.TryGetProperty("c", out _));

        var depth2 = Data(await svc.OutlineMindmapAsync(new OutlineMindmapParameters { MapId = mapId, Depth = 2 }));
        var child = depth2.GetProperty("roots")[0].GetProperty("c")[0];
        Assert.Equal("A", child.GetProperty("t").GetString());
        Assert.Equal(1, child.GetProperty("+n").GetInt32());  // A1 hidden
    }

    [Fact]
    public async Task Outline_CollapsedNode_ReportsHiddenCount()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "r",
            Text = "R",
            Children = new List<MindmapNodeSpec>
            {
                new() { Ref = "a", Text = "A", Children = new List<MindmapNodeSpec> { new() { Ref = "a1", Text = "A1" } } },
            },
        });

        await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[] { new SetOp { Id = ids["a"], Collapsed = true } });

        var data = Data(await svc.OutlineMindmapAsync(new OutlineMindmapParameters { MapId = mapId }));
        var childA = data.GetProperty("roots")[0].GetProperty("c")[0];
        Assert.Equal(1, childA.GetProperty("+n").GetInt32());
        Assert.False(childA.TryGetProperty("c", out _));
    }

    [Fact]
    public async Task Outline_SubtreeOf_ScopesToNode()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "r",
            Text = "R",
            Children = new List<MindmapNodeSpec> { new() { Ref = "a", Text = "A" }, new() { Ref = "b", Text = "B" } },
        });

        var data = Data(await svc.OutlineMindmapAsync(new OutlineMindmapParameters { MapId = mapId, SubtreeOf = ids["a"] }));
        var roots = data.GetProperty("roots");
        Assert.Equal(1, roots.GetArrayLength());
        Assert.Equal("A", roots[0].GetProperty("t").GetString());
    }

    [Fact]
    public async Task Outline_UnknownSubtreeOf_NotFoundWithSuggestions()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "hello" });
        var typo = Mutate(ids["n"]);

        var result = await svc.OutlineMindmapAsync(new OutlineMindmapParameters { MapId = mapId, SubtreeOf = typo });

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.NotFound, result.Code);
        var suggestions = Data(result).GetProperty("suggestions").EnumerateArray().Select(e => e.GetString()!).ToList();
        Assert.Contains(suggestions, s => s.StartsWith(ids["n"]));
    }

    [Fact]
    public async Task Outline_ListsFreeElements()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, _) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "node" });
        await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[]
        {
            new AddElementOp { Kind = ElementKind.Shape, X = 5, Y = 5, Content = new ShapeContent { Shape = ShapeType.Rectangle, Text = "box" } },
        });

        var data = Data(await svc.OutlineMindmapAsync(new OutlineMindmapParameters { MapId = mapId }));
        var free = data.GetProperty("free");
        Assert.Equal(1, free.GetArrayLength());
        Assert.Equal("shape", free[0].GetProperty("kind").GetString());
        Assert.Equal("box", free[0].GetProperty("t").GetString());
    }

    // ---------------------------------------------------------------- find

    [Fact]
    public async Task Find_ReturnsHitWithBreadcrumbPath()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "r",
            Text = "Biology",
            Children = new List<MindmapNodeSpec>
            {
                new() { Ref = "c", Text = "Cells", Children = new List<MindmapNodeSpec> { new() { Ref = "m", Text = "Mitochondria" } } },
            },
        });

        var data = Data(await svc.FindInMapAsync(new FindInMapParameters { MapId = mapId, Query = "Mitochondria" }));
        var hits = data.GetProperty("hits");
        Assert.Equal(1, hits.GetArrayLength());
        Assert.Equal(ids["m"], hits[0].GetProperty("i").GetString());
        Assert.Equal("Biology > Cells", hits[0].GetProperty("path").GetString());
    }

    [Fact]
    public async Task Find_EmptyQuery_NoHitsWithRevision()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, _) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "node" });

        var result = await svc.FindInMapAsync(new FindInMapParameters { MapId = mapId, Query = "   " });

        Assert.True(result.Ok);
        var data = Data(result);
        Assert.Equal(0, data.GetProperty("hits").GetArrayLength());
        Assert.Equal(2, data.GetProperty("rev").GetInt64());
    }

    [Fact]
    public async Task Find_UnknownMap_NotFound()
    {
        await using var h = new MindmapTestHarness();
        var svc = new MindmapToolService(h.Service);

        var result = await svc.FindInMapAsync(new FindInMapParameters { MapId = "missing", Query = "x" });

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.NotFound, result.Code);
    }

    // ---------------------------------------------------------------- read

    [Fact]
    public async Task Read_ByIds_ProjectsContentAndKind()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "hello" });

        var data = Data(await svc.ReadElementsAsync(new ReadElementsParameters { MapId = mapId, Ids = new List<string> { ids["n"] } }));
        var elements = data.GetProperty("elements");
        Assert.Equal(1, elements.GetArrayLength());
        Assert.Equal(ids["n"], elements[0].GetProperty("i").GetString());
        Assert.Equal("node", elements[0].GetProperty("kind").GetString());
        Assert.Equal("text", elements[0].GetProperty("content").GetProperty("$type").GetString());
    }

    [Fact]
    public async Task Read_IncidentEdge_IncludedOnce()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h,
            new MindmapNodeSpec { Ref = "a", Text = "A" }, new MindmapNodeSpec { Ref = "b", Text = "B" });
        await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[] { new LinkOp { A = ids["a"], B = ids["b"], Label = "rel" } });

        var data = Data(await svc.ReadElementsAsync(new ReadElementsParameters { MapId = mapId, Ids = new List<string> { ids["a"], ids["b"] } }));
        var links = data.GetProperty("edges").EnumerateArray().Where(e => e.GetProperty("kind").GetString() == "link").ToList();
        Assert.Single(links);
        Assert.Equal("rel", links[0].GetProperty("label").GetString());
    }

    [Fact]
    public async Task Read_KindsFilter_SelectsFreeElements()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, _) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "node" });
        await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[]
        {
            new AddElementOp { Kind = ElementKind.Shape, X = 1, Y = 1, Content = new ShapeContent { Shape = ShapeType.Ellipse } },
        });

        var data = Data(await svc.ReadElementsAsync(new ReadElementsParameters { MapId = mapId, Kinds = new List<string> { "shape" } }));
        var elements = data.GetProperty("elements");
        Assert.Equal(1, elements.GetArrayLength());
        Assert.Equal("shape", elements[0].GetProperty("kind").GetString());
    }

    [Fact]
    public async Task Read_SubtreeOf_ReturnsWholeSubtree()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "r",
            Text = "R",
            Children = new List<MindmapNodeSpec> { new() { Ref = "a", Text = "A" }, new() { Ref = "b", Text = "B" } },
        });

        var data = Data(await svc.ReadElementsAsync(new ReadElementsParameters { MapId = mapId, SubtreeOf = ids["r"] }));
        Assert.Equal(3, data.GetProperty("elements").GetArrayLength());
    }

    [Fact]
    public async Task Read_IdsCapExceeded_ValidationError()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, _) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "n" });
        var many = Enumerable.Range(0, 101).Select(i => $"id{i}").ToList();

        var result = await svc.ReadElementsAsync(new ReadElementsParameters { MapId = mapId, Ids = many });

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.ValidationError, result.Code);
    }

    // ---------------------------------------------------------------- edit

    [Fact]
    public async Task Edit_SuccessfulBatch_ReturnsCreatedIdsAndRev()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "r", Text = "R" });

        var result = await svc.EditMindmapAsync(new EditMindmapParameters
        {
            MapId = mapId,
            Rev = 2,
            Ops = Ops($$"""[{ "op": "add", "under": "{{ids["r"]}}", "nodes": [ { "ref": "child", "t": "Child" } ] }]"""),
        });

        Assert.True(result.Ok);
        var data = Data(result);
        Assert.Equal(3, data.GetProperty("rev").GetInt64());
        Assert.True(data.GetProperty("created").TryGetProperty("child", out var childId));
        Assert.False(string.IsNullOrEmpty(childId.GetString()));
    }

    [Fact]
    public async Task Edit_MalformedOp_ValidationErrorWithoutTouchingService()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, _) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "n" });

        var result = await svc.EditMindmapAsync(new EditMindmapParameters
        {
            MapId = mapId,
            Rev = 2,
            Ops = Ops("""[{ "op": "bogus" }]"""),
        });

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.ValidationError, result.Code);
        Assert.Equal(0, Data(result).GetProperty("failed_op_index").GetInt32());
        // Nothing changed: still at revision 2.
        Assert.Equal(2, (await h.Service.GetAsync(mapId)).Value!.Revision);
    }

    [Fact]
    public async Task Edit_RevConflict_CarriesContendedIdsAndCurrentRev()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "n" });

        // A concurrent user edit touches n and bumps the revision to 3.
        await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[] { new SetOp { Id = ids["n"], Text = "user" } });

        var result = await svc.EditMindmapAsync(new EditMindmapParameters
        {
            MapId = mapId,
            Rev = 2,
            Ops = Ops($$"""[{ "op": "set", "id": "{{ids["n"]}}", "t": "agent" }]"""),
        });

        Assert.False(result.Ok);
        Assert.Equal("rev_conflict", result.Code);
        var data = Data(result);
        Assert.Contains(data.GetProperty("contended_ids").EnumerateArray().Select(e => e.GetString()), s => s == ids["n"]);
        Assert.Equal(3, data.GetProperty("rev").GetInt64());
    }

    [Fact]
    public async Task Edit_NotFound_CarriesSuggestions()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "hello" });
        var typo = Mutate(ids["n"]);

        var result = await svc.EditMindmapAsync(new EditMindmapParameters
        {
            MapId = mapId,
            Rev = 2,
            Ops = Ops($$"""[{ "op": "set", "id": "{{typo}}", "t": "x" }]"""),
        });

        Assert.False(result.Ok);
        Assert.Equal(ToolResultCodes.NotFound, result.Code);
        var suggestions = Data(result).GetProperty("suggestions").EnumerateArray().Select(e => e.GetString()!).ToList();
        Assert.Contains(suggestions, s => s.StartsWith(ids["n"]));
    }

    [Fact]
    public async Task Edit_WouldCycle_MappedToCode()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "a",
            Text = "A",
            Children = new List<MindmapNodeSpec> { new() { Ref = "b", Text = "B" } },
        });

        var result = await svc.EditMindmapAsync(new EditMindmapParameters
        {
            MapId = mapId,
            Rev = 2,
            Ops = Ops($$"""[{ "op": "move", "id": "{{ids["a"]}}", "under": "{{ids["b"]}}" }]"""),
        });

        Assert.False(result.Ok);
        Assert.Equal("would_cycle", result.Code);
    }

    [Fact]
    public async Task Edit_BadContentType_MappedToCode()
    {
        await using var h = new MindmapTestHarness();
        var (svc, mapId, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "n" });

        var result = await svc.EditMindmapAsync(new EditMindmapParameters
        {
            MapId = mapId,
            Rev = 2,
            Ops = Ops($$"""[{ "op": "set", "id": "{{ids["n"]}}", "content": { "$type": "frame", "title": "no" } }]"""),
        });

        Assert.False(result.Ok);
        Assert.Equal("bad_content_type", result.Code);
    }

    // ---------------------------------------------------------------- search

    [Fact]
    public async Task Search_QueryMatchesTitle()
    {
        await using var h = new MindmapTestHarness();
        var svc = new MindmapToolService(h.Service);
        await h.Service.CreateAsync("Biology Notes");
        await h.Service.CreateAsync("Chemistry");

        var data = Data(await svc.SearchMindmapsAsync(new SearchMindmapsParameters { Query = "biolog" }));
        var maps = data.GetProperty("maps");
        Assert.Equal(1, maps.GetArrayLength());
        Assert.Equal("Biology Notes", maps[0].GetProperty("title").GetString());
    }

    [Fact]
    public async Task Search_FuzzySubsequenceMatches()
    {
        await using var h = new MindmapTestHarness();
        var svc = new MindmapToolService(h.Service);
        await h.Service.CreateAsync("Biology Notes");

        var data = Data(await svc.SearchMindmapsAsync(new SearchMindmapsParameters { Query = "blgy" }));
        Assert.Equal(1, data.GetProperty("maps").GetArrayLength());
    }

    [Fact]
    public async Task Search_NoQuery_ListsAll_AndLimitApplies()
    {
        await using var h = new MindmapTestHarness();
        var svc = new MindmapToolService(h.Service);
        await h.Service.CreateAsync("One");
        await h.Service.CreateAsync("Two");
        await h.Service.CreateAsync("Three");

        var all = Data(await svc.SearchMindmapsAsync(new SearchMindmapsParameters()));
        Assert.Equal(3, all.GetProperty("maps").GetArrayLength());

        var limited = Data(await svc.SearchMindmapsAsync(new SearchMindmapsParameters { Limit = 2 }));
        Assert.Equal(2, limited.GetProperty("maps").GetArrayLength());
    }

    private static string Mutate(string id) => id[..^1] + (id[^1] == 'a' ? 'b' : 'a');
}
