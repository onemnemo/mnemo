using Avalonia;

namespace Mnemo.UI.Controls;

/// <summary>
/// Ergonomic wrapper around <see cref="SvgIcon"/> that resolves an icon by name
/// (e.g. <c>Icon="Common/folder"</c>, <c>Icon="Toast/error"</c>) instead of a full
/// avares path, so call sites don't hardcode <c>Icons/</c> paths and survive folder
/// reorganizations in one place.
/// </summary>
public class AppIcon : SvgIcon
{
    public static readonly StyledProperty<string?> IconProperty =
        AvaloniaProperty.Register<AppIcon, string?>(nameof(Icon));

    /// <summary>Icon identifier relative to <c>Mnemo.UI/Icons/</c>, without extension (e.g. "Sidebar/flashcard").</summary>
    public string? Icon
    {
        get => GetValue(IconProperty);
        set => SetValue(IconProperty, value);
    }

    static AppIcon()
    {
        IconProperty.Changed.AddClassHandler<AppIcon>((icon, _) =>
        {
            icon.SvgPath = string.IsNullOrEmpty(icon.Icon)
                ? null
                : $"avares://Mnemo.UI/Icons/{icon.Icon}.svg";
        });
    }
}
