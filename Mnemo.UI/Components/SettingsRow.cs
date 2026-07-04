using Avalonia;
using Avalonia.Controls.Primitives;

namespace Mnemo.UI.Components;

/// <summary>
/// Flat settings row: title + optional description on the left, an optional
/// control (toggle, dropdown, button, ...) on the right, separated from the
/// next row by a subtle bottom divider. Rows stack directly under an
/// uppercase section label.
/// </summary>
public class SettingsRow : TemplatedControl
{
    public static readonly StyledProperty<string?> TitleProperty =
        AvaloniaProperty.Register<SettingsRow, string?>(nameof(Title));

    public static readonly StyledProperty<string?> DescriptionProperty =
        AvaloniaProperty.Register<SettingsRow, string?>(nameof(Description));

    public static readonly StyledProperty<object?> RightContentProperty =
        AvaloniaProperty.Register<SettingsRow, object?>(nameof(RightContent));

    public static readonly StyledProperty<bool> ShowDividerProperty =
        AvaloniaProperty.Register<SettingsRow, bool>(nameof(ShowDivider), defaultValue: true);

    public string? Title
    {
        get => GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    public string? Description
    {
        get => GetValue(DescriptionProperty);
        set => SetValue(DescriptionProperty, value);
    }

    public object? RightContent
    {
        get => GetValue(RightContentProperty);
        set => SetValue(RightContentProperty, value);
    }

    /// <summary>Bottom divider; the last row in a section hides it (the next section label provides the separation).</summary>
    public bool ShowDivider
    {
        get => GetValue(ShowDividerProperty);
        set => SetValue(ShowDividerProperty, value);
    }
}
