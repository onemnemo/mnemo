using Mnemo.Core.Models.Mindmap;
using Mnemo.Host.Mindmap;
using Xunit;

namespace Mnemo.Host.Tests.Mindmap;

/// <summary>
/// Arrange against documents no write path would produce.
/// <para>
/// A write is refused only when the state it replaced was sound, so a map that was already broken stays
/// openable on purpose, and a map can also arrive from a package or from a build that stored a shape this
/// one does not. Arrange runs on whatever it is handed, and the user reaches for it precisely when a map
/// looks wrong, so it is the one thing that must not fall over on a wrong one.
/// </para>
/// </summary>
public sealed class MindmapArrangeMalformedGraphTests
{
    [Fact]
    public async Task ACycleUnderARootIsWalkedOnceRatherThanForever()
    {
        // Root to A, A to B, B back to A. Following the edges without remembering where the walk has
        // already been never returns, and grows the node list it is building until the process dies.
        var document = Document(
            Nodes("root", "a", "b"),
            Edge("e1", "root", "a"),
            Edge("e2", "a", "b"),
            Edge("e3", "b", "a"));

        var moved = MovedIds(await ArrangeAsync(document));

        Assert.Equal(moved.Distinct().Count(), moved.Count);
        Assert.All(moved, id => Assert.Contains(id, new[] { "root", "a", "b" }));
    }

    [Fact]
    public async Task AClosedCycleWithNoRootArrangesNothingInsteadOfHanging()
    {
        // Every node has a parent, so there is no root to lay a tree out from. Nothing here can be
        // tidied, and moving nothing is the honest answer to that.
        var document = Document(
            Nodes("a", "b"),
            Edge("e1", "a", "b"),
            Edge("e2", "b", "a"));

        var ops = await ArrangeAsync(document);

        Assert.Empty(ops);
    }

    [Fact]
    public async Task ADuplicateElementIdIsToleratedRatherThanThrown()
    {
        // Building the node index by key threw on the repeat, which came back as a failed request: the
        // user could see the map but could not tidy it, with nothing saying why.
        var document = Document(
            new[] { Node("root"), Node("a"), Node("a") },
            Edge("e1", "root", "a"));

        var ops = await ArrangeAsync(document);

        Assert.NotEmpty(ops);
    }

    [Fact]
    public async Task ANodeTwoRootsReachIsLaidOutUnderOneOfThem()
    {
        // A layout is handed one cluster at a time and places a child against the parent in that cluster.
        // A node claimed by two roots would otherwise be in both node lists, naming whichever parent the
        // last edge happened to record, which can be a node the layout was never given.
        var document = Document(
            Nodes("r1", "r2", "shared", "leaf"),
            Edge("e1", "r1", "shared"),
            Edge("e2", "r2", "shared"),
            Edge("e3", "shared", "leaf"));

        var moved = MovedIds(await ArrangeAsync(document));

        // The subtree below the shared node was laid out rather than left where it was, which is what
        // being dropped from every cluster looks like from here.
        Assert.Contains("leaf", moved);
        Assert.Equal(moved.Distinct().Count(), moved.Count);
    }

    [Fact]
    public async Task AnEdgeNamingANodeThatIsNotThereIsIgnored()
    {
        var document = Document(
            Nodes("root", "a"),
            Edge("e1", "root", "a"),
            Edge("e2", "root", "missing"),
            Edge("e3", "gone", "a"));

        var ops = await ArrangeAsync(document);

        Assert.NotEmpty(ops);
    }

    // ---- Plumbing ----------------------------------------------------------------------------

    private static async Task<IReadOnlyList<MindmapEditOp>> ArrangeAsync(MindmapDocument document)
    {
        await using var h = new MindmapHostHarness();
        return await MindmapArrange.ComputeAsync(
            document,
            new Dictionary<string, MindmapArrangeSize>(StringComparer.Ordinal),
            null,
            h.Layout,
            CancellationToken.None);
    }

    private static List<string> MovedIds(IReadOnlyList<MindmapEditOp> ops) =>
        ops.OfType<MoveOp>().Select(op => op.Id).ToList();

    private static MindmapDocument Document(IReadOnlyList<MindmapElement> elements, params MindmapEdge[] edges) =>
        new() { Id = Guid.NewGuid().ToString(), Elements = elements, Edges = edges };

    private static MindmapElement[] Nodes(params string[] ids) => ids.Select(Node).ToArray();

    private static MindmapElement Node(string id) =>
        new() { Id = id, Kind = ElementKind.Node, Content = new TextContent { Text = id } };

    private static MindmapEdge Edge(string id, string from, string to) =>
        new() { Id = id, FromId = from, ToId = to, Kind = EdgeKind.Hierarchy };
}
