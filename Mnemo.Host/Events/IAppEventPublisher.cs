namespace Mnemo.Host.Events;

/// <summary>
/// Publish side of the app-events channel. Backend services (toasts, theme,
/// navigation) depend on this to push a change to the browser without knowing
/// about SSE or how many clients are connected.
/// </summary>
public interface IAppEventPublisher
{
    void Publish(AppEvent evt);
}
