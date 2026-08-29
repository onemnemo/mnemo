using Mnemo.Host.Events;
using Xunit;

namespace Mnemo.Host.Tests.Events;

/// <summary>
/// Checks subscriber counts used to distinguish an unanswered shutdown request from one with no
/// listeners.
/// </summary>
public sealed class AppEventHubTests
{
    [Fact]
    public async Task PublishReportsHowManySubscribersTookTheEvent()
    {
        var hub = new AppEventHub();
        Assert.Equal(0, hub.Publish(new AppEvent("toast", null)));

        await using var first = hub.Subscribe();
        Assert.Equal(1, hub.Publish(new AppEvent("toast", null)));

        await using var second = hub.Subscribe();
        Assert.Equal(2, hub.Publish(new AppEvent("toast", null)));
    }

    [Fact]
    public async Task PublishReportsNoneOnceTheLastSubscriberHasGone()
    {
        var hub = new AppEventHub();
        var subscription = hub.Subscribe();
        Assert.Equal(1, hub.Publish(new AppEvent("toast", null)));

        await subscription.DisposeAsync();

        Assert.Equal(0, hub.Publish(new AppEvent("toast", null)));
    }

    [Fact]
    public async Task AFullBufferStillCountsAsASubscriberThatTookTheEvent()
    {
        var hub = new AppEventHub();
        await using var subscription = hub.Subscribe();

        // Exceed the buffer without reading to exercise oldest-event eviction.
        var delivered = 0;
        for (var i = 0; i < 500; i++)
            delivered = hub.Publish(new AppEvent("toast", i));

        Assert.Equal(1, delivered);
    }
}
