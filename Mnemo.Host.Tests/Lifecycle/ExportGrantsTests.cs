using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Host.Lifecycle;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// What stands between a page and an arbitrary write. The rules are narrow on purpose: a token is
/// good once, only for the destination it was minted against, and only for a while.
/// </summary>
public sealed class ExportGrantsTests
{
    private static ExportTarget Target(string name = "deck.mnemo") =>
        new(Path.GetTempPath(), Path.Combine(Path.GetTempPath(), name));

    [Fact]
    public void HandsBackTheDestinationItWasIssuedFor()
    {
        var grants = new ExportGrants();
        var target = Target();

        Assert.True(grants.TryConsume(grants.Issue(target), out var consumed));
        Assert.Equal(target, consumed);
    }

    [Fact]
    public void SpendsTheTokenSoASecondWriteIsRefused()
    {
        var grants = new ExportGrants();
        var token = grants.Issue(Target());

        Assert.True(grants.TryConsume(token, out _));
        Assert.False(grants.TryConsume(token, out var second));
        Assert.Null(second);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-token")]
    public void RefusesAnythingItDidNotIssue(string? token)
    {
        var grants = new ExportGrants();
        grants.Issue(Target());

        Assert.False(grants.TryConsume(token, out var consumed));
        Assert.Null(consumed);
    }

    [Fact]
    public async Task RefusesATokenPresentedAfterItLapsed()
    {
        var grants = new ExportGrants(TimeSpan.FromMilliseconds(20));
        var token = grants.Issue(Target());

        await Task.Delay(60);

        Assert.False(grants.TryConsume(token, out _));
    }

    [Fact]
    public void KeepsGrantsApartSoOneTokenCannotReachAnothersDestination()
    {
        var grants = new ExportGrants();
        var first = grants.Issue(Target("first.mnemo"));
        var second = grants.Issue(Target("second.mnemo"));

        Assert.NotEqual(first, second);
        Assert.True(grants.TryConsume(second, out var consumed));
        Assert.EndsWith("second.mnemo", consumed!.FullPath);
    }

    [Fact]
    public void MintsTokensThatAreNotGuessableFromEachOther()
    {
        var grants = new ExportGrants();

        var tokens = Enumerable.Range(0, 200).Select(_ => grants.Issue(Target())).ToArray();

        Assert.Equal(tokens.Length, tokens.Distinct(StringComparer.Ordinal).Count());
        Assert.All(tokens, token => Assert.Matches("^[0-9a-f]{32}$", token));
    }

    [Fact]
    public async Task DoesNotAccumulateGrantsNobodySpent()
    {
        // Issuing is the only thing that grows the collection, so it is the only place a sweep can
        // run without a timer. A session of abandoned exports must not pile up destinations.
        var grants = new ExportGrants(TimeSpan.FromMilliseconds(20));
        var stale = Enumerable.Range(0, 5).Select(_ => grants.Issue(Target())).ToArray();

        await Task.Delay(60);
        var fresh = grants.Issue(Target());

        Assert.All(stale, token => Assert.False(grants.TryConsume(token, out _)));
        Assert.True(grants.TryConsume(fresh, out _));
    }
}
