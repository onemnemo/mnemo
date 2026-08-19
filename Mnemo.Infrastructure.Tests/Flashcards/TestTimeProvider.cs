using System;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// A clock the test drives. Scheduling behaviour that turns on a day boundary, a rollover hour
/// or a time zone can only be asserted if the test picks the instant, so nothing here reads the
/// machine clock unless a test asks for it.
/// </summary>
internal sealed class TestTimeProvider : TimeProvider
{
    private readonly TimeZoneInfo _zone;

    public TestTimeProvider(DateTimeOffset now, TimeZoneInfo? zone = null)
    {
        UtcNow = now;
        _zone = zone ?? TimeZoneInfo.Utc;
    }

    /// <summary>The instant every read returns until a test moves it.</summary>
    public DateTimeOffset UtcNow { get; set; }

    public override DateTimeOffset GetUtcNow() => UtcNow;

    public override TimeZoneInfo LocalTimeZone => _zone;

    public void Advance(TimeSpan by) => UtcNow = UtcNow.Add(by);

    public void AdvanceTo(DateTimeOffset instant) => UtcNow = instant;
}
