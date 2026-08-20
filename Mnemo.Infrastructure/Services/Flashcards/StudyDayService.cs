using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <inheritdoc />
/// <remarks>
/// The rollover hour is stored on a scheduling profile, and a deck may be pointed at any of them,
/// but a day has to be one thing: analytics counts every deck into a single row per day, so a
/// per-deck hour would file one evening's study under two different days. The seeded profile is
/// the collection's answer. It always exists, deleting it is refused, and it is the profile a deck
/// keeps until somebody deliberately points it at another one.
/// </remarks>
public sealed class StudyDayService : IStudyDayService
{
    private readonly IFlashcardPresetService _presets;
    private readonly FlashcardClock _clock;

    public StudyDayService(IFlashcardPresetService presets, FlashcardClock clock)
    {
        ArgumentNullException.ThrowIfNull(presets);
        ArgumentNullException.ThrowIfNull(clock);
        _presets = presets;
        _clock = clock;
    }

    /// <inheritdoc />
    public async ValueTask<int> GetDayStartHourAsync(CancellationToken cancellationToken = default)
    {
        // Read rather than seeded: recording a statistic must not create a scheduling profile as a
        // side effect, and a collection that has never opened flashcards still has to have a day.
        var standard = await _presets
            .GetPresetAsync(FlashcardPreset.StandardPresetId, cancellationToken)
            .ConfigureAwait(false);
        return standard?.DayStartHour ?? FlashcardPreset.DefaultNextDayStartsAtHour;
    }

    /// <inheritdoc />
    public async ValueTask<DateOnly> DayOfAsync(DateTimeOffset instant, CancellationToken cancellationToken = default) =>
        _clock.DayOf(instant, await GetDayStartHourAsync(cancellationToken).ConfigureAwait(false));

    /// <inheritdoc />
    public ValueTask<DateOnly> TodayAsync(CancellationToken cancellationToken = default) =>
        DayOfAsync(_clock.Now, cancellationToken);

    /// <inheritdoc />
    public async ValueTask<string> KeyForAsync(DateTimeOffset instant, CancellationToken cancellationToken = default) =>
        IStudyDayService.KeyOf(await DayOfAsync(instant, cancellationToken).ConfigureAwait(false));

    /// <inheritdoc />
    public ValueTask<string> TodayKeyAsync(CancellationToken cancellationToken = default) =>
        KeyForAsync(_clock.Now, cancellationToken);
}
