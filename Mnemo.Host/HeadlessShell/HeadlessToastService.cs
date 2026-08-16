using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Events;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// The host has no native toast surface, so toasts are logged and forwarded to the
/// SPA over the app-events channel, where the browser's toast host renders them.
/// </summary>
public sealed class HeadlessToastService : IToastService
{
    private readonly ILoggerService _logger;
    private readonly IAppEventPublisher _events;

    public HeadlessToastService(ILoggerService logger, IAppEventPublisher events)
    {
        _logger = logger;
        _events = events;
    }

    public event EventHandler? NotificationHistoryChanged { add { } remove { } }

    public void SpawnToast(ToastType toastType, TimeSpan duration, string title, string description, ToastActionSpec? actions = null)
    {
        _logger.Info("HeadlessToastService", $"Toast ({toastType}): {title} - {description}");
        // Actions carry UI callbacks that cannot cross the wire, so the toast is
        // forwarded without them until server-driven actions get their own round-trip.
        _events.Publish(new AppEvent("toast", ToastEventDto.From(toastType, duration, title, description)));
    }

    public IReadOnlyList<NotificationHistoryEntry> GetRecentNotifications(int maxCount) => [];
}
