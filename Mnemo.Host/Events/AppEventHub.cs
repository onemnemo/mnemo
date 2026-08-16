using System.Collections.Concurrent;
using System.Threading.Channels;

namespace Mnemo.Host.Events;

/// <summary>
/// In-process fan-out for <see cref="AppEvent"/>s. Each subscriber gets its own
/// bounded channel; a slow or stalled client drops its oldest events rather than
/// back-pressuring the publisher or any other client. Purely in-memory - events
/// are transient and are not replayed to clients that connect later.
/// </summary>
public sealed class AppEventHub : IAppEventPublisher, IAppEventSource
{
    private const int PerClientBuffer = 128;

    private readonly ConcurrentDictionary<Guid, Channel<AppEvent>> _subscribers = new();

    public void Publish(AppEvent evt)
    {
        foreach (var channel in _subscribers.Values)
        {
            // Bounded + DropOldest, so a stuck reader never blocks the publisher.
            channel.Writer.TryWrite(evt);
        }
    }

    public IEventSubscription Subscribe()
    {
        var channel = Channel.CreateBounded<AppEvent>(new BoundedChannelOptions(PerClientBuffer)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });
        var id = Guid.NewGuid();
        _subscribers[id] = channel;
        return new Subscription(this, id, channel.Reader);
    }

    private void Unsubscribe(Guid id)
    {
        if (_subscribers.TryRemove(id, out var channel))
            channel.Writer.TryComplete();
    }

    private sealed class Subscription : IEventSubscription
    {
        private readonly AppEventHub _hub;
        private readonly Guid _id;

        public Subscription(AppEventHub hub, Guid id, ChannelReader<AppEvent> reader)
        {
            _hub = hub;
            _id = id;
            Reader = reader;
        }

        public ChannelReader<AppEvent> Reader { get; }

        public ValueTask DisposeAsync()
        {
            _hub.Unsubscribe(_id);
            return ValueTask.CompletedTask;
        }
    }
}
