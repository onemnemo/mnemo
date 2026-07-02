using System;
using System.Globalization;
using Avalonia.Data.Converters;
using Mnemo.Core.Models;

namespace Mnemo.UI.Converters;

/// <summary>
/// Converts ChatAttachmentKind to bool. Parameter "Image" = true when Kind is Image; "File" = true when Kind is File.
/// </summary>
public class ChatAttachmentKindToBoolConverter : IValueConverter
{
    public static readonly ChatAttachmentKindToBoolConverter Instance = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not ChatAttachmentKind kind)
            return false;
        var param = parameter?.ToString() ?? "Image";
        
        if (param.Equals("Image", StringComparison.OrdinalIgnoreCase))
            return kind == ChatAttachmentKind.Image;
            
        if (param.Equals("File", StringComparison.OrdinalIgnoreCase))
            return kind == ChatAttachmentKind.File;

        return false;
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
