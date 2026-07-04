using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Threading.Tasks;

namespace Mnemo.Core.Services;

public enum AnchorPosition
{
    TopLeft, 
    TopRight, 
    BottomLeft, 
    BottomRight, 
    TopCenter, 
    BottomCenter, 
    LeftCenter, 
    RightCenter
}

public class OverlayOptions
{
    public object? AnchorControl { get; set; } 
    public AnchorPosition AnchorPosition { get; set; }
    /// <summary>When set with AnchorPointY, positions overlay by this point (e.g. selection center) in top-level coordinates instead of AnchorControl.</summary>
    public double? AnchorPointX { get; set; }
    public double? AnchorPointY { get; set; }
    public object? AnchorOffset { get; set; } 
    public object Margin { get; set; } = "0";
    public bool CloseOnOutsideClick { get; set; } = true;
    /// <summary>When true, pressing Escape closes this overlay. Set to false for mandatory flows (e.g. onboarding).</summary>
    public bool CloseOnEscape { get; set; } = true;
    public bool ShowBackdrop { get; set; } = true;
    public object HorizontalAlignment { get; set; } = "Center";
    public object VerticalAlignment { get; set; } = "Center";
    public object? BackdropBrush { get; set; }
    public string? BackdropColor { get; set; }
    public double BackdropOpacity { get; set; } = 0.5;
    /// <summary>When set, closing the overlay with this id also closes this overlay (nested popup).</summary>
    public string? ParentOverlayId { get; set; }
}

public class OverlayInstance : INotifyPropertyChanged
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = string.Empty;
    public object? Content { get; set; }
    public OverlayOptions Options { get; set; } = new();
    public int ZIndex { get; set; }

    public event PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>
/// Visual weight of a confirmation dialog's primary button: accent for ordinary
/// confirms, destructive (red) only for irreversible actions such as deletes.
/// </summary>
public enum DialogSeverity
{
    Default,
    Destructive
}

public interface IOverlayService
{
    ObservableCollection<OverlayInstance> Overlays { get; }
    void Show(string overlayName, object? parameter = null);
    void Hide();
    void CloseOverlay(string id);
    void CloseOverlay(string id, object? result);
    string CreateOverlay(object content, OverlayOptions options, string? name = null);
    Task<string?> CreateDialogAsync(string title, string message, string confirmText = "OK", string cancelText = "", object? icon = null, object? parameter = null, DialogSeverity severity = DialogSeverity.Default);
}
