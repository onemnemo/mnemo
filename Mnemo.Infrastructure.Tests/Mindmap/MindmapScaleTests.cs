using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Xunit;
using Xunit.Abstractions;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// The persistence path against maps far larger than the ones anybody has today.
/// <para>
/// These assert that a big map is still correct, not that it is fast: a timing assertion on a shared
/// build machine fails for reasons that have nothing to do with the code. The elapsed times go to the
/// test output so a run can be read for them, and each test reports both ends of its own run, since a
/// number is only worth comparing against another number the same process produced. The two shapes are
/// the ones that cost the most: a deep chain, which validation climbs to the root from every node, and
/// a wide map, whose whole document is rewritten on every edit.
/// </para>
/// </summary>
public sealed class MindmapScaleTests
{
    private readonly ITestOutputHelper _output;

    public MindmapScaleTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public async Task AWideMapOfFiveThousandNodesWritesAndReadsBack()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("Wide")).Value!;

        var batches = new List<double>();
        var watch = Stopwatch.StartNew();
        var revision = map.Revision;
        for (var batch = 0; batch < 50; batch++)
        {
            var nodes = Enumerable.Range(0, 100)
                .Select(i => new MindmapNodeSpec { Text = $"n{batch}-{i}" })
                .ToArray();
            var before = watch.Elapsed;
            var applied = await h.Service.ApplyAsync(map.Id, revision, new MindmapEditOp[]
            {
                new AddNodesOp { Nodes = nodes },
            });
            Assert.True(applied.IsSuccess && applied.Value!.Success, "a batch was refused");
            batches.Add((watch.Elapsed - before).TotalMilliseconds);
            revision = applied.Value!.Revision;
        }
        var written = watch.Elapsed;

        watch.Restart();
        var entry = (await h.Service.GetLibraryAsync()).Value!.Single();
        var read = watch.Elapsed;

        // The proof that the numbers above measured real work: every node is there afterwards.
        Assert.Equal(5000, entry.Document.Elements.Count(e => e.Kind == ElementKind.Node));
        _output.WriteLine($"wide 5000 nodes: 50 write batches in {written.TotalMilliseconds:F0} ms, library read in {read.TotalMilliseconds:F0} ms");

        // Each write rewrites the whole document, so what matters is how the cost of one edit grows as
        // the map does. The two ends of the same run say whether that growth is linear or worse.
        _output.WriteLine($"first five batches (100 to 500 nodes): {string.Join(", ", batches.Take(5).Select(b => $"{b:F0} ms"))}");
        _output.WriteLine($"last five batches (4600 to 5000 nodes): {string.Join(", ", batches.TakeLast(5).Select(b => $"{b:F0} ms"))}");
    }

    [Fact]
    public async Task ADeepChainOfTwoThousandNodesWritesAndReadsBack()
    {
        // Every write validates the whole document, and the cycle check climbs from each node to its
        // root, so a chain is the shape where that walk costs the most.
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("Deep")).Value!;
        var seeded = await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new[] { new MindmapNodeSpec { Ref = "root", Text = "root" } } },
        });
        var revision = seeded.Value!.Revision;
        var parent = seeded.Value.CreatedIds["root"];

        var writes = new List<double>();
        var watch = Stopwatch.StartNew();
        for (var depth = 0; depth < 2000; depth++)
        {
            var before = watch.Elapsed;
            var applied = await h.Service.ApplyAsync(map.Id, revision, new MindmapEditOp[]
            {
                new AddNodesOp { Under = parent, Nodes = new[] { new MindmapNodeSpec { Ref = "n", Text = $"d{depth}" } } },
            });
            Assert.True(applied.IsSuccess && applied.Value!.Success, $"depth {depth} was refused");
            writes.Add((watch.Elapsed - before).TotalMilliseconds);
            revision = applied.Value!.Revision;
            parent = applied.Value.CreatedIds["n"];
        }
        var written = watch.Elapsed;

        watch.Restart();
        var loaded = (await h.Service.GetAsync(map.Id)).Value!;
        var read = watch.Elapsed;

        Assert.Equal(2001, loaded.Elements.Count(e => e.Kind == ElementKind.Node));
        Assert.Equal(2000, loaded.Edges.Count(e => e.Kind == EdgeKind.Hierarchy));
        _output.WriteLine($"deep 2000 nodes: 2000 single node writes in {written.TotalMilliseconds:F0} ms, map read in {read.TotalMilliseconds:F0} ms");

        // The validation climbs to the root from every node that has a parent, so on a chain the same
        // run should show one edit costing steeply more at the deep end than at the shallow one.
        _output.WriteLine($"mean of writes 1 to 100: {writes.Take(100).Average():F2} ms");
        _output.WriteLine($"mean of writes 1901 to 2000: {writes.TakeLast(100).Average():F2} ms");
    }

    [Fact]
    public async Task ALibraryOfManyLargeMapsLoads()
    {
        // The gallery reads every map's whole document, not a header, because it draws a preview and
        // counts from it. This is what that costs when the maps are big.
        await using var h = new MindmapTestHarness();
        for (var i = 0; i < 20; i++)
        {
            var map = (await h.Service.CreateAsync($"Map {i}")).Value!;
            var nodes = Enumerable.Range(0, 250).Select(n => new MindmapNodeSpec { Text = $"n{n}" }).ToArray();
            await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[] { new AddNodesOp { Nodes = nodes } });
        }

        var watch = Stopwatch.StartNew();
        var library = (await h.Service.GetLibraryAsync()).Value!;
        var elapsed = watch.Elapsed;

        Assert.Equal(20, library.Count);
        Assert.All(library, entry => Assert.Equal(250, entry.Document.Elements.Count(e => e.Kind == ElementKind.Node)));
        _output.WriteLine($"library of 20 maps of 250 nodes: read in {elapsed.TotalMilliseconds:F0} ms");
    }

    [Fact]
    public async Task ADamagedMapAmongManyCostsOnlyItself()
    {
        await using var h = new MindmapTestHarness();
        var ids = new List<string>();
        for (var i = 0; i < 20; i++)
            ids.Add((await h.Service.CreateAsync($"Map {i}")).Value!.Id);

        await h.DamageAsync("UPDATE Mindmaps SET Doc = 'not json at all' WHERE Id = $id;", ids[7]);

        var library = (await h.Service.GetLibraryAsync()).Value!;

        Assert.Equal(19, library.Count);
        Assert.DoesNotContain(library, entry => entry.Document.Id == ids[7]);
    }
}
