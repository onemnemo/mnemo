using System.Collections.Generic;
using System.Globalization;

namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// Typed accessors over the string-encoded per-instance settings bag
/// (<see cref="WidgetInstance.Settings"/>). Missing or malformed values fall back
/// to the schema default so a stale or hand-edited layout can never break a widget.
/// </summary>
public static class WidgetSettingValues
{
    /// <summary>Returns the stored value for <paramref name="schema"/>, or its default when absent.</summary>
    public static string GetString(IReadOnlyDictionary<string, string>? settings, WidgetSettingSchema schema)
    {
        if (settings != null && settings.TryGetValue(schema.Key, out var value) && !string.IsNullOrWhiteSpace(value))
            return value;
        return schema.DefaultValue;
    }

    /// <summary>Returns the stored integer value for <paramref name="schema"/>, or its default when absent/invalid.</summary>
    public static int GetInt(IReadOnlyDictionary<string, string>? settings, WidgetSettingSchema schema)
    {
        var raw = GetString(settings, schema);
        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value))
            return value;
        return int.TryParse(schema.DefaultValue, NumberStyles.Integer, CultureInfo.InvariantCulture, out var fallback) ? fallback : 0;
    }

    /// <summary>Returns the stored boolean value for <paramref name="schema"/>, or its default when absent/invalid.</summary>
    public static bool GetBool(IReadOnlyDictionary<string, string>? settings, WidgetSettingSchema schema)
    {
        var raw = GetString(settings, schema);
        if (bool.TryParse(raw, out var value))
            return value;
        return bool.TryParse(schema.DefaultValue, out var fallback) && fallback;
    }

    /// <summary>Formats an integer for storage in a settings bag.</summary>
    public static string FromInt(int value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>Formats a boolean for storage in a settings bag.</summary>
    public static string FromBool(bool value) => value ? "true" : "false";
}
