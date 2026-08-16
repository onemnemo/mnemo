using System.Threading.Channels;

namespace Mnemo.Host.Events;

/// <summary>Subscribe side of the app-events channel, consumed by the SSE endpoint.</summary>
public interface IAppEventSource
{
    IEventSubscription Subscribe();
}

/// <summary>A single client's event feed; disposing detaches it from the hub.</summary>
public interface IEventSubscription : IAsyncDisposable
{
    ChannelReader<AppEvent> Reader { get; }
}
