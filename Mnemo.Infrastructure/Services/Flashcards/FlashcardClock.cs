using System;
using System.Globalization;

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
    /// "today" follows their own midnight rather than UTC's.
    /// </summary>
    public DateOnly DayOf(DateTimeOffset instant) => DateOnly.FromDateTime(ToLocal(instant).DateTime);

    /// <summary>The study day right now.</summary>
    public DateOnly Today() => DayOf(Now);

    /// <summary>The stored form of a study day, used as the daily-stats key.</summary>
    public static string KeyOf(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>The stored form of the study day an instant belongs to.</summary>
    public string KeyFor(DateTimeOffset instant) => KeyOf(DayOf(instant));

    /// <summary>The stored form of today's study day.</summary>
    public string TodayKey() => KeyOf(Today());
}
