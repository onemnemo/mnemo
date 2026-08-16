using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Host.Events;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// Forwards <see cref="IMindmapService.Changed"/> onto the app-events channel, so an editor that is open
/// on a map learns about an edit it did not make (an AI tool call, an import) without polling.
/// <para>
/// The push carries the map id, the new revision and the kind, and nothing else. It is a nudge, not a
/// patch: the client compares the revision against its own and refetches only if it is behind, which is
/// also how it ignores the echo of its own edit without the server having to know who sent what.
/// </para>
/// </summary>
public sealed class MindmapChangeBridge : IDisposable
{
    /// <summary>SSE event name; mirrored by <c>EventType.MindmapChanged</c> in the SPA.</summary>
    public const string EventName = "mindmap-changed";

    private readonly IMindmapService _maps;
    private readonly IAppEventPublisher _events;
    private readonly ILoggerService _logger;

    public MindmapChangeBridge(IMindmapService maps, IAppEventPublisher events, ILoggerService logger)
    {
        _maps = maps;
        _events = events;
        _logger = logger;
        _maps.Changed += OnChanged;
    }

    private void OnChanged(object? sender, MindmapChangedEventArgs e)
    {
        // The service raises this on the committing thread and documents that a throwing handler
        // corrupts nothing but is swallowed and logged. Publishing is cheap and non-blocking, but the
        // contract is the service's to keep, not ours to test at runtime.
        try
        {
            _events.Publish(new AppEvent(EventName, new
            {
                mapId = e.MapId,
                revision = e.Revision,
                kind = e.Kind.ToString().ToLowerInvariant(),
            }));
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Could not publish a change for mindmap '{e.MapId}'.", ex);
        }
    }

    public void Dispose() => _maps.Changed -= OnChanged;
}
