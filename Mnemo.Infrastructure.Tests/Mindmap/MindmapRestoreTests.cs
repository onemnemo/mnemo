using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Command-based undo/redo exercised through the service: an edit's reversing/replaying deltas are
/// computed by <see cref="MindmapRestoreDelta.Between"/> — exactly as the editor view model does — and
/// applied via <c>RestoreAsync</c>. The delete case is the load-bearing one: undo must restore the exact
/// elements, edges and ids, since these back real users' work.
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

        var reverted = await DocAsync(h, map.Id);
        Assert.Equal(before.Elements.Count, reverted.Elements.Count);
        Assert.Equal(
            before.Elements.Select(e => e.Id).OrderBy(x => x),
            reverted.Elements.Select(e => e.Id).OrderBy(x => x));
        Assert.Equal(
            before.Edges.Select(e => e.Id).OrderBy(x => x),
            reverted.Edges.Select(e => e.Id).OrderBy(x => x));
        // Content survives the round-trip.
        Assert.Equal("Alpha-1", Text(reverted.Elements.Single(e => e.Id != alphaId && Text(e) == "Alpha-1")));
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
    public async Task Restore_WithStaleRevision_Fails()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new List<MindmapNodeSpec> { new() { Ref = "n", Text = "N" } })).Value!;
        var before = await DocAsync(h, map.Id);

        // Advance the document past the revision the delta was captured at.
        Assert.True((await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[] { new SetOp { Id = before.Elements.Single().Id, Text = "N2" } })).Value!.Success);

        var staleDelta = MindmapRestoreDelta.Between(await DocAsync(h, map.Id), before);
        var restore = await h.Service.RestoreAsync(map.Id, before.Revision, staleDelta);
        Assert.False(restore.IsSuccess);
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

    private static string Text(MindmapElement element) => element.Content is TextContent t ? t.Text : string.Empty;
}
