using System;
using System.Globalization;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

/// <summary>
/// Default <see cref="IDateDisplayService"/>: localized relative wording (Common namespace)
/// for timestamps under a week old, culture-native short dates beyond.
/// </summary>
public sealed class DateDisplayService : IDateDisplayService
{
    private const string Ns = "Common";

    private readonly ILocalizationService _localization;

    public DateDisplayService(ILocalizationService localization)
    {
        _localization = localization ?? throw new ArgumentNullException(nameof(localization));
    }

    public string FormatSmart(DateTime timestamp)
    {
        return DateTime.UtcNow - NormalizeToUtc(timestamp) < TimeSpan.FromDays(7)
            ? FormatRelative(timestamp)
            : FormatAbsolute(timestamp);
    }

    public string FormatRelative(DateTime timestamp)
    {
        var diff = DateTime.UtcNow - NormalizeToUtc(timestamp);
        if (diff < TimeSpan.Zero) diff = TimeSpan.Zero;

        if (diff.TotalMinutes < 1) return _localization.T("JustNow", Ns);
        if (diff.TotalMinutes < 60) return Format("MinutesAgo", (int)diff.TotalMinutes);
        if (diff.TotalHours < 24) return Format("HoursAgo", (int)diff.TotalHours);
        if (diff.TotalDays < 7) return Format("DaysAgo", (int)diff.TotalDays);
        if (diff.TotalDays < 30) return Format("WeeksAgo", (int)(diff.TotalDays / 7));
        if (diff.TotalDays < 365) return Format("MonthsAgo", (int)(diff.TotalDays / 30));
        return Format("YearsAgo", (int)(diff.TotalDays / 365));
    }

    public string FormatAbsolute(DateTime timestamp)
        => NormalizeToUtc(timestamp).ToLocalTime().ToString("d", CultureInfo.CurrentCulture);

    private string Format(string key, int value)
        => string.Format(CultureInfo.CurrentCulture, _localization.T(key, Ns), value);

    /// <summary>Unspecified kinds are treated as UTC, matching the storage convention.</summary>
    private static DateTime NormalizeToUtc(DateTime timestamp) => timestamp.Kind switch
    {
        DateTimeKind.Utc => timestamp,
        DateTimeKind.Local => timestamp.ToUniversalTime(),
        _ => DateTime.SpecifyKind(timestamp, DateTimeKind.Utc)
    };
}
