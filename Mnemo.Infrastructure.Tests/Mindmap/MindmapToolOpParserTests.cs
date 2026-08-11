using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Tools;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapToolOpParserTests
{
    private static JsonElement Ops(string json) => JsonDocument.Parse(json).RootElement;

    private static List<MindmapEditOp> ParseOk(string json)
    {
        Assert.True(MindmapToolOpParser.TryParse(Ops(json), out var ops, out var error, out _), error);
        return ops;
    }

    private static (string Error, int Index) ParseFail(string json)
    {
        Assert.False(MindmapToolOpParser.TryParse(Ops(json), out _, out var error, out var index));
        return (error, index);
    }

    [Fact]
    public void Add_NestedTree_WithRefs_RoundTrips()
    {
        var ops = ParseOk("""
            [{ "op": "add", "under": "root", "after": "sib", "nodes": [
                { "ref": "a", "t": "A", "c": [ { "ref": "b", "t": "B" } ] }
            ] }]
            """);

        var add = Assert.IsType<AddNodesOp>(ops.Single());
        Assert.Equal("root", add.Under);
        Assert.Equal("sib", add.After);
        var a = Assert.Single(add.Nodes);
        Assert.Equal("a", a.Ref);
        Assert.Equal("A", a.Text);
        var b = Assert.Single(a.Children);
        Assert.Equal("b", b.Ref);
        Assert.Equal("B", b.Text);
    }

    [Fact]
    public void Add_NodeWithContentObject_ParsesTypedContent()
    {
        var ops = ParseOk("""
            [{ "op": "add", "nodes": [ { "content": { "$type": "task", "text": "buy milk", "done": true } } ] }]
            """);

        var node = Assert.Single(Assert.IsType<AddNodesOp>(ops.Single()).Nodes);
        var task = Assert.IsType<TaskContent>(node.Content);
        Assert.Equal("buy milk", task.Text);
        Assert.True(task.Done);
    }

    [Fact]
    public void Set_TextShorthand_And_StyleAndFlags()
    {
        var ops = ParseOk("""
            [{ "op": "set", "id": "ab12", "t": "new", "style": { "fill": "accent", "nodeShape": "pill" }, "collapsed": true, "pinned": false, "wh": [120, 40] }]
            """);

        var set = Assert.IsType<SetOp>(ops.Single());
        Assert.Equal("ab12", set.Id);
        Assert.Equal("new", set.Text);
        Assert.Equal("accent", set.Style!.Fill);
        Assert.Equal(NodeShape.Pill, set.Style.NodeShape);
        Assert.True(set.Collapsed);
        Assert.False(set.Pinned);
        Assert.Equal(120, set.Width);
        Assert.Equal(40, set.Height);
    }

    [Fact]
    public void Set_ClearStyle_Parses()
    {
        var set = Assert.IsType<SetOp>(ParseOk("""[{ "op": "set", "id": "x", "clear_style": true }]""").Single());
        Assert.True(set.ClearStyle);
        Assert.Null(set.Style);
    }

    [Fact]
    public void Move_Reparent_And_Reposition()
    {
        var reparent = Assert.IsType<MoveOp>(ParseOk("""[{ "op": "move", "id": "n", "under": "p", "after": "s" }]""").Single());
        Assert.Equal("p", reparent.Under);
        Assert.Equal("s", reparent.After);
        Assert.Null(reparent.X);

        var reposition = Assert.IsType<MoveOp>(ParseOk("""[{ "op": "move", "id": "n", "xy": [12, 34] }]""").Single());
        Assert.Equal(12, reposition.X);
        Assert.Equal(34, reposition.Y);
        Assert.Null(reposition.Under);
    }

    [Fact]
    public void Delete_IdsAndSingleId()
    {
        var del = Assert.IsType<DeleteOp>(ParseOk("""[{ "op": "del", "ids": ["a", "b"], "id": "c" }]""").Single());
        Assert.Equal(new[] { "a", "b", "c" }, del.Ids);
    }

    [Fact]
    public void Link_And_Unlink_BothForms()
    {
        var link = Assert.IsType<LinkOp>(ParseOk("""[{ "op": "link", "ref": "l", "a": "x", "b": "y", "label": "rel", "style": { "line": "dashed" } }]""").Single());
        Assert.Equal("l", link.Ref);
        Assert.Equal("x", link.A);
        Assert.Equal("y", link.B);
        Assert.Equal("rel", link.Label);
        Assert.Equal(LineStyle.Dashed, link.Style!.Line);

        var byEdge = Assert.IsType<UnlinkOp>(ParseOk("""[{ "op": "unlink", "edge": "e1" }]""").Single());
        Assert.Equal("e1", byEdge.EdgeId);

        var byEndpoints = Assert.IsType<UnlinkOp>(ParseOk("""[{ "op": "unlink", "a": "x", "b": "y" }]""").Single());
        Assert.Equal("x", byEndpoints.A);
        Assert.Equal("y", byEndpoints.B);
    }

    [Fact]
    public void SetEdge_LabelAndStyle()
    {
        var op = Assert.IsType<SetEdgeOp>(ParseOk("""[{ "op": "set_edge", "edge": "e1", "label": "flows", "style": { "endCap": "arrow" }, "clear_style": true }]""").Single());
        Assert.Equal("e1", op.EdgeId);
        Assert.Equal("flows", op.Label);
        Assert.Equal(ArrowCap.Arrow, op.Style!.EndCap);
        Assert.True(op.ClearStyle);
    }

    [Fact]
    public void StyleSubtree_RootAndIds()
    {
        var byRoot = Assert.IsType<StyleSubtreeOp>(ParseOk("""[{ "op": "style_subtree", "root": "r", "style": { "fill": "palette.2" } }]""").Single());
        Assert.Equal("r", byRoot.Root);
        Assert.Equal("palette.2", byRoot.Style.Fill);

        var byIds = Assert.IsType<StyleSubtreeOp>(ParseOk("""[{ "op": "style_subtree", "ids": ["a", "b"], "style": { "stroke": "stroke" } }]""").Single());
        Assert.Equal(new[] { "a", "b" }, byIds.Ids);
    }

    [Fact]
    public void Layout_AllFields()
    {
        var op = Assert.IsType<LayoutOp>(ParseOk("""[{ "op": "layout", "root": "r", "algo": "treeDown", "template": "Study", "options": { "nodeSpacing": 24 } }]""").Single());
        Assert.Equal("r", op.Root);
        Assert.Equal("treeDown", op.Algorithm);
        Assert.Equal("Study", op.TemplateId);
        Assert.Equal(24, op.Options!.NodeSpacing);
    }

    [Fact]
    public void Layout_ReadsTheCanvasBackground()
    {
        var op = Assert.IsType<LayoutOp>(ParseOk("""[{ "op": "layout", "background": "grid" }]""").Single());
        Assert.Equal(CanvasBackground.Grid, op.Background);

        // Absent means "leave it alone", which is not the same as asking for the default.
        var untouched = Assert.IsType<LayoutOp>(ParseOk("""[{ "op": "layout", "template": "Study" }]""").Single());
        Assert.Null(untouched.Background);
    }

    [Fact]
    public void Layout_RejectsABackgroundNobodyDraws()
    {
        var (error, _) = ParseFail("""[{ "op": "layout", "background": "hexagons" }]""");
        Assert.Contains("dots, grid or plain", error);
    }

    [Fact]
    public void AddElement_ShapeWithXyWh()
    {
        var op = Assert.IsType<AddElementOp>(ParseOk("""
            [{ "op": "add_el", "ref": "s", "kind": "shape", "xy": [10, 20], "wh": [200, 100], "content": { "$type": "shape", "shape": "hexagon", "text": "x" } }]
            """).Single());

        Assert.Equal("s", op.Ref);
        Assert.Equal(ElementKind.Shape, op.Kind);
        Assert.Equal(10, op.X);
        Assert.Equal(20, op.Y);
        Assert.Equal(200, op.Width);
        Assert.Equal(100, op.Height);
        Assert.Equal(ShapeType.Hexagon, Assert.IsType<ShapeContent>(op.Content).Shape);
    }

    [Fact]
    public void Frame_AddRemove()
    {
        var op = Assert.IsType<FrameOp>(ParseOk("""[{ "op": "frame", "id": "f", "add": ["a"], "remove": ["b", "c"] }]""").Single());
        Assert.Equal("f", op.Id);
        Assert.Equal(new[] { "a" }, op.Add);
        Assert.Equal(new[] { "b", "c" }, op.Remove);
    }

    [Fact]
    public void ContentDiscriminators_AllParse()
    {
        var ops = ParseOk("""
            [
              { "op": "add", "nodes": [ { "content": { "$type": "text", "text": "t" } } ] },
              { "op": "add", "nodes": [ { "content": { "$type": "code", "language": "py", "source": "print()" } } ] },
              { "op": "add", "nodes": [ { "content": { "$type": "math", "latex": "x^2" } } ] },
              { "op": "add", "nodes": [ { "content": { "$type": "link", "url": "http://x", "title": "X" } } ] },
              { "op": "add", "nodes": [ { "content": { "$type": "note", "noteId": "n1" } } ] },
              { "op": "add", "nodes": [ { "content": { "$type": "flashcard", "deckId": "d1" } } ] },
              { "op": "add_el", "kind": "text", "xy": [0, 0], "content": { "$type": "freeText", "text": "free" } },
              { "op": "add_el", "kind": "frame", "xy": [0, 0], "content": { "$type": "frame", "title": "G" } }
            ]
            """);

        Assert.IsType<CodeContent>(((AddNodesOp)ops[1]).Nodes[0].Content);
        Assert.IsType<MathContent>(((AddNodesOp)ops[2]).Nodes[0].Content);
        Assert.IsType<LinkContent>(((AddNodesOp)ops[3]).Nodes[0].Content);
        Assert.IsType<NoteContent>(((AddNodesOp)ops[4]).Nodes[0].Content);
        Assert.IsType<FlashcardContent>(((AddNodesOp)ops[5]).Nodes[0].Content);
        Assert.IsType<FreeTextContent>(((AddElementOp)ops[6]).Content);
        Assert.IsType<FrameContent>(((AddElementOp)ops[7]).Content);
    }

    [Fact]
    public void CaseInsensitive_StyleAndEnum()
    {
        // A small model is inconsistent about casing; parsing must tolerate it.
        var set = Assert.IsType<SetOp>(ParseOk("""[{ "op": "set", "id": "n", "style": { "Fill": "accent", "FontScale": "L" } }]""").Single());
        Assert.Equal("accent", set.Style!.Fill);
        Assert.Equal(FontScale.L, set.Style.FontScale);
    }

    // ---- malformed ------------------------------------------------------------------------------

    [Fact]
    public void UnknownOp_FailsWithIndex()
    {
        var (error, index) = ParseFail("""[{ "op": "set", "id": "a", "t": "ok" }, { "op": "frobnicate" }]""");
        Assert.Equal(1, index);
        Assert.Contains("unknown op", error);
    }

    [Fact]
    public void MissingOpField_Fails()
    {
        var (error, index) = ParseFail("""[{ "id": "a" }]""");
        Assert.Equal(0, index);
        Assert.Contains("\"op\"", error);
    }

    [Fact]
    public void SetMissingId_Fails()
    {
        var (error, _) = ParseFail("""[{ "op": "set", "t": "x" }]""");
        Assert.Contains("id", error);
    }

    [Fact]
    public void BadXyShape_Fails()
    {
        var (error, index) = ParseFail("""[{ "op": "move", "id": "n", "xy": [1, 2, 3] }]""");
        Assert.Equal(0, index);
        Assert.Contains("xy", error);
    }

    [Fact]
    public void GarbageContent_MissingType_Fails()
    {
        var (error, _) = ParseFail("""[{ "op": "add", "nodes": [ { "content": { "text": "no discriminator" } } ] }]""");
        Assert.Contains("content", error);
    }

    [Fact]
    public void EmptyBatch_Fails()
    {
        var (error, index) = ParseFail("[]");
        Assert.Equal(-1, index);
        Assert.Contains("empty", error);
    }

    [Fact]
    public void OpsNotArray_Fails()
    {
        Assert.False(MindmapToolOpParser.TryParse(Ops("""{ "op": "set" }"""), out _, out var error, out var index));
        Assert.Equal(-1, index);
        Assert.Contains("array", error);
    }

    [Fact]
    public void NodeWithoutTextContentOrChildren_Fails()
    {
        var (error, _) = ParseFail("""[{ "op": "add", "nodes": [ { "ref": "x" } ] }]""");
        Assert.Contains("node", error);
    }
}
