using System;

namespace Mnemo.Core.Services;

/// <summary>
/// Formats timestamps for display so date presentation is consistent across modules:
/// localized relative wording for recent moments, culture-aware absolute dates beyond.
/// </summary>
public interface IDateDisplayService
{
    /// <summary>Relative wording under 7 days ("3 hours ago"), culture-native short date beyond.</summary>
    string FormatSmart(DateTime timestamp);

    /// <summary>Always relative ("just now", "3 weeks ago"), localized.</summary>
    string FormatRelative(DateTime timestamp);

    /// <summary>Culture-native short date (e.g. "22.06.2026" for nb, "6/22/2026" for en-US).</summary>
    string FormatAbsolute(DateTime timestamp);

    /// <summary>Weekday and date without the year for page headings (e.g. "Thursday, July 3"), culture-aware.</summary>
    string FormatDayHeading(DateTime timestamp);
}
