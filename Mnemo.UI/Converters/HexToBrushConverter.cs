using System;
using System.Globalization;
using Avalonia.Data.Converters;
using Avalonia.Media;

namespace Mnemo.UI.Converters;

/// <summary>Turns a hex color string into a brush for a live swatch preview; transparent when it doesn't parse.</summary>
public sealed class HexToBrushConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string s && Color.TryParse(s, out var color) ? new SolidColorBrush(color) : Brushes.Transparent;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => null;
}
