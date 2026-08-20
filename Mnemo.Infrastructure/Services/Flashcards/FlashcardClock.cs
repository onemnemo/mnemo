using System;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// The clock the flashcard services read, and the single definition of a study day.
/// It is injected rather than read from the static properties so that day boundaries,
/// rollover and time zone behaviour can be driven from a chosen instant in tests instead
/// of from whenever the suite happens to run.
/// </summary>
public sealed class FlashcardClock
{
    private readonly TimeProvider _time;

    public FlashcardClock(TimeProvider time)
    {
        ArgumentNullException.ThrowIfNull(time);
        _time = time;
    }

    /// <summary>The current instant, in UTC. Every stored timestamp is written from this.</summary>
    public DateTimeOffset Now => _time.GetUtcNow();

    /// <summary>The instant as the person studying would read it off a wall clock.</summary>
    public DateTimeOffset ToLocal(DateTimeOffset instant) =>
        TimeZoneInfo.ConvertTime(instant, _time.LocalTimeZone);

    /// <summary>
    /// The study day an instant belongs to. Days are local, because a person's sense of
    /// "today" follows their own midnight rather than UTC's, and they end at
    /// <paramref name="startHour"/>, so studying after midnight still counts as the evening
    /// the user thinks they are in.
    /// </summary>
    public DateOnly DayOf(DateTimeOffset instant, int startHour) =>
        DateOnly.FromDateTime(ToLocal(instant).DateTime.AddHours(-startHour));

    /// <summary>The study day right now.</summary>
    public DateOnly Today(int startHour) => DayOf(Now, startHour);

    /// <summary>
    /// The instant a study day begins. Comparing due dates or bucketing a chart needs the
    /// boundary as a real instant, because the offset it sits at moves with daylight saving.
    /// </summary>
    public DateTimeOffset StartOf(DateOnly day, int startHour)
    {
        var zone = _time.LocalTimeZone;
        var wall = day.ToDateTime(new TimeOnly(startHour, 0));

        // Springing forward can delete the wall clock hour a day was meant to start at. The day
        // still has to start somewhere, so it starts when that hour would have arrived.
        if (zone.IsInvalidTime(wall))
            wall = wall.AddHours(1);

        return new DateTimeOffset(wall, zone.GetUtcOffset(wall));
    }

    /// <summary>
    /// When a card scheduled a whole number of days out becomes due. Day-scale intervals land on
    /// the start of a study day rather than on the clock time of the answer, so cards answered
    /// across an evening are all waiting together the morning they come up, instead of trickling
    /// back one at a time through the day.
    /// </summary>
    public DateTimeOffset DueAfterDays(DateTimeOffset reviewedAt, int days, int startHour) =>
        StartOf(DayOf(reviewedAt, startHour).AddDays(days), startHour);

    /// <summary>How many study days separate two instants. Negative if the second is earlier.</summary>
    public int DaysBetween(DateTimeOffset from, DateTimeOffset to, int startHour) =>
        DayOf(to, startHour).DayNumber - DayOf(from, startHour).DayNumber;

    /// <summary>The stored form of a study day, used as the daily-stats key.</summary>
    public static string KeyOf(DateOnly day) => IStudyDayService.KeyOf(day);

    /// <summary>The stored form of the study day an instant belongs to.</summary>
    public string KeyFor(DateTimeOffset instant, int startHour) => KeyOf(DayOf(instant, startHour));

    /// <summary>The stored form of today's study day.</summary>
    public string TodayKey(int startHour) => KeyOf(Today(startHour));
}
