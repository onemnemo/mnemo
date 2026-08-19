using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Tools;
using Mnemo.Infrastructure.Services.Mindmap.Tools;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// The single contract every writer answers to: revision in, write, delta out. A canvas gesture, a rename,
/// an AI tool call and an import all commit through the same gate and hand back the same shape, so whoever
/// has the map open can take any of them back without having watched it happen.
/// </summary>
public sealed class MindmapWriteContractTests
{
    private static async Task<MindmapDocument> DocAsync(MindmapTestHarness h, string id) =>
        (await h.Service.GetAsync(id)).Value!;

    private static string Text(MindmapElement element) => element.Content is TextContent t ? t.Text : string.Empty;

    // ---------------------------------------------------------------- deltas come back on the result

    [Fact]
    public async Task Apply_AnswersWithTheDeltaPairAndTheRevisionItAppliedAgainst()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new[] { new MindmapNodeSpec { Ref = "root", Text = "Root" } })).Value!;
        var before = await DocAsync(h, map.Id);

        var edit = (await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Under = before.Elements.Single().Id, Nodes = new[] { new MindmapNodeSpec { Ref = "c", Text = "Child" } } },
        })).Value!;

        Assert.True(edit.Success);
        Assert.Equal(before.Revision, edit.BaseRevision);
        Assert.Equal(before.Revision + 1, edit.Revision);
        Assert.NotNull(edit.Undo);
        Assert.NotNull(edit.Redo);
        Assert.NotNull(edit.Order);
        // The order is the committed document's, and it is what a folded delta gets sorted back to.
        Assert.Equal((await DocAsync(h, map.Id)).Elements.Select(e => e.Id), edit.Order!.Elements);
    }

    [Fact]
    public async Task Apply_ResultUndo_RestoresThePreImage()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new[] { new MindmapNodeSpec { Ref = "root", Text = "Root" } })).Value!;
        var before = await DocAsync(h, map.Id);
        var rootId = before.Elements.Single().Id;

        var edit = (await h.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Under = rootId, Nodes = new[] { new MindmapNodeSpec { Ref = "c", Text = "Child" } } },
        })).Value!;

        // The caller never reads the document to undo: the write told it what to send.
        var undone = (await h.Service.RestoreAsync(map.Id, edit.Revision, edit.Undo!)).Value!;

        Assert.True(undone.Success);
        var reverted = await DocAsync(h, map.Id);
        Assert.Equal(rootId, reverted.Elements.Single().Id);
        Assert.Empty(reverted.Edges);
    }

    // ---------------------------------------------------------------- rebase

    [Fact]
    public async Task Apply_RebasedBatch_ReportsTheRevisionItRebasedOntoNotTheOneAskedFor()
    {
        await using var h = new MindmapTestHarness();
        var (mapId, a, b) = await TwoNodesAsync(h);

        // Somebody else writes, touching only 'a'.
        await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[] { new SetOp { Id = a, Text = "A2" } });

        // A batch composed against the now-stale revision 2 that contends with nothing rebases forward.
        var rebased = (await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[] { new SetOp { Id = b, Text = "B2" } })).Value!;

        Assert.True(rebased.Success);
        Assert.Equal(4, rebased.Revision);
        // The load-bearing assertion: the caller asked for 2 and got told 3. A client that folded this
        // result into the revision-2 document it still holds would drop the other write on the floor.
        Assert.Equal(3, rebased.BaseRevision);
        Assert.NotEqual(2, rebased.BaseRevision);
    }

    [Fact]
    public async Task Apply_RebasedBatch_UndoRestoresTheDocumentItActuallyLandedOn()
    {
        await using var h = new MindmapTestHarness();
        var (mapId, a, b) = await TwoNodesAsync(h);
        await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[] { new SetOp { Id = a, Text = "A2" } });

        var rebased = (await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[] { new SetOp { Id = b, Text = "B2" } })).Value!;
        Assert.True((await h.Service.RestoreAsync(mapId, rebased.Revision, rebased.Undo!)).Value!.Success);

        // Undoing the rebased batch takes back only its own change. The other writer's edit stays, which it
        // would not if the delta had been computed from the document the caller thought it was editing.
        var reverted = await DocAsync(h, mapId);
        Assert.Equal("A2", Text(reverted.Elements.Single(e => e.Id == a)));
        Assert.NotEqual("B2", Text(reverted.Elements.Single(e => e.Id == b)));
    }

    [Fact]
    public async Task Restore_AfterSomebodyElseWrote_IsRefusedAndChangesNothing()
    {
        await using var h = new MindmapTestHarness();
        var (mapId, a, b) = await TwoNodesAsync(h);
        var edit = (await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[] { new SetOp { Id = a, Text = "A2" } })).Value!;

        // An external write lands before the user reaches for Ctrl+Z.
        await h.Service.ApplyAsync(mapId, edit.Revision, new MindmapEditOp[] { new SetOp { Id = b, Text = "B2" } });

        var stale = (await h.Service.RestoreAsync(mapId, edit.Revision, edit.Undo!)).Value!;

        Assert.False(stale.Success);
        Assert.Equal(MindmapEditErrorCode.RevConflict, stale.Error!.Code);
        var current = await DocAsync(h, mapId);
        Assert.Equal("A2", Text(current.Elements.Single(e => e.Id == a)));
        Assert.Equal("B2", Text(current.Elements.Single(e => e.Id == b)));
    }

    // ---------------------------------------------------------------- rename is an ordinary write

    [Fact]
    public async Task Rename_AnswersWithAnUndoThatPutsTheOldTitleBack()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("Before", new[] { new MindmapNodeSpec { Ref = "n", Text = "N" } })).Value!;

        var renamed = (await h.Service.RenameAsync(map.Id, "After")).Value!;
        Assert.True(renamed.Success);
        Assert.Equal("After", renamed.Redo!.Title);
        Assert.Equal("Before", renamed.Undo!.Title);

        Assert.True((await h.Service.RestoreAsync(map.Id, renamed.Revision, renamed.Undo)).Value!.Success);

        var reverted = await DocAsync(h, map.Id);
        Assert.Equal("Before", reverted.Title);
        // A title-only undo must not disturb the content it travelled with.
        Assert.Equal("N", Text(reverted.Elements.Single()));
    }

    [Fact]
    public async Task Rename_ToTheTitleItAlreadyHas_CommitsNothingAndOffersNoUndo()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("Same")).Value!;

        var renamed = (await h.Service.RenameAsync(map.Id, "Same")).Value!;

        Assert.True(renamed.Success);
        Assert.Equal(map.Revision, renamed.Revision);
        Assert.Equal(renamed.Revision, renamed.BaseRevision);
        // Pushing an entry for this would owe the user a keystroke that does nothing.
        Assert.Null(renamed.Undo);
        Assert.Null(renamed.Redo);
    }

    [Fact]
    public async Task Rename_OfAMapThatIsGone_IsRefusedRatherThanThrown()
    {
        await using var h = new MindmapTestHarness();

        var renamed = await h.Service.RenameAsync("no-such-map", "X");

        Assert.True(renamed.IsSuccess);
        Assert.False(renamed.Value!.Success);
        Assert.Equal(MindmapEditErrorCode.NotFound, renamed.Value.Error!.Code);
    }

    // ---------------------------------------------------------------- restore validates the transition

    [Fact]
    public async Task Restore_WithADeltaThatWouldStrandAnEdge_IsRefusedAndChangesNothing()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new[]
        {
            new MindmapNodeSpec { Ref = "root", Text = "Root", Children = new[] { new MindmapNodeSpec { Ref = "c", Text = "Child" } } },
        })).Value!;
        var before = await DocAsync(h, map.Id);
        var childId = before.Elements.Single(e => Text(e) == "Child").Id;

        // A delta the editor could never have produced but a corrupted history or an older client could:
        // it drops the child and says nothing about the edge that still points at it.
        var broken = new MindmapRestoreDelta { RemoveElementIds = new[] { childId } };
        var refused = (await h.Service.RestoreAsync(map.Id, before.Revision, broken)).Value!;

        Assert.False(refused.Success);
        // Refused at the write rather than quietly repaired on the next load, which is where a stranded
        // edge would otherwise disappear along with the branch the user still expected to see.
        var unchanged = await DocAsync(h, map.Id);
        Assert.Equal(before.Revision, unchanged.Revision);
        Assert.Equal(2, unchanged.Elements.Count);
        Assert.Single(unchanged.Edges);
    }

    [Fact]
    public async Task Restore_WithAnEmptyDelta_SucceedsWithoutMovingTheRevision()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var restored = (await h.Service.RestoreAsync(map.Id, map.Revision, new MindmapRestoreDelta())).Value!;

        Assert.True(restored.Success);
        Assert.Equal(map.Revision, restored.Revision);
        Assert.Null(restored.Undo);
    }

    // ---------------------------------------------------------------- import is a write like any other

    [Fact]
    public async Task Replace_OverAnExistingMap_MovesTheRevisionForwardAndIsUndoable()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("Original", new[] { new MindmapNodeSpec { Ref = "n", Text = "Keep" } })).Value!;
        var before = await DocAsync(h, map.Id);

        // A package carries whatever revision the map had when it was exported, routinely behind the copy
        // being replaced. Adopting it would make every write that follows look like it came from the future.
        var incoming = before with { Title = "Imported", Revision = 1, Elements = new List<MindmapElement>(), Edges = new List<MindmapEdge>() };
        var replaced = (await h.Service.ReplaceAsync(incoming)).Value!;

        Assert.True(replaced.Success);
        Assert.True(replaced.Revision > before.Revision);
        Assert.Equal(before.Revision, replaced.BaseRevision);

        Assert.True((await h.Service.RestoreAsync(map.Id, replaced.Revision, replaced.Undo!)).Value!.Success);
        var reverted = await DocAsync(h, map.Id);
        Assert.Equal("Original", reverted.Title);
        Assert.Equal("Keep", Text(reverted.Elements.Single()));
    }

    [Fact]
    public async Task Replace_MakesABatchComposedBeforeItConflictRatherThanRebase()
    {
        await using var h = new MindmapTestHarness();
        var (mapId, a, _) = await TwoNodesAsync(h);
        var before = await DocAsync(h, mapId);

        // The import rewrites 'a', so it is recorded as touched and a stale batch naming it contends.
        var incoming = before with
        {
            Elements = before.Elements.Select(e => e.Id == a ? e with { Content = new TextContent { Text = "imported" } } : e).ToList(),
        };
        Assert.True((await h.Service.ReplaceAsync(incoming)).Value!.Success);

        var stale = (await h.Service.ApplyAsync(mapId, 2, new MindmapEditOp[] { new SetOp { Id = a, Text = "user typed this" } })).Value!;

        Assert.False(stale.Success);
        Assert.Equal(MindmapEditErrorCode.RevConflict, stale.Error!.Code);
        Assert.Contains(a, stale.Error.ContendedIds!);
    }

    [Fact]
    public async Task Replace_OfAMapThatDoesNotExistYet_ReplaysFromNothingWithItsTitle()
    {
        await using var h = new MindmapTestHarness();
        var source = (await h.Service.CreateAsync("Fresh", new[] { new MindmapNodeSpec { Ref = "n", Text = "N" } })).Value!;
        var document = await DocAsync(h, source.Id);

        await using var target = new MindmapTestHarness();
        var stored = (await target.Service.ReplaceAsync(document)).Value!;

        Assert.True(stored.Success);
        Assert.Equal(0, stored.BaseRevision);
        // A pre-image with the same title would diff the title away and the replay would land a nameless map.
        Assert.Equal("Fresh", stored.Redo!.Title);
    }

    [Fact]
    public async Task Replace_WithABrokenDocument_IsRefusedAndLeavesTheStoredMapAlone()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M", new[] { new MindmapNodeSpec { Ref = "n", Text = "Keep" } })).Value!;
        var before = await DocAsync(h, map.Id);

        var broken = before with
        {
            Edges = new List<MindmapEdge> { new() { Id = "e-bad", FromId = before.Elements.Single().Id, ToId = "not-here" } },
        };
        var refused = (await h.Service.ReplaceAsync(broken)).Value!;

        Assert.False(refused.Success);
        var unchanged = await DocAsync(h, map.Id);
        Assert.Equal(before.Revision, unchanged.Revision);
        Assert.Equal("Keep", Text(unchanged.Elements.Single()));
    }

    // ---------------------------------------------------------------- delete takes the gate

    [Fact]
    public async Task Delete_RacingWriters_LeavesNoMapAndNoTornWrite()
    {
        await using var h = new MindmapTestHarness();
        var (mapId, a, _) = await TwoNodesAsync(h);

        // Twenty edits and a delete released together. The per-map gate is what keeps the delete from
        // landing between an edit's read and its save, which would write the row back after removing it.
        var writes = Enumerable.Range(0, 20)
            .Select(i => h.Service.ApplyAsync(mapId, 2 + i, new MindmapEditOp[] { new SetOp { Id = a, Text = $"A{i}" } }))
            .ToList();
        var deletion = h.Service.DeleteAsync(mapId);

        await Task.WhenAll(writes);
        Assert.True((await deletion).IsSuccess);

        foreach (var write in writes)
        {
            var result = await write;
            // Either it committed before the delete or it was refused; never a throw, never a half write.
            Assert.True(result.IsSuccess);
            Assert.True(result.Value!.Success || result.Value.Error is not null);
        }

        Assert.False((await h.Service.GetAsync(mapId)).IsSuccess);
        Assert.DoesNotContain((await h.Service.ListAsync()).Value!, m => m.Id == mapId);
    }

    // ---------------------------------------------------------------- headless writers are undoable

    [Fact]
    public async Task ToolEdit_IsAnnouncedWithADeltaTheOpenEditorCanUndo()
    {
        await using var h = new MindmapTestHarness();
        var (mapId, a, _) = await TwoNodesAsync(h);
        var before = await DocAsync(h, mapId);

        MindmapChangedEventArgs? seen = null;
        h.Service.Changed += (_, e) => seen = e;

        var tool = new MindmapToolService(h.Service);
        var edited = await tool.EditMindmapAsync(new EditMindmapParameters
        {
            MapId = mapId,
            Rev = before.Revision,
            Ops = JsonDocument.Parse($$"""[{ "op": "set", "id": "{{a}}", "t": "written by the assistant" }]""").RootElement,
        });

        Assert.True(edited.Ok);
        Assert.NotNull(seen);
        // Without this the only honest answer to an assistant rewriting the map is a refetch and an empty
        // undo stack, which leaves the user with nothing to press.
        Assert.NotNull(seen!.Change);
        Assert.Equal(before.Revision, seen.Change!.BaseRevision);

        Assert.True((await h.Service.RestoreAsync(mapId, seen.Change.Revision, seen.Change.Undo!)).Value!.Success);
        Assert.NotEqual("written by the assistant", Text((await DocAsync(h, mapId)).Elements.Single(e => e.Id == a)));
    }

    /// <summary>A map at revision 2 with two independent root nodes, so a stale batch can miss or hit.</summary>
    private static async Task<(string MapId, string A, string B)> TwoNodesAsync(MindmapTestHarness h)
    {
        var map = (await h.Service.CreateAsync("M")).Value!;
        var seed = (await h.Service.ApplyAsync(map.Id, 1, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new[] { new MindmapNodeSpec { Ref = "a", Text = "A" }, new MindmapNodeSpec { Ref = "b", Text = "B" } } },
        })).Value!;
        return (map.Id, seed.CreatedIds["a"], seed.CreatedIds["b"]);
    }
}
