using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

namespace Mnemo.Infrastructure.Tests.Packaging;

public sealed class PackageFolderTreeTests
{
    private sealed record F(string Id, string? Parent);

    [Fact]
    public void Subtree_TakesEveryDepth_AndIgnoresUnknownRoots()
    {
        F[] all = [new("a", null), new("b", "a"), new("c", "b"), new("x", null)];

        var ids = PackageFolderTree.Subtree(all, f => f.Id, f => f.Parent, ["a", "missing"]);

        Assert.Equal(["a", "b", "c"], ids.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Subtree_WalksALoopOnce()
    {
        F[] all = [new("a", "b"), new("b", "a")];

        Assert.Equal(["a", "b"], PackageFolderTree.Subtree(all, f => f.Id, f => f.Parent, ["a"]).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void ParentFirst_PutsParentsAheadOfChildren_AndMarksTheRoots()
    {
        F[] package = [new("c", "b"), new("b", "a"), new("a", "outside"), new("z", null)];

        var ordered = PackageFolderTree.ParentFirst(package, f => f.Id, f => f.Parent);

        var order = ordered.Select(o => o.Folder.Id).ToList();
        Assert.True(order.IndexOf("a") < order.IndexOf("b"));
        Assert.True(order.IndexOf("b") < order.IndexOf("c"));
        Assert.Equal(["a", "z"], ordered.Where(o => o.IsRoot).Select(o => o.Folder.Id).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void ParentFirst_BreaksALoop_AtOneFolder()
    {
        F[] package = [new("x", "y"), new("y", "x"), new("self", "self")];

        var ordered = PackageFolderTree.ParentFirst(package, f => f.Id, f => f.Parent);

        Assert.Equal(3, ordered.Count);
        Assert.Contains(ordered, o => o.Folder.Id == "self" && o.IsRoot);
        Assert.Single(ordered, o => o.Folder.Id is "x" or "y" && o.IsRoot);
    }
}
