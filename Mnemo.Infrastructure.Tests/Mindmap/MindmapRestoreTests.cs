using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Command-based undo and redo exercised through the service: an edit's reversing and replaying deltas
/// come back on its own result, and are applied via <c>RestoreAsync</c>. The delete case is the
/// load-bearing one: undo must restore the exact elements, edges and ids, since these back real work.
/// </summary>
public sealed class MindmapRestoreTests
{
    private static async Task<MindmapDocument> DocAsync(MindmapTestHarness h, string id) =>
        (await h.Service.GetAsync(id)).Value!;

    [Fact]
    public async Task Undo_OfAdd_RemovesTheAddedNodeAndEdge()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new List<MindmapNodeSpec> { new() { Ref = "root", Text = "Root" } })).Value!;
        var rootId = map.Elements.Single().Id;

        var before = await DocAsync(h, map.Id);
        var add = (await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Under = rootId, Nodes = new List<MindmapNodeSpec> { new() { Ref = "c", Text = "Child" } } },
        })).Value!;
        Assert.True(add.Success);
        var after = await DocAsync(h, map.Id);
        Assert.Equal(2, after.Elements.Count);

        var undo = MindmapRestoreDelta.Between(after, before);
        var restore = await h.Service.RestoreAsync(map.Id, after.Revision, undo);
        Assert.True(restore.IsSuccess);

        var reverted = await DocAsync(h, map.Id);
        Assert.Single(reverted.Elements);
        Assert.Equal(rootId, reverted.Elements.Single().Id);
        Assert.Empty(reverted.Edges);
    }

    [Fact]
    public async Task Undo_OfDelete_RestoresSubtreeVerbatim()
    {
        await using var h = new MindmapTestHarness();
        var outline = new List<MindmapNodeSpec>
        {
            new()
            {
                Ref = "root", Text = "Root",
                Children = new List<MindmapNodeSpec>
                {
                    new() { Ref = "a", Text = "Alpha", Children = new List<MindmapNodeSpec> { new() { Ref = "a1", Text = "Alpha-1" } } },
                    new() { Ref = "b", Text = "Beta" },
                },
            },
        };
        var map = (await h.Service.CreateAsync("Tree", outline)).Value!;

        var before = await DocAsync(h, map.Id);
        var alphaId = before.Elements.Single(e => Text(e) == "Alpha").Id;

        // Delete the Alpha subtree (Alpha + Alpha-1 + their edges cascade).
        var del = (await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[]
        {
            new DeleteOp { Ids = new[] { alphaId } },
        })).Value!;
        Assert.True(del.Success);
        var after = await DocAsync(h, map.Id);
        Assert.Equal(2, after.Elements.Count); // Root + Beta remain

        // Undo restores the exact deleted content.
        var undo = MindmapRestoreDelta.Between(after, before);
        Assert.True((await h.Service.RestoreAsync(map.Id, after.Revision, undo)).IsSuccess);

        // Exact order, not a sorted comparison: element order is root order and edge order is sibling
        // order, so a restore that put the subtree back at the end would be a different document.
        var reverted = await DocAsync(h, map.Id);
        Assert.Equal(before.Elements.Select(e => e.Id), reverted.Elements.Select(e => e.Id));
        Assert.Equal(before.Edges.Select(e => e.Id), reverted.Edges.Select(e => e.Id));
        // Content survives the round-trip.
        Assert.Equal("Alpha-1", Text(reverted.Elements.Single(e => e.Id != alphaId && Text(e) == "Alpha-1")));
    }

    [Fact]
    public async Task Undo_OfDeletingTheFirstChild_PutsItBackAsTheFirstChild()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", RootWithChildren("A", "B", "C"))).Value!;
        var before = await DocAsync(h, map.Id);
        var a = before.Elements.Single(e => Text(e) == "A").Id;

        var del = (await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[] { new DeleteOp { Ids = new[] { a } } })).Value!;
        Assert.True(del.Success);
        Assert.Equal(new[] { "B", "C" }, ChildTexts(await DocAsync(h, map.Id)));

        Assert.True((await h.Service.RestoreAsync(map.Id, del.Revision, del.Undo!)).Value!.Success);

        // A branch's colour and its place in the next arrange are both its index among the siblings,
        // so the restored node has to come back first, not last.
        var reverted = await DocAsync(h, map.Id);
        Assert.Equal(new[] { "A", "B", "C" }, ChildTexts(reverted));
        Assert.Equal(before.Elements.Select(e => e.Id), reverted.Elements.Select(e => e.Id));
        Assert.Equal(before.Edges.Select(e => e.Id), reverted.Edges.Select(e => e.Id));
    }

    [Fact]
    public async Task UndoRedoUndo_OfDeletingTheFirstChild_KeepsTheSiblingOrder()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", RootWithChildren("A", "B", "C"))).Value!;
        var before = await DocAsync(h, map.Id);
        var a = before.Elements.Single(e => Text(e) == "A").Id;

        var del = (await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[] { new DeleteOp { Ids = new[] { a } } })).Value!;
        var undone = (await h.Service.RestoreAsync(map.Id, del.Revision, del.Undo!)).Value!;
        Assert.True(undone.Success);
        var redone = (await h.Service.RestoreAsync(map.Id, undone.Revision, del.Redo!)).Value!;
        Assert.True(redone.Success);
        Assert.Equal(new[] { "B", "C" }, ChildTexts(await DocAsync(h, map.Id)));

        Assert.True((await h.Service.RestoreAsync(map.Id, redone.Revision, del.Undo!)).Value!.Success);

        Assert.Equal(new[] { "A", "B", "C" }, ChildTexts(await DocAsync(h, map.Id)));
    }

    [Fact]
    public async Task Undo_OfReparent_PutsTheNodeBackUnderItsOldParentAtItsOldPlace()
    {
        await using var h = new MindmapTestHarness();
        var outline = new List<MindmapNodeSpec>
        {
            new()
            {
                Ref = "root", Text = "Root",
                Children = new List<MindmapNodeSpec>
                {
                    new()
                    {
                        Ref = "a", Text = "A",
                        Children = new List<MindmapNodeSpec> { new() { Ref = "g", Text = "G" }, new() { Ref = "h", Text = "H" } },
                    },
                    new() { Ref = "d", Text = "D" },
                },
            },
        };
        var map = (await h.Service.CreateAsync("M", outline)).Value!;
        var before = await DocAsync(h, map.Id);
        var root = before.Elements.Single(e => Text(e) == "Root").Id;
        var a = before.Elements.Single(e => Text(e) == "A").Id;
        var g = before.Elements.Single(e => Text(e) == "G").Id;
        var edgesBefore = before.Edges.Select(e => (e.FromId, e.ToId)).ToList();

        // Outdent G: it becomes a child of the root, between A and D.
        var move = (await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[]
        {
            new MoveOp { Id = g, Under = root, After = a },
        })).Value!;
        Assert.True(move.Success);
        Assert.Equal(new[] { "A", "G", "D" }, ChildTexts(await DocAsync(h, map.Id)));

        Assert.True((await h.Service.RestoreAsync(map.Id, move.Revision, move.Undo!)).Value!.Success);

        // The hierarchy edge that puts G back under A has to return to where it was in the edge
        // array, ahead of A's edge to H, or G comes back as A's last child instead of its first.
        var reverted = await DocAsync(h, map.Id);
        Assert.Equal(edgesBefore, reverted.Edges.Select(e => (e.FromId, e.ToId)));
        Assert.Equal(before.Edges.Select(e => e.Id), reverted.Edges.Select(e => e.Id));
    }

    [Fact]
    public async Task Undo_OfDeletingTheFirstRootCluster_PutsItBackAsTheFirstRoot()
    {
        await using var h = new MindmapTestHarness();
        var outline = new List<MindmapNodeSpec>
        {
            new() { Ref = "r1", Text = "R1", Children = new List<MindmapNodeSpec> { new() { Ref = "r1a", Text = "R1A" } } },
            new() { Ref = "r2", Text = "R2" },
        };
        var map = (await h.Service.CreateAsync("M", outline)).Value!;
        var before = await DocAsync(h, map.Id);
        var r1 = before.Elements.Single(e => Text(e) == "R1").Id;

        var del = (await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[] { new DeleteOp { Ids = new[] { r1 } } })).Value!;
        Assert.True(del.Success);
        Assert.Equal(new[] { "R2" }, (await DocAsync(h, map.Id)).Elements.Select(Text));

        Assert.True((await h.Service.RestoreAsync(map.Id, del.Revision, del.Undo!)).Value!.Success);

        // Root order is element order, so the cluster has to come back ahead of R2.
        var reverted = await DocAsync(h, map.Id);
        Assert.Equal(new[] { "R1", "R1A", "R2" }, reverted.Elements.Select(Text));
        Assert.Equal(before.Elements.Select(e => e.Id), reverted.Elements.Select(e => e.Id));
        Assert.Equal(before.Edges.Select(e => e.Id), reverted.Edges.Select(e => e.Id));
    }

    [Fact]
    public async Task Redo_OfDelete_ReappliesTheDeletion()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new List<MindmapNodeSpec>
        {
            new() { Ref = "root", Text = "Root", Children = new List<MindmapNodeSpec> { new() { Ref = "c", Text = "Child" } } },
        })).Value!;

        var before = await DocAsync(h, map.Id);
        var childId = before.Elements.Single(e => Text(e) == "Child").Id;
        Assert.True((await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[] { new DeleteOp { Ids = new[] { childId } } })).Value!.Success);
        var after = await DocAsync(h, map.Id);

        // Undo (restore) then redo (re-delete).
        var undo = MindmapRestoreDelta.Between(after, before);
        var redo = MindmapRestoreDelta.Between(before, after);
        var reverted1 = await DocAsync(h, map.Id);
        Assert.True((await h.Service.RestoreAsync(map.Id, reverted1.Revision, undo)).IsSuccess);
        var restored = await DocAsync(h, map.Id);
        Assert.Equal(2, restored.Elements.Count);

        Assert.True((await h.Service.RestoreAsync(map.Id, restored.Revision, redo)).IsSuccess);
        var redone = await DocAsync(h, map.Id);
        Assert.Single(redone.Elements);
        Assert.DoesNotContain(redone.Elements, e => e.Id == childId);
    }

    [Fact]
    public async Task Undo_OfEdgeStyle_LeavesTheEdgesInTheirOriginalOrder()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new List<MindmapNodeSpec>
        {
            new()
            {
                Ref = "root", Text = "Root",
                Children = new List<MindmapNodeSpec>
                {
                    new() { Ref = "a", Text = "Alpha" },
                    new() { Ref = "b", Text = "Beta" },
                },
            },
        })).Value!;

        var before = await DocAsync(h, map.Id);
        var order = before.Edges.Select(e => e.Id).ToList();
        Assert.Equal(2, order.Count);

        Assert.True((await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[]
        {
            new SetEdgeOp { EdgeId = order[0], Style = new EdgeStyle { Color = "palette.3" } },
        })).Value!.Success);
        var after = await DocAsync(h, map.Id);
        Assert.Equal(order, after.Edges.Select(e => e.Id));

        Assert.True((await h.Service.RestoreAsync(map.Id, after.Revision, MindmapRestoreDelta.Between(after, before))).IsSuccess);

        // The array's order is the sibling order the branch colours and the layout are read from, so an
        // undo that reshuffled it would recolour the map instead of putting it back.
        var reverted = await DocAsync(h, map.Id);
        Assert.Equal(order, reverted.Edges.Select(e => e.Id));
        Assert.Null(reverted.Edges[0].Style);
    }

    [Fact]
    public async Task Undo_OfMove_RestoresPriorPositionAndPin()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new List<MindmapNodeSpec> { new() { Ref = "n", Text = "N" } })).Value!;
        var nodeId = map.Elements.Single().Id;

        var before = await DocAsync(h, map.Id);
        Assert.False(before.Elements.Single().Pinned);

        Assert.True((await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[]
        {
            new MoveOp { Id = nodeId, X = 120, Y = 240 },
        })).Value!.Success);
        var after = await DocAsync(h, map.Id);
        Assert.True(after.Elements.Single().Pinned);
        Assert.Equal(120, after.Elements.Single().X);

        var undo = MindmapRestoreDelta.Between(after, before);
        Assert.True((await h.Service.RestoreAsync(map.Id, after.Revision, undo)).IsSuccess);

        var reverted = (await DocAsync(h, map.Id)).Elements.Single();
        Assert.False(reverted.Pinned);
        Assert.Equal(0, reverted.X);
        Assert.Equal(0, reverted.Y);
    }

    [Fact]
    public async Task Restore_WithStaleRevision_IsRefusedAsAConflict()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new List<MindmapNodeSpec> { new() { Ref = "n", Text = "N" } })).Value!;
        var before = await DocAsync(h, map.Id);

        // Advance the document past the revision the delta was captured at.
        Assert.True((await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[] { new SetOp { Id = before.Elements.Single().Id, Text = "N2" } })).Value!.Success);

        var staleDelta = MindmapRestoreDelta.Between(await DocAsync(h, map.Id), before);
        var restore = await h.Service.RestoreAsync(map.Id, before.Revision, staleDelta);

        // A refusal is an answer, not a transport failure: the call succeeds and reports why it declined,
        // so the caller can tell "your undo is stale" apart from "the store is unreachable".
        Assert.True(restore.IsSuccess);
        Assert.False(restore.Value!.Success);
        Assert.Equal(MindmapEditErrorCode.RevConflict, restore.Value.Error!.Code);
        Assert.Equal("N2", Text((await DocAsync(h, map.Id)).Elements.Single()));
    }

    [Fact]
    public void Between_IdenticalDocuments_IsEmpty()
    {
        var doc = new MindmapDocument
        {
            Id = "d", Title = "T", SchemaVersion = 2, Revision = 1,
            Elements = new List<MindmapElement> { new() { Id = "n1", Kind = ElementKind.Node, Content = new TextContent { Text = "x" } } },
        };

        Assert.True(MindmapRestoreDelta.Between(doc, doc).IsEmpty);
    }

    [Fact]
    public void Between_PlacesEachRestoredRowAfterTheOneBeforeItInTheTarget()
    {
        var root = Node("root");
        var a = Node("a");
        var b = Node("b");
        var rootA = Edge("ra", "root", "a");
        var rootB = Edge("rb", "root", "b");
        var from = Doc(new[] { root, b }, new[] { rootB });
        var to = Doc(new[] { root, a, b }, new[] { rootA, rootB });

        var delta = MindmapRestoreDelta.Between(from, to);

        Assert.Equal(new[] { new MindmapRestorePlacement("a", "root") }, delta.ElementPlacements);
        // The first edge has nothing before it, and null is how the delta says "first" rather than "last".
        Assert.Equal(new[] { new MindmapRestorePlacement("ra", null) }, delta.EdgePlacements);
    }

    [Fact]
    public void Between_DoesNotPlaceARowThatIsOnlyChanged()
    {
        var from = Doc(new[] { Node("a"), Node("b") }, new[] { Edge("ab", "a", "b") });
        var to = Doc(new[] { Node("a"), Node("b") with { X = 10 } }, new[] { Edge("ab", "a", "b") with { Label = "l" } });

        var delta = MindmapRestoreDelta.Between(from, to);

        Assert.Single(delta.Elements);
        Assert.Single(delta.Edges);
        Assert.Empty(delta.ElementPlacements);
        Assert.Empty(delta.EdgePlacements);
    }

    private static List<MindmapNodeSpec> RootWithChildren(params string[] texts) => new()
    {
        new() { Text = "Root", Children = texts.Select(t => new MindmapNodeSpec { Text = t }).ToList() },
    };

    /// <summary>The root's children in sibling order, which is the order of the hierarchy edges.</summary>
    private static IEnumerable<string> ChildTexts(MindmapDocument document)
    {
        var byId = document.Elements.ToDictionary(e => e.Id);
        var root = document.Elements.Single(e => Text(e) == "Root").Id;
        return document.Edges.Where(e => e.Kind == EdgeKind.Hierarchy && e.FromId == root).Select(e => Text(byId[e.ToId])).ToList();
    }

    private static MindmapElement Node(string id) =>
        new() { Id = id, Kind = ElementKind.Node, Content = new TextContent { Text = id } };

    private static MindmapEdge Edge(string id, string from, string to) =>
        new() { Id = id, FromId = from, ToId = to, Kind = EdgeKind.Hierarchy };

    private static MindmapDocument Doc(MindmapElement[] elements, MindmapEdge[] edges) => new()
    {
        Id = "d", Title = "T", SchemaVersion = 2, Revision = 1,
        Elements = elements,
        Edges = edges,
    };

    private static string Text(MindmapElement element) => element.Content is TextContent t ? t.Text : string.Empty;
}
