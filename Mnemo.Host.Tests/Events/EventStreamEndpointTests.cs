using Mnemo.Host.Events;
using Xunit;

namespace Mnemo.Host.Tests.Events;

/// <summary>
/// Checks that event streams close on host shutdown and client disconnect.
/// </summary>
public sealed class EventStreamEndpointTests
{
    /// <summary>
    /// Bounds a stalled stream test without imposing a performance requirement.
    /// </summary>
    private static readonly TimeSpan Bound = TimeSpan.FromSeconds(3);

    [Fact]
    public async Task APublishedEventReachesTheOpenStream()
    {
        await using var harness = new EventStreamHttpHarness();
        await harness.StartAsync();

        using var response = await harness.OpenStreamAsync();
        await using var body = await response.Content.ReadAsStreamAsync();

        var greet = await EventStreamHttpHarness.ReadFrameAsync(body, Bound);
        Assert.Contains("event: hello", greet);

        harness.Hub.Publish(new AppEvent("toast", new { text = "hi" }));

        var pushed = await EventStreamHttpHarness.ReadFrameAsync(body, Bound);
        Assert.Contains("event: toast", pushed);
    }

    [Fact]
    public async Task TheStreamEndsWhenTheHostBeginsStopping()
    {
        await using var harness = new EventStreamHttpHarness();
        await harness.StartAsync();

        using var response = await harness.OpenStreamAsync();
        await using var body = await response.Content.ReadAsStreamAsync();

        // Read the greet first: a stream that never opened also ends promptly.
        var greet = await EventStreamHttpHarness.ReadFrameAsync(body, Bound);
        Assert.Contains("event: hello", greet);

        harness.Lifetime.StopApplication();

        Assert.True(
            await EventStreamHttpHarness.ReachedEndOfStreamAsync(body, Bound),
            "the stream was still open after the host began stopping");
    }

    [Fact]
    public async Task AStreamOpenedWhileTheHostIsStoppingEndsAtOnce()
    {
        await using var harness = new EventStreamHttpHarness();
        await harness.StartAsync();

        harness.Lifetime.StopApplication();

        using var response = await harness.OpenStreamAsync();
        await using var body = await response.Content.ReadAsStreamAsync();

        Assert.True(
            await EventStreamHttpHarness.ReachedEndOfStreamAsync(body, Bound),
            "a stream opened after the host began stopping stayed open");
    }

    /// <summary>
    /// Client disconnect must unsubscribe even while the host remains active.
    /// </summary>
    [Fact]
    public async Task TheStreamStillEndsWhenTheClientGoesAway()
    {
        await using var harness = new EventStreamHttpHarness();
        await harness.StartAsync();

        using var request = new CancellationTokenSource();
        var response = await harness.OpenStreamAsync(request.Token);
        var body = await response.Content.ReadAsStreamAsync();

        var greet = await EventStreamHttpHarness.ReadFrameAsync(body, Bound);
        Assert.Contains("event: hello", greet);
        Assert.Equal(1, harness.Hub.Publish(new AppEvent("toast", new { text = "hi" })));

        await request.CancelAsync();
        response.Dispose();

        Assert.True(
            await SubscriberCountFellToNoneAsync(harness, Bound),
            "the subscription outlived the client that opened it");
    }

    /// <summary>
    /// Polls until endpoint cleanup removes the subscription; client abort and cleanup are not
    /// ordered.
    /// </summary>
    private static async Task<bool> SubscriberCountFellToNoneAsync(EventStreamHttpHarness harness, TimeSpan bound)
    {
        var deadline = DateTime.UtcNow + bound;
        while (DateTime.UtcNow < deadline)
        {
            if (harness.Hub.Publish(new AppEvent("toast", new { text = "hi" })) == 0)
                return true;

            await Task.Delay(20);
        }

        return false;
    }
}
