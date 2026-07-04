using System;
using System.Collections.Generic;
using System.Globalization;
using Avalonia.Controls;
using Avalonia.Data.Converters;
using Avalonia.Media;
using Avalonia.Styling;

namespace Mnemo.UI.Components.BlockEditor;

/// <summary>
/// Converts bool to a brush for block selection highlight. True = theme BlockSelectionBrush from control's resource tree, False = Transparent.
/// Expects MultiBinding: first value = IsSelected (bool), second value = IResourceHost (e.g. the Border) to resolve theme resources.
/// </summary>
public class BoolToSelectionBrushConverter : IMultiValueConverter
{
    public object? Convert(IList<object?> values, Type targetType, object? parameter, CultureInfo culture)
    {
        if (values is not { Count: >= 2 } || values[0] is not true)
            return Brushes.Transparent;

        if (values[1] is IResourceHost host &&
            host.TryFindResource("BlockSelectionBrush", null, out var res) &&
            res is IBrush brush)
            return brush;

        var app = Avalonia.Application.Current;
        if (app?.Resources.TryGetResource("BlockSelectionBrush", ThemeVariant.Default, out var blockRes) == true && blockRes is IBrush blockBrush)
            return blockBrush;
        if (app?.Resources.TryGetResource("AccentBrush", ThemeVariant.Default, out var accentRes) == true && accentRes is IBrush themeBrush)
            return themeBrush;
        return new SolidColorBrush(new Color(128, 0, 120, 255)); // fallback
    }
}
