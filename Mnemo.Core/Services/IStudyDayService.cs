using System.Globalization;

namespace Mnemo.Core.Services;

/// <summary>
/// Which calendar day an instant of study belongs to, for the whole product. The study screen and
/// the analytics surface both resolve their day through this, so a session and the row that
/// reports it cannot disagree about what today is.
/// </summary>
/// <remarks>
/// A day is local and ends at a configured hour rather than at midnight, so studying late still
/// counts towards the evening the user thinks they are in.
/// </remarks>
public interface IStudyDayService
{
    /// <summary>
    /// The local hour a day rolls over at, 0 to 23. Falls back to the built-in default when the
    /// collection has no stored scheduling profile yet.
    /// </summary>
    ValueTask<int> GetDayStartHourAsync(CancellationToken cancellationToken = default);

    /// <summary>The day an instant belongs to, in the user's own time zone.</summary>
    ValueTask<DateOnly> DayOfAsync(DateTimeOffset instant, CancellationToken cancellationToken = default);

    /// <summary>The day now belongs to.</summary>
    ValueTask<DateOnly> TodayAsync(CancellationToken cancellationToken = default);

    /// <summary>The stored form of the day an instant belongs to.</summary>
    ValueTask<string> KeyForAsync(DateTimeOffset instant, CancellationToken cancellationToken = default);

    /// <summary>The stored form of today.</summary>
    ValueTask<string> TodayKeyAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// The stored form of a day, and the key every day-keyed statistics kind is written under.
    /// Fixed width and zero padded, so keys sort lexicographically in chronological order.
    /// </summary>
    static string KeyOf(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
