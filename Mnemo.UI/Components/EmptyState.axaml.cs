using System.Windows.Input;
using Avalonia;
using Avalonia.Controls.Primitives;

namespace Mnemo.UI.Components;

/// <summary>
/// Shared empty/no-results placeholder: tinted icon tile, title, optional description
/// and optional call-to-action. Use for empty libraries, empty search results, and
/// first-run states so every module presents them the same way.
/// </summary>
public class EmptyState : TemplatedControl
{
    public static readonly StyledProperty<string?> IconPathProperty =
        AvaloniaProperty.Register<EmptyState, string?>(nameof(IconPath));

    public static readonly StyledProperty<string?> TitleProperty =
        AvaloniaProperty.Register<EmptyState, string?>(nameof(Title));

    public static readonly StyledProperty<string?> DescriptionProperty =
        AvaloniaProperty.Register<EmptyState, string?>(nameof(Description));

    public static readonly StyledProperty<string?> ActionTextProperty =
        AvaloniaProperty.Register<EmptyState, string?>(nameof(ActionText));

    public static readonly StyledProperty<ICommand?> ActionCommandProperty =
        AvaloniaProperty.Register<EmptyState, ICommand?>(nameof(ActionCommand));

    /// <summary>Avares URI of the SVG glyph shown in the tinted tile.</summary>
    public string? IconPath
    {
        get => GetValue(IconPathProperty);
        set => SetValue(IconPathProperty, value);
    }

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

    /// <summary>Label of the call-to-action button; the button is hidden when empty.</summary>
    public string? ActionText
    {
        get => GetValue(ActionTextProperty);
        set => SetValue(ActionTextProperty, value);
    }

    public ICommand? ActionCommand
    {
        get => GetValue(ActionCommandProperty);
        set => SetValue(ActionCommandProperty, value);
    }
}
