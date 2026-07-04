using Avalonia;
using Avalonia.Controls;

namespace Mnemo.UI.Controls;

/// <summary>
/// The standard button for new/rehauled UI: adds a leading icon slot and a loading
/// state on top of stock <see cref="Button"/>. Variant (primary/secondary/ghost/destructive/topbar)
/// is selected the same way as stock Button, via style <c>Classes</c>.
/// </summary>
public class AppButton : Button
{
    public static readonly StyledProperty<bool> IsLoadingProperty =
        AvaloniaProperty.Register<AppButton, bool>(nameof(IsLoading));

    public static readonly StyledProperty<string?> IconNameProperty =
        AvaloniaProperty.Register<AppButton, string?>(nameof(IconName));

    public static readonly StyledProperty<double> IconSizeProperty =
        AvaloniaProperty.Register<AppButton, double>(nameof(IconSize), 16);

    static AppButton()
    {
        IsLoadingProperty.Changed.AddClassHandler<AppButton>((x, _) => x.UpdateClasses());
    }

    /// <summary>When true, shows a spinner in place of the icon and suppresses interaction.</summary>
    public bool IsLoading
    {
        get => GetValue(IsLoadingProperty);
        set => SetValue(IsLoadingProperty, value);
    }

    /// <summary>Leading icon, resolved the same way as <see cref="AppIcon.Icon"/>. No icon is rendered when empty.</summary>
    public string? IconName
    {
        get => GetValue(IconNameProperty);
        set => SetValue(IconNameProperty, value);
    }

    /// <summary>Width/height of the leading icon (and loading spinner), in DIPs. Defaults to 16.</summary>
    public double IconSize
    {
        get => GetValue(IconSizeProperty);
        set => SetValue(IconSizeProperty, value);
    }

    private void UpdateClasses()
    {
        PseudoClasses.Set(":loading", IsLoading);
        IsHitTestVisible = !IsLoading;
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        UpdateClasses();
    }
}
