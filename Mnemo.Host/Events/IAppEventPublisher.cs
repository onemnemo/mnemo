namespace Mnemo.Host.Events;

/// <summary>
/// Publish side of the app-events channel. Backend services (toasts, theme,
/// navigation) depend on this to push a change to the browser without knowing
/// about SSE or how many clients are connected.
/// </summary>
public interface IAppEventPublisher
{
    /// <summary>
    /// Publishes to all subscribers and returns the number accepting the write. Full buffers evict
    /// their oldest event and still count. Acceptance does not confirm client delivery.
    /// </summary>
    int Publish(AppEvent evt);
}
