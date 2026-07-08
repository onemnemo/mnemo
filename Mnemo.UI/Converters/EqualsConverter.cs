using System;
using System.Globalization;
using Avalonia.Data;
using Avalonia.Data.Converters;

namespace Mnemo.UI.Converters;

/// <summary>
/// True when the bound value's string form equals the converter parameter. Used to highlight the active
/// choice among a set of option buttons (e.g. the current node shape or font scale in the style toolbar).
/// </summary>
public sealed class EqualsConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value?.ToString() == parameter?.ToString();

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        BindingOperations.DoNothing;
}
