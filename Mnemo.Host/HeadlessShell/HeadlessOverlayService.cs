using System.Collections.ObjectModel;
using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// Inert overlay service. The SPA owns overlays and dialogs natively; this binding
/// exists so services with a structural dependency (e.g. the widget context) can
/// construct. Dialogs resolve to null, the "dismissed" outcome.
/// </summary>
public sealed class HeadlessOverlayService : IOverlayService
{
    public ObservableCollection<OverlayInstance> Overlays { get; } = new();

    public void Show(string overlayName, object? parameter = null) { }
    public void Hide() { }
    public void CloseOverlay(string id) { }
    public void CloseOverlay(string id, object? result) { }
    public string CreateOverlay(object content, OverlayOptions options, string? name = null) => string.Empty;

    public Task<string?> CreateDialogAsync(string title, string message, string confirmText = "OK", string cancelText = "",
        string? confirmIconName = null, DialogSeverity severity = DialogSeverity.Default)
        => Task.FromResult<string?>(null);

    public Task<string?> CreateInputDialogAsync(string title, string confirmText = "Save", string cancelText = "Cancel",
        string? description = null, string? placeholder = null, string? initialValue = null, string? confirmIconName = null)
        => Task.FromResult<string?>(null);
}
