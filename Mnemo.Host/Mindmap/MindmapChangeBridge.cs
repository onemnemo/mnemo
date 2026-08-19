using System.Text.Json;
using System.Text.Json.Nodes;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Host.Events;
using Mnemo.Infrastructure.Services.Mindmap;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// Forwards <see cref="IMindmapService.Changed"/> onto the app-events channel, so an editor that is open
/// on a map learns about an edit it did not make (an AI tool call, an import) without polling.
/// <para>
/// The notice carries the map id, the revision it landed on, the revision it applied against, and, when
/// the change is small enough to be worth sending, the delta pair and the document order. A client that
/// holds exactly the base revision folds it and pushes one undo entry; a client that does not, or that
/// gets a notice with no delta on it, refetches and starts a fresh stack. That is what makes an edit
/// nobody in the editor made still one Ctrl+Z to take back.
/// </para>
/// </summary>
public sealed class MindmapChangeBridge : IDisposable
{
    /// <summary>SSE event name; mirrored by <c>EventType.MindmapChanged</c> in the SPA.</summary>
    public const string EventName = "mindmap-changed";

    /// <summary>
    /// How many changed rows a notice will carry before it becomes a bare nudge.
    /// <para>
    /// The channel is one connection shared by every module, and a delta for an import that replaced a
    /// five-thousand element map is the whole document. Past this the client refetches, which costs the
    /// same bytes over a connection built for it and does not stall every other event behind them.
    /// </para>
    /// </summary>
    private const int MaxDeltaRows = 400;

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
            var change = Carriable(e.Change);
            _events.Publish(new AppEvent(EventName, new
            {
                mapId = e.MapId,
                revision = e.Revision,
                baseRevision = e.Change?.BaseRevision ?? e.Revision,
                kind = e.Kind.ToString().ToLowerInvariant(),
                undo = Node(change?.Undo),
                redo = Node(change?.Redo),
                order = Node(change?.Order),
            }));
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Could not publish a change for mindmap '{e.MapId}'.", ex);
        }
    }

    /// <summary>The change when it is small enough to send whole, or null when the client should refetch.</summary>
    private static MindmapEditResult? Carriable(MindmapEditResult? change)
    {
        if (change is null || change.Undo is null || change.Redo is null || change.Order is null)
            return null;

        return Rows(change.Undo) + Rows(change.Redo) > MaxDeltaRows ? null : change;
    }

    private static int Rows(MindmapRestoreDelta delta) =>
        delta.Elements.Count + delta.Edges.Count + delta.Clusters.Count +
        delta.RemoveElementIds.Count + delta.RemoveEdgeIds.Count;

    /// <summary>
    /// Pre-serializes with the mindmap's own options.
    /// <para>
    /// The event channel serializes with the plain web defaults, which know nothing about element
    /// content: a node would go out with its fields flattened and no type discriminator, and arrive as
    /// something the client cannot tell a task from a picture. Serializing here and handing over a node
    /// means the channel copies bytes that are already right.
    /// </para>
    /// </summary>
    private static JsonNode? Node(object? value) =>
        value is null ? null : JsonSerializer.SerializeToNode(value, value.GetType(), MindmapDocumentSerializer.Options);

    public void Dispose() => _maps.Changed -= OnChanged;
}
