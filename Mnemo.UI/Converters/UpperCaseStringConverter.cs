using System;
using System.Globalization;
using Avalonia.Data.Converters;

namespace Mnemo.UI.Converters;

/// <summary>Uppercases a bound string for display (e.g. section header labels). Purely visual — does not mutate the source value.</summary>
public class UpperCaseStringConverter : IValueConverter
{
    public static readonly UpperCaseStringConverter Instance = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is string s ? s.ToUpper(culture) : value;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
