using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// Toasts have no surface in the host process, so they are logged instead of
/// shown.
/// </summary>
public sealed class HeadlessToastService : IToastService
{
    private readonly ILoggerService _logger;

    public HeadlessToastService(ILoggerService logger)
    {
        _logger = logger;
    }

    public event EventHandler? NotificationHistoryChanged { add { } remove { } }

    public void SpawnToast(ToastType toastType, TimeSpan duration, string title, string description, ToastActionSpec? actions = null)
        => _logger.Info("HeadlessToastService", $"Toast ({toastType}): {title} - {description}");

    public IReadOnlyList<NotificationHistoryEntry> GetRecentNotifications(int maxCount) => [];
}
