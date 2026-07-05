using System.Globalization;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// FormatDayHeading must strip the year (and its separators/literals) from the culture's
/// long-date pattern without disturbing word order, across structurally different cultures.
/// </summary>
public sealed class DateDisplayServiceDayHeadingTests
{
    private sealed class NullLocalizationService : ILocalizationService
    {
        public string CurrentLanguage => "en";
        public event EventHandler? LanguageChanged { add { } remove { } }
        public string GetString(string key, string? ns = null) => key;
        public string T(string key, string? ns = null) => key;
        public Task<bool> SetLanguageAsync(string languageCode, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<IEnumerable<LanguageManifest>> GetAvailableLanguagesAsync() => Task.FromResult(Enumerable.Empty<LanguageManifest>());
    }

    // A fixed local date; heading formatting is date-only, so time of day is irrelevant.
    private static readonly DateTime SampleDate = new(2026, 7, 3, 12, 0, 0, DateTimeKind.Local);

    private static string HeadingFor(string cultureName)
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo(cultureName);
            return new DateDisplayService(new NullLocalizationService()).FormatDayHeading(SampleDate);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Theory]
    [InlineData("en-US", "Friday, July 3")]
    [InlineData("de-DE", "Freitag, 3. Juli")]
    [InlineData("nb-NO", "fredag 3. juli")]
    public void FormatDayHeading_DropsYear_KeepsCultureWordOrder(string culture, string expected)
    {
        Assert.Equal(expected, HeadingFor(culture));
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("de-DE")]
    [InlineData("es-ES")]
    [InlineData("ja-JP")]
    [InlineData("nb-NO")]
    public void FormatDayHeading_NeverContainsYear(string culture)
    {
        Assert.DoesNotContain("2026", HeadingFor(culture));
    }

    [Theory]
    [InlineData("es-ES")]
    [InlineData("ja-JP")]
    public void FormatDayHeading_KeepsDayAndMonth(string culture)
    {
        var heading = HeadingFor(culture);
        Assert.Contains("3", heading);
        Assert.False(string.IsNullOrWhiteSpace(heading));
    }

    [Fact]
    public void FormatDayHeading_DoesNotLeaveDanglingSeparators()
    {
        foreach (var culture in new[] { "en-US", "de-DE", "es-ES", "ja-JP", "nb-NO" })
        {
            var heading = HeadingFor(culture);
            Assert.Equal(heading.Trim(), heading);
            Assert.False(heading.EndsWith(",", StringComparison.Ordinal), $"{culture}: '{heading}'");
            Assert.False(heading.EndsWith("de", StringComparison.Ordinal) && culture == "es-ES", $"{culture}: '{heading}'");
        }
    }
}
