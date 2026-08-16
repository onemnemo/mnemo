using Mnemo.Host.Assets;
using Xunit;

namespace Mnemo.Host.Tests.Assets;

public sealed class AssetSessionRegistryTests
{
    [Fact]
    public void CountsOpenSessions()
    {
        var registry = new AssetSessionRegistry();
        Assert.Equal(0, registry.ActiveCount);

        var first = registry.Open();
        var second = registry.Open();
        Assert.Equal(2, registry.ActiveCount);

        Assert.True(registry.Close(first));
        Assert.Equal(1, registry.ActiveCount);
        Assert.True(registry.Close(second));
        Assert.Equal(0, registry.ActiveCount);
    }

    [Fact]
    public void ClosingTwiceOrUnknownReportsFalse()
    {
        var registry = new AssetSessionRegistry();
        var session = registry.Open();

        Assert.True(registry.Close(session));
        Assert.False(registry.Close(session));
        Assert.False(registry.Close("nonsense"));
        Assert.Equal(0, registry.ActiveCount);
    }
}
