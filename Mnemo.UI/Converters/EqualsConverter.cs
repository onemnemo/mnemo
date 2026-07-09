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
        string.Equals(Format(value), Format(parameter), StringComparison.Ordinal);

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        BindingOperations.DoNothing;

    // Invariant string form so numeric parameters (e.g. edge thickness "1.5") compare the same in every
    // culture; enum and string values are unaffected.
    private static string? Format(object? value) => value switch
    {
        null => null,
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString(),
    };
}
