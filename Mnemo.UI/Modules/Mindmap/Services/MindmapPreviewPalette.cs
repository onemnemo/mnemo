using System.Collections.Generic;
using Avalonia.Media;
using Avalonia.Media.Immutable;

namespace Mnemo.UI.Modules.Mindmap.Services;

/// <summary>
/// Branch colors for library thumbnails. These describe map <em>content</em> (a user's
/// color-coded branches), not app chrome, so they stay constant across themes and live in
/// code rather than the theme token ramp. Immutable brushes are safe to build off the UI thread.
/// </summary>
public static class MindmapPreviewPalette
{
    /// <summary>Accent-family branch tones, applied by node order when a node has no explicit color.</summary>
    public static readonly IReadOnlyList<IImmutableSolidColorBrush> Branches = new IImmutableSolidColorBrush[]
    {
        new ImmutableSolidColorBrush(Color.Parse("#C64F33")),
        new ImmutableSolidColorBrush(Color.Parse("#B8862B")),
        new ImmutableSolidColorBrush(Color.Parse("#3D7A4E")),
        new ImmutableSolidColorBrush(Color.Parse("#4A6B8A")),
        new ImmutableSolidColorBrush(Color.Parse("#7A5687")),
    };

    /// <summary>Root node / primary accent tone.</summary>
    public static readonly IImmutableSolidColorBrush Root = new ImmutableSolidColorBrush(Color.Parse("#C64F33"));

    /// <summary>Muted tone for connective edges in thumbnails.</summary>
    public static readonly IImmutableSolidColorBrush Edge = new ImmutableSolidColorBrush(Color.Parse("#B4B0A8"));

    public static IImmutableSolidColorBrush Branch(int index) => Branches[((index % Branches.Count) + Branches.Count) % Branches.Count];

    /// <summary>Parses a stored node color (hex) into a brush, falling back to a palette branch by index.</summary>
    public static IImmutableSolidColorBrush Resolve(string? storedColor, int index)
    {
        if (!string.IsNullOrWhiteSpace(storedColor) && Color.TryParse(storedColor, out var parsed))
            return new ImmutableSolidColorBrush(parsed);
        return Branch(index);
    }
}
