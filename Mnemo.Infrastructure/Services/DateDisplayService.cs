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

    public string FormatDayHeading(DateTime timestamp)
    {
        var culture = CultureInfo.CurrentCulture;
        var pattern = RemoveYearFromPattern(culture.DateTimeFormat.LongDatePattern);
        return NormalizeToUtc(timestamp).ToLocalTime().ToString(pattern, culture);
    }

    /// <summary>
    /// Strips the year (and its adjacent separators/literals) from a long-date pattern so
    /// headings read "Thursday, July 3" instead of "Thursday, July 3, 2026". Works on the
    /// culture's own pattern, so word order and literals ("de", "年") stay culture-correct.
    /// </summary>
    private static string RemoveYearFromPattern(string longDatePattern)
    {
        var tokens = TokenizePattern(longDatePattern);
        var keep = new bool[tokens.Count];
        for (var i = 0; i < tokens.Count; i++)
            keep[i] = true;

        for (var i = 0; i < tokens.Count; i++)
        {
            if (!tokens[i].IsSpecifier || tokens[i].Text[0] != 'y')
                continue;

            keep[i] = false;

            // Absorb separators/literals toward the previous date part; when the year leads
            // the pattern, absorb toward the next date part instead ("yyyy年M月d日" → "M月d日").
            var j = i - 1;
            var absorbedLeft = false;
            while (j >= 0 && !tokens[j].IsSpecifier)
            {
                keep[j] = false;
                absorbedLeft = true;
                j--;
            }

            if (!absorbedLeft || j < 0)
            {
                var k = i + 1;
                while (k < tokens.Count && !tokens[k].IsSpecifier)
                {
                    keep[k] = false;
                    k++;
                }
            }
        }

        var builder = new System.Text.StringBuilder(longDatePattern.Length);
        for (var i = 0; i < tokens.Count; i++)
        {
            if (keep[i])
                builder.Append(tokens[i].Text);
        }

        var result = builder.ToString().Trim();
        return result.Length == 0 ? longDatePattern : result;
    }

    private readonly record struct PatternToken(string Text, bool IsSpecifier);

    /// <summary>Splits a date pattern into specifier runs ("dddd", "yyyy") and everything else (separators, quoted literals).</summary>
    private static List<PatternToken> TokenizePattern(string pattern)
    {
        var tokens = new List<PatternToken>();
        var i = 0;
        while (i < pattern.Length)
        {
            var c = pattern[i];
            if (c is '\'' or '"')
            {
                var end = pattern.IndexOf(c, i + 1);
                end = end < 0 ? pattern.Length - 1 : end;
                tokens.Add(new PatternToken(pattern.Substring(i, end - i + 1), IsSpecifier: false));
                i = end + 1;
            }
            else if (c == '\\' && i + 1 < pattern.Length)
            {
                tokens.Add(new PatternToken(pattern.Substring(i, 2), IsSpecifier: false));
                i += 2;
            }
            else if (char.IsLetter(c))
            {
                var start = i;
                while (i < pattern.Length && pattern[i] == c)
                    i++;
                tokens.Add(new PatternToken(pattern[start..i], IsSpecifier: true));
            }
            else
            {
                var start = i;
                while (i < pattern.Length && !char.IsLetter(pattern[i]) && pattern[i] != '\'' && pattern[i] != '"' && pattern[i] != '\\')
                    i++;
                tokens.Add(new PatternToken(pattern[start..i], IsSpecifier: false));
            }
        }

        return tokens;
    }

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
