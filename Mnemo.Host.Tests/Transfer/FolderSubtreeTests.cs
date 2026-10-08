using Mnemo.Host.Transfer;

namespace Mnemo.Host.Tests.Transfer;

public sealed class FolderSubtreeTests
{
    private sealed record F(string Id, string? Parent);

    [Fact]
    public void Of_TakesEveryFolderBeneathTheRoots()
    {
        F[] folders = [new("a", null), new("b", "a"), new("c", "b"), new("x", null)];

        Assert.Equal(["a", "b", "c"], FolderSubtree.Of(folders, f => f.Id, f => f.Parent, ["a"]).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Of_WalksALoopOnce()
    {
        F[] folders = [new("a", "b"), new("b", "a")];

        Assert.Equal(["a", "b"], FolderSubtree.Of(folders, f => f.Id, f => f.Parent, ["b"]).Order(StringComparer.Ordinal));
    }
}
