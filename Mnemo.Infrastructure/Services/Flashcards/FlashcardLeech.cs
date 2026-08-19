using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// The rule for a card that keeps being forgotten.
/// </summary>
/// <remarks>
/// FSRS answers a lapse by shortening the interval, which is the right answer for a card the
/// reader can learn and the wrong one for a card that is unlearnable as written. Past a preset's
/// threshold the scheduler stops shortening and hands the card back to its author.
/// </remarks>
internal static class FlashcardLeech
{
    /// <summary>
    /// The card as it should be stored after this grade, or null when this grade changes nothing.
    /// </summary>
    /// <remarks>
    /// Fires on the threshold lapse and then on every half-threshold after it, so a card that is
    /// unsuspended and forgotten again is raised a second time instead of going quiet forever.
    /// The card is checked as well as the count: re-tagging a card that already carries the tag is
    /// a write with no change in it, and re-suspending one the reader deliberately woke would undo
    /// their decision on the next lapse rather than after another run of them.
    /// </remarks>
    public static Flashcard? Evaluate(
        Flashcard card,
        FlashcardSchedule before,
        FlashcardSchedule after,
        FlashcardPreset preset,
        DateTimeOffset now)
    {
        if (preset.LeechAction == FlashcardLeechAction.None)
            return null;

        // Only a grade that actually cost the card a lapse counts. Every other grade leaves the
        // count where it was, and re-reading a count that has not moved would raise the same card
        // on every answer once it was past the line.
        if (after.Lapses <= before.Lapses)
            return null;

        var threshold = preset.LeechLapses;
        if (after.Lapses < threshold)
            return null;
        if ((after.Lapses - threshold) % Math.Max(1, threshold / 2) != 0)
            return null;

        var tags = WithTag(card.Tags);
        var state = preset.LeechAction == FlashcardLeechAction.Suspend
            ? FlashcardCardState.Suspended
            : card.State;

        if (ReferenceEquals(tags, card.Tags) && state == card.State)
            return null;

        return card with { Tags = tags, State = state, UpdatedAt = now };
    }

    private static IReadOnlyList<string> WithTag(IReadOnlyList<string> tags)
    {
        if (tags.Contains(FlashcardPreset.LeechTag, StringComparer.OrdinalIgnoreCase))
            return tags;

        var next = new List<string>(tags.Count + 1);
        next.AddRange(tags);
        next.Add(FlashcardPreset.LeechTag);
        return next;
    }
}
