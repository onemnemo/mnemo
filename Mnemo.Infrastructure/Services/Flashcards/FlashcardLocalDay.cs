using System;
using System.Globalization;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// Derives the local-day key (yyyy-MM-dd) used by the daily-stats caps. The key is computed from the
/// user's clock at the moment of review and stored verbatim — never recomputed if the time zone
/// later changes.
/// </summary>
internal static class FlashcardLocalDay
{
    public static string For(DateTimeOffset instant) =>
        instant.ToLocalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static string Today() => For(DateTimeOffset.Now);
}
