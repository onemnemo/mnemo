using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapDocumentServiceTests
{
    [Fact]
    public async Task Create_Empty_StartsAtRevisionOne()
    {
        await using var h = new MindmapTestHarness();
        var created = await h.Service.CreateAsync("Empty");

        Assert.True(created.IsSuccess);
        Assert.Equal(1, created.Value!.Revision);
        Assert.Empty(created.Value.Elements);
    }

    [Fact]
    public async Task Create_WithOutline_BuildsTree()
    {
        await using var h = new MindmapTestHarness();
        var outline = new List<MindmapNodeSpec>
        {
            new() { Text = "Root", Children = new List<MindmapNodeSpec> { new() { Text = "A" }, new() { Text = "B" } } },
        };

        var created = await h.Service.CreateAsync("Tree", outline);
        var doc = created.Value!;

        Assert.Equal(3, doc.Elements.Count);
        Assert.Equal(2, doc.Edges.Count(e => e.Kind == EdgeKind.Hierarchy));
    }

    [Fact]
    public async Task Add_NestedSubtree_FormsForest_AndReturnsIds()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var result = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp
            {
                Nodes = new List<MindmapNodeSpec>
                {
                    new() { Ref = "root", Text = "Root", Children = new List<MindmapNodeSpec> { new() { Ref = "child", Text = "Child" } } },
                },
            },
        })).Value!;

        Assert.True(result.Success);
        Assert.Equal(2, result.Revision);
        Assert.Contains("root", result.CreatedIds.Keys);
        Assert.Contains("child", result.CreatedIds.Keys);

        var doc = (await h.Service.GetAsync(map.Id)).Value!;
        var childHierarchyParents = doc.Edges.Count(e => e.Kind == EdgeKind.Hierarchy && e.ToId == result.CreatedIds["child"]);
        Assert.Equal(1, childHierarchyParents); // exactly one hierarchy parent (forest invariant)
    }

    [Fact]
    public async Task Set_UpdatesText_AndMergesStyle()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "old" });

        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new SetOp { Id = ids["n"], Text = "new", Style = new ElementStyle { Fill = "accent" } },
        });

        var node = (await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == ids["n"]);
        Assert.Equal("new", ((TextContent)node.Content).Text);
        Assert.Equal("accent", node.Style!.Fill);
    }

    [Fact]
    public async Task Set_ClearStyle_RemovesOverride()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "n" });

        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new SetOp { Id = ids["n"], Style = new ElementStyle { Fill = "accent", NodeShape = NodeShape.Pill } },
        });
        await h.Service.ApplyAsync(map.Id, 3, new MindmapEditOp[]
        {
            new SetOp { Id = ids["n"], ClearStyle = true },
        });

        var node = (await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == ids["n"]);
        Assert.Null(node.Style);
    }

    [Fact]
    public async Task Set_ClearStyleWithNewStyle_ReplacesInsteadOfMerging()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "n" });

        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new SetOp { Id = ids["n"], Style = new ElementStyle { Fill = "accent", Stroke = "stroke" } },
        });
        await h.Service.ApplyAsync(map.Id, 3, new MindmapEditOp[]
        {
            new SetOp { Id = ids["n"], ClearStyle = true, Style = new ElementStyle { Fill = "palette.2" } },
        });

        var node = (await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == ids["n"]);
        Assert.Equal("palette.2", node.Style!.Fill);
        Assert.Null(node.Style.Stroke);
    }

    [Fact]
    public async Task Move_Reparent_RejectedWhenCyclic()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "a",
            Text = "A",
            Children = new List<MindmapNodeSpec> { new() { Ref = "b", Text = "B" } },
        });

        var result = (await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new MoveOp { Id = ids["a"], Under = ids["b"] },
        })).Value!;

        Assert.False(result.Success);
        Assert.Equal(MindmapEditErrorCode.WouldCycle, result.Error!.Code);
    }

    [Fact]
    public async Task Move_Reposition_PinsNode()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n", Text = "n" });

        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new MoveOp { Id = ids["n"], X = 120, Y = 40 },
        });

        var node = (await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == ids["n"]);
        Assert.Equal(120, node.X);
        Assert.True(node.Pinned);
    }

    [Fact]
    public async Task Delete_CascadesSubtree_AndEchoesCount()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "a",
            Children = new List<MindmapNodeSpec>
            {
                new() { Ref = "b", Children = new List<MindmapNodeSpec> { new() { Ref = "c" } } },
            },
        });

        var result = (await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new DeleteOp { Ids = new[] { ids["a"] } },
        })).Value!;

        Assert.True(result.Success);
        Assert.Equal(3, result.DeletedCount);
        Assert.Empty((await h.Service.GetAsync(map.Id)).Value!.Elements);
    }

    [Fact]
    public async Task Link_Then_Unlink_RemovesEdge()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h,
            new MindmapNodeSpec { Ref = "a" }, new MindmapNodeSpec { Ref = "b" });

        var linked = (await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new LinkOp { Ref = "l", A = ids["a"], B = ids["b"], Label = "relates" },
        })).Value!;
        var edgeId = linked.CreatedIds["l"];

        Assert.Single((await h.Service.GetAsync(map.Id)).Value!.Edges, e => e.Kind == EdgeKind.Link);

        await h.Service.ApplyAsync(map.Id, 3, new MindmapEditOp[] { new UnlinkOp { EdgeId = edgeId } });

        Assert.DoesNotContain((await h.Service.GetAsync(map.Id)).Value!.Edges, e => e.Kind == EdgeKind.Link);
    }

    [Fact]
    public async Task AddElement_Shape_CreatesFreeElement()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var result = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddElementOp { Ref = "s", Kind = ElementKind.Shape, X = 10, Y = 20, Content = new ShapeContent { Shape = ShapeType.Hexagon, Text = "recrystallize" } },
        })).Value!;

        var shape = (await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == result.CreatedIds["s"]);
        Assert.Equal(ElementKind.Shape, shape.Kind);
        Assert.Equal(ShapeType.Hexagon, ((ShapeContent)shape.Content).Shape);
    }

    [Fact]
    public async Task Frame_AddsMembers()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var seed = (await h.Service.ApplyAsync(map.Id, 1, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new List<MindmapNodeSpec> { new() { Ref = "n" } } },
            new AddElementOp { Ref = "f", Kind = ElementKind.Frame, Content = new FrameContent { Title = "Group" } },
        })).Value!;

        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new FrameOp { Id = seed.CreatedIds["f"], Add = new[] { seed.CreatedIds["n"] } },
        });

        var frame = (await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == seed.CreatedIds["f"]);
        Assert.Contains(seed.CreatedIds["n"], ((FrameContent)frame.Content).ChildIds);
    }

    [Fact]
    public async Task Move_Frame_TranslatesMembers_PinsMemberNodes_AndLeavesNonMembers()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var seed = (await h.Service.ApplyAsync(map.Id, 1, new MindmapEditOp[]
        {
            new AddElementOp { Ref = "s", Kind = ElementKind.Shape, X = 100, Y = 100, Content = new ShapeContent { Shape = ShapeType.Rectangle } },
            new AddElementOp { Ref = "o", Kind = ElementKind.Shape, X = 400, Y = 400, Content = new ShapeContent { Shape = ShapeType.Ellipse } },
            new AddNodesOp { Nodes = new List<MindmapNodeSpec> { new() { Ref = "n" } } },
            new AddElementOp { Ref = "f", Kind = ElementKind.Frame, X = 50, Y = 50, Content = new FrameContent { Title = "G" } },
        })).Value!;

        // A member shape and an unpinned member node; the frame moves by a (+100, +100) delta.
        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new FrameOp { Id = seed.CreatedIds["f"], Add = new[] { seed.CreatedIds["s"], seed.CreatedIds["n"] } },
        });
        await h.Service.ApplyAsync(map.Id, 3, new MindmapEditOp[]
        {
            new MoveOp { Id = seed.CreatedIds["f"], X = 150, Y = 150 },
        });

        var doc = (await h.Service.GetAsync(map.Id)).Value!;
        var shape = doc.Elements.Single(e => e.Id == seed.CreatedIds["s"]);
        var node = doc.Elements.Single(e => e.Id == seed.CreatedIds["n"]);
        var outside = doc.Elements.Single(e => e.Id == seed.CreatedIds["o"]);

        Assert.Equal((200, 200), (shape.X, shape.Y));      // member shape shifted by the delta
        Assert.Equal((100, 100), (node.X, node.Y));        // member node started at origin, shifted + pinned
        Assert.True(node.Pinned);
        Assert.Equal((400, 400), (outside.X, outside.Y));  // non-member untouched
    }

    [Fact]
    public async Task StyleSubtree_AppliesToRootAndDescendants()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec
        {
            Ref = "a",
            Children = new List<MindmapNodeSpec> { new() { Ref = "b" } },
        });

        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new StyleSubtreeOp { Root = ids["a"], Style = new ElementStyle { Fill = "palette.2" } },
        });

        var doc = (await h.Service.GetAsync(map.Id)).Value!;
        Assert.Equal("palette.2", doc.Elements.Single(e => e.Id == ids["a"]).Style!.Fill);
        Assert.Equal("palette.2", doc.Elements.Single(e => e.Id == ids["b"]).Style!.Fill);
    }

    [Fact]
    public async Task Layout_SetsClusterSettings()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "a" });

        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new LayoutOp { Root = ids["a"], Algorithm = MindmapLayoutAlgorithms.TreeDown },
        });

        var cluster = (await h.Service.GetAsync(map.Id)).Value!.Clusters.Single();
        Assert.Equal(ids["a"], cluster.RootId);
        Assert.Equal(MindmapLayoutAlgorithms.TreeDown, cluster.LayoutAlgorithm);
    }

    [Fact]
    public async Task Set_ContentKindMismatch_ReturnsBadContentType()
    {
        await using var h = new MindmapTestHarness();
        var (map, ids) = await SeedAsync(h, new MindmapNodeSpec { Ref = "n" });

        var result = (await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new SetOp { Id = ids["n"], Content = new FrameContent { Title = "no" } },
        })).Value!;

        Assert.Equal(MindmapEditErrorCode.BadContentType, result.Error!.Code);
    }

    [Fact]
    public async Task AddElement_WithNodeKind_ReturnsBadContentType()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var result = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddElementOp { Kind = ElementKind.Node, Content = new TextContent { Text = "x" } },
        })).Value!;

        Assert.Equal(MindmapEditErrorCode.BadContentType, result.Error!.Code);
    }

    [Fact]
    public async Task Set_MissingElement_ReturnsNotFound()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var result = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new SetOp { Id = "zzzz", Text = "x" },
        })).Value!;

        Assert.Equal(MindmapEditErrorCode.NotFound, result.Error!.Code);
    }

    [Fact]
    public async Task Apply_AheadRevision_ReturnsRevConflict()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var result = (await h.Service.ApplyAsync(map.Id, 99, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new List<MindmapNodeSpec> { new() { Text = "x" } } },
        })).Value!;

        Assert.Equal(MindmapEditErrorCode.RevConflict, result.Error!.Code);
    }

    [Fact]
    public async Task Batch_IsTransactional_NothingPersistsWhenAnOpFails()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var result = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new List<MindmapNodeSpec> { new() { Text = "survivor?" } } },
            new SetOp { Id = "missing", Text = "boom" },
        })).Value!;

        Assert.False(result.Success);
        Assert.Equal(1, result.Error!.FailedOpIndex);

        var doc = (await h.Service.GetAsync(map.Id)).Value!;
        Assert.Equal(1, doc.Revision); // unchanged
        Assert.Empty(doc.Elements);    // the first op did not persist
    }

    [Fact]
    public async Task EmptyAddOp_ReturnsInvalidOperation()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var result = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new List<MindmapNodeSpec>() },
        })).Value!;

        Assert.Equal(MindmapEditErrorCode.InvalidOperation, result.Error!.Code);
    }

    [Fact]
    public async Task AddedNodeText_IsSearchableInStore()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new List<MindmapNodeSpec> { new() { Text = "volcano" } } },
        });

        var hits = await h.Store.SearchAsync(map.Id, "volcano", 10);
        Assert.Single(hits);
    }

    /// <summary>Creates a map and applies one floating add of the given specs, returning the ref→id map.</summary>
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
}
