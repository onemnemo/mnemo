using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models.MindmapV2;
using Xunit;

namespace Mnemo.Infrastructure.Tests.MindmapV2;

public sealed class MindmapConcurrencyTests
{
    [Fact]
    public async Task StaleRevision_RebasesWhenNoContention()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        // rev 1 -> 2: two independent root nodes.
        var seed = (await h.Service.ApplyAsync(map.Id, 1, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new List<MindmapNodeSpec> { new() { Ref = "a" }, new() { Ref = "b" } } },
        })).Value!;
        var a = seed.CreatedIds["a"];
        var b = seed.CreatedIds["b"];

        // rev 2 -> 3: touch only 'a'.
        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[] { new SetOp { Id = a, Text = "A2" } });

        // A batch built against the now-stale rev 2 that references only 'b' rebases cleanly.
        var rebased = (await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new SetOp { Id = b, Text = "B2" },
        })).Value!;

        Assert.True(rebased.Success);
        Assert.Equal(4, rebased.Revision);
    }

    [Fact]
    public async Task StaleRevision_ConflictsWhenReferencedIdChanged()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var seed = (await h.Service.ApplyAsync(map.Id, 1, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new List<MindmapNodeSpec> { new() { Ref = "a" } } },
        })).Value!;
        var a = seed.CreatedIds["a"];

        // rev 2 -> 3: touch 'a'.
        await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[] { new SetOp { Id = a, Text = "A2" } });

        // A stale batch (rev 2) that also references 'a' genuinely contends.
        var conflict = (await h.Service.ApplyAsync(map.Id, 2, new MindmapEditOp[]
        {
            new SetOp { Id = a, Text = "A3" },
        })).Value!;

        Assert.False(conflict.Success);
        Assert.Equal(MindmapEditErrorCode.RevConflict, conflict.Error!.Code);
        Assert.Contains(a, conflict.Error.ContendedIds!);
    }
}
