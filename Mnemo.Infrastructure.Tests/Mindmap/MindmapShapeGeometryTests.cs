using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapShapeGeometryTests
{
    [Fact]
    public void RoundTrip_EveryGeometryMember()
    {
        var document = new MindmapDocument
        {
            Id = "m1",
            Title = "Lines",
            Elements = new List<MindmapElement>
            {
                new()
                {
                    Id = "n1",
                    Kind = ElementKind.Node,
                    Content = new TextContent { Text = "target" },
                },
                new()
                {
                    Id = "l1",
                    Kind = ElementKind.Shape,
                    X = 10,
                    Y = 20,
                    Width = 100,
                    Height = 40,
                    Content = new ShapeContent
                    {
                        Shape = ShapeType.Arrow,
                        Line = new LineGeometry
                        {
                            Start = new CanvasPoint(0, 40),
                            End = new CanvasPoint(100, 0),
                            Bend = new CanvasPoint(30, 5),
                            StartAt = new LineAttachment { ElementId = "n1", Side = AnchorSide.Right },
                        },
                        StartCap = ArrowCap.Dot,
                        EndCap = ArrowCap.None,
                        Thickness = 3,
                    },
                },
                new()
                {
                    Id = "s1",
                    Kind = ElementKind.Shape,
                    Content = new ShapeContent { Shape = ShapeType.Hexagon, Rotation = 30 },
                },
            },
        };

        var json = MindmapDocumentSerializer.Serialize(document);
        var read = MindmapDocumentSerializer.Deserialize(json)!;

        Assert.Equal(json, MindmapDocumentSerializer.Serialize(read));
        var line = Assert.IsType<ShapeContent>(read.Elements[1].Content);
        Assert.Equal(new CanvasPoint(100, 0), line.Line!.End);
        Assert.Equal(new CanvasPoint(30, 5), line.Line.Bend);
        Assert.Equal(AnchorSide.Right, line.Line.StartAt!.Side);
        Assert.Null(line.Line.EndAt);
        Assert.Equal(ArrowCap.Dot, line.StartCap);
        Assert.Equal(ArrowCap.None, line.EndCap);
        Assert.Equal(3, line.Thickness);
        Assert.Equal(30, ((ShapeContent)read.Elements[2].Content).Rotation);
        Assert.Contains("\"side\":\"right\"", json);
    }

    [Fact]
    public void APointAtTheOrigin_SurvivesTheSparseWriter()
    {
        var document = new MindmapDocument
        {
            Id = "m1",
            Title = "T",
            Elements = new List<MindmapElement>
            {
                new()
                {
                    Id = "l1",
                    Kind = ElementKind.Shape,
                    Content = new ShapeContent
                    {
                        Shape = ShapeType.Line,
                        Line = new LineGeometry
                        {
                            Start = new CanvasPoint(0, 0),
                            End = new CanvasPoint(80, 0),
                            EndAt = new LineAttachment { ElementId = "n1", Side = AnchorSide.Top },
                        },
                    },
                },
            },
        };

        var json = MindmapDocumentSerializer.Serialize(document);
        var read = MindmapDocumentSerializer.Deserialize(json)!;

        Assert.Contains("\"start\":{}", json);
        Assert.DoesNotContain("\"side\"", json);
        var line = ((ShapeContent)read.Elements[0].Content).Line!;
        Assert.Equal(new CanvasPoint(0, 0), line.Start);
        Assert.Equal(new CanvasPoint(80, 0), line.End);
        Assert.Equal(AnchorSide.Top, line.EndAt!.Side);
    }

    [Fact]
    public void AnOlderShapeRow_ReadsWithNoGeometry()
    {
        const string json = """
            {"schemaVersion":2,"id":"m1","title":"Old","elements":[
              {"id":"l1","kind":"shape","x":1,"y":2,"width":50,"height":30,"content":{"$type":"shape","shape":"arrow"}}]}
            """;

        var read = MindmapDocumentSerializer.Deserialize(json)!;

        var shape = Assert.IsType<ShapeContent>(read.Elements[0].Content);
        Assert.Null(shape.Line);
        Assert.Equal(0, shape.Rotation);
        Assert.Null(shape.Thickness);
    }

    [Fact]
    public async Task Delete_LetsGoOfAnAttachedEnd()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var seeded = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new[] { new MindmapNodeSpec { Ref = "a", Text = "a" }, new MindmapNodeSpec { Ref = "b", Text = "b" } } },
        })).Value!;
        var a = seeded.CreatedIds["a"];
        var b = seeded.CreatedIds["b"];

        var drawn = (await h.Service.ApplyAsync(map.Id, seeded.Revision, new MindmapEditOp[]
        {
            new AddElementOp
            {
                Ref = "l",
                Kind = ElementKind.Shape,
                X = 0,
                Y = 0,
                Width = 100,
                Height = 16,
                Content = new ShapeContent
                {
                    Shape = ShapeType.Arrow,
                    Line = new LineGeometry
                    {
                        Start = new CanvasPoint(0, 8),
                        End = new CanvasPoint(100, 8),
                        StartAt = new LineAttachment { ElementId = a, Side = AnchorSide.Right },
                        EndAt = new LineAttachment { ElementId = b, Side = AnchorSide.Left },
                    },
                },
            },
        })).Value!;

        await h.Service.ApplyAsync(map.Id, drawn.Revision, new MindmapEditOp[] { new DeleteOp { Ids = new[] { a } } });

        var line = (ShapeContent)(await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == drawn.CreatedIds["l"]).Content;
        Assert.Null(line.Line!.StartAt);
        Assert.Equal(b, line.Line.EndAt!.ElementId);
        Assert.Equal(new CanvasPoint(0, 8), line.Line.Start);
    }

    [Fact]
    public async Task Duplicate_PointsAttachmentsAtTheCopiedElements()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var seeded = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new[] { new MindmapNodeSpec { Ref = "a", Text = "a" } } },
        })).Value!;
        var a = seeded.CreatedIds["a"];
        await h.Service.ApplyAsync(map.Id, seeded.Revision, new MindmapEditOp[]
        {
            new AddElementOp
            {
                Kind = ElementKind.Shape,
                X = 0,
                Y = 0,
                Content = new ShapeContent
                {
                    Shape = ShapeType.Line,
                    Line = new LineGeometry { End = new CanvasPoint(50, 0), EndAt = new LineAttachment { ElementId = a, Side = AnchorSide.Left } },
                },
            },
        });

        var copy = (await h.Service.DuplicateAsync(map.Id, "Copy")).Value!;

        var copiedNode = copy.Elements.Single(e => e.Kind == ElementKind.Node);
        var copiedLine = (ShapeContent)copy.Elements.Single(e => e.Kind == ElementKind.Shape).Content;
        Assert.NotEqual(a, copiedNode.Id);
        Assert.Equal(copiedNode.Id, copiedLine.Line!.EndAt!.ElementId);
        Assert.Equal(AnchorSide.Left, copiedLine.Line.EndAt.Side);
    }

    [Fact]
    public async Task Set_WithContentLackingTheLine_DropsIt_SinceContentIsReplacedWhole()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var added = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddElementOp
            {
                Ref = "l",
                Kind = ElementKind.Shape,
                X = 0,
                Y = 0,
                Content = new ShapeContent { Shape = ShapeType.Line, Line = new LineGeometry { End = new CanvasPoint(50, 0) } },
            },
        })).Value!;
        var id = added.CreatedIds["l"];

        await h.Service.ApplyAsync(map.Id, added.Revision, new MindmapEditOp[]
        {
            new SetOp { Id = id, Content = new ShapeContent { Shape = ShapeType.Line, Text = "renamed" } },
        });

        var line = (ShapeContent)(await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == id).Content;
        Assert.Null(line.Line);
        Assert.Equal("renamed", line.Text);
    }

    [Fact]
    public async Task Set_BringsRotationAndThicknessIntoRange()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var added = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddElementOp
            {
                Ref = "s",
                Kind = ElementKind.Shape,
                X = 0,
                Y = 0,
                Content = new ShapeContent { Shape = ShapeType.Line, Rotation = -90, Thickness = 0 },
            },
        })).Value!;
        var id = added.CreatedIds["s"];

        var first = (ShapeContent)(await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == id).Content;
        Assert.Equal(270, first.Rotation);
        Assert.Equal(0.5, first.Thickness);

        await h.Service.ApplyAsync(map.Id, added.Revision, new MindmapEditOp[]
        {
            new SetOp { Id = id, Content = new ShapeContent { Shape = ShapeType.Line, Rotation = 725, Thickness = 40 } },
        });

        var second = (ShapeContent)(await h.Service.GetAsync(map.Id)).Value!.Elements.Single(e => e.Id == id).Content;
        Assert.Equal(5, second.Rotation);
        Assert.Equal(12, second.Thickness);
    }

    [Fact]
    public async Task Get_RepairsStoredGeometryAndDetachesAnInvalidTarget()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var added = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddElementOp
            {
                Ref = "l",
                Kind = ElementKind.Shape,
                Content = new ShapeContent
                {
                    Shape = ShapeType.Line,
                    Rotation = 5,
                    Thickness = 3,
                    Line = new LineGeometry
                    {
                        End = new CanvasPoint(50, 0),
                        EndAt = new LineAttachment { ElementId = "missing", Side = AnchorSide.Left },
                    },
                },
            },
        })).Value!;

        Assert.False(added.Success);

        var valid = (await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddElementOp
            {
                Ref = "l",
                Kind = ElementKind.Shape,
                Content = new ShapeContent
                {
                    Shape = ShapeType.Line,
                    Rotation = 5,
                    Thickness = 3,
                    Line = new LineGeometry { End = new CanvasPoint(50, 0) },
                },
            },
        })).Value!;

        await h.DamageAsync(
            "UPDATE Mindmaps SET Doc = replace(replace(replace(Doc, '\"rotation\":5', '\"rotation\":725'), '\"thickness\":3', '\"thickness\":0'), '\"end\":{\"x\":50}', '\"end\":{\"x\":50},\"endAt\":{\"elementId\":\"missing\",\"side\":\"left\"}') WHERE Id = $id;",
            map.Id);

        var loaded = (await h.Service.GetAsync(map.Id)).Value!;
        var line = Assert.IsType<ShapeContent>(loaded.Elements.Single(e => e.Id == valid.CreatedIds["l"]).Content);
        Assert.Equal(5, line.Rotation);
        Assert.Equal(0.5, line.Thickness);
        Assert.Null(line.Line!.EndAt);
    }

    [Fact]
    public async Task Replace_NormalizesGeometryAndRejectsMalformedAttachments()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var malformed = map with
        {
            Elements = new[]
            {
                new MindmapElement
                {
                    Id = "l",
                    Kind = ElementKind.Shape,
                    Content = new ShapeContent
                    {
                        Shape = ShapeType.Line,
                        Rotation = -90,
                        Thickness = 0,
                        Line = new LineGeometry
                        {
                            End = new CanvasPoint(50, 0),
                            EndAt = new LineAttachment { ElementId = string.Empty, Side = AnchorSide.Left },
                        },
                    },
                },
            },
        };

        var refused = (await h.Service.ReplaceAsync(malformed)).Value!;
        Assert.False(refused.Success);

        var accepted = (await h.Service.ReplaceAsync(malformed with
        {
            Elements = new[]
            {
                malformed.Elements[0] with
                {
                    Content = ((ShapeContent)malformed.Elements[0].Content) with
                    {
                        Line = new LineGeometry { End = new CanvasPoint(50, 0) },
                    },
                },
            },
        })).Value!;

        Assert.True(accepted.Success);
        var loaded = (ShapeContent)(await h.Service.GetAsync(map.Id)).Value!.Elements.Single().Content;
        Assert.Equal(270, loaded.Rotation);
        Assert.Equal(0.5, loaded.Thickness);
    }
}
