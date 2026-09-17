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
    /// What this grade does to the card, or null when this grade raises nothing.
    /// </summary>
    /// <remarks>
    /// Fires on the threshold lapse and then on every half-threshold after it, so a card that is
    /// unsuspended and forgotten again is raised a second time instead of going quiet forever.
    /// Only the count is judged here; whether the card already carries the mark is judged against
    /// the stored card at the moment of the write, by <see cref="Apply"/>.
    /// </remarks>
    public static FlashcardLeechAction? Evaluate(FlashcardSchedule before, FlashcardSchedule after, FlashcardPreset preset)
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

        return preset.LeechAction;
    }

    /// <summary>
    /// The card with the mark on it and which parts of the mark were new to it, or null when the
    /// card already carries everything the action asks for.
    /// </summary>
    /// <remarks>
    /// Re-tagging a card that already carries the tag is a write with no change in it, and
    /// re-suspending one that is already suspended is the same. Undo lifts exactly the parts
    /// recorded as new, so a tag or a suspension the card had before the grade stays.
    /// </remarks>
    public static (Flashcard Card, FlashcardLeechMark Mark)? Apply(Flashcard card, FlashcardLeechAction action, DateTimeOffset now)
    {
        if (action == FlashcardLeechAction.None)
            return null;

        var tagAdded = !HasTag(card.Tags);
        var suspended = action == FlashcardLeechAction.Suspend && card.State != FlashcardCardState.Suspended;
        if (!tagAdded && !suspended)
            return null;

        var marked = card with
        {
            Tags = tagAdded ? WithTag(card.Tags) : card.Tags,
            State = suspended ? FlashcardCardState.Suspended : card.State,
            UpdatedAt = now,
        };
        return (marked, new FlashcardLeechMark(tagAdded, suspended));
    }

    /// <summary>
    /// The card with exactly the parts of a mark that the grade added taken back off it. The
    /// modified time stays as it is, because the row really did change twice.
    /// </summary>
    public static Flashcard Lift(Flashcard card, FlashcardLeechMark mark) =>
        card with
        {
            Tags = mark.TagAdded ? WithoutTag(card.Tags) : card.Tags,
            State = mark.Suspended && card.State == FlashcardCardState.Suspended ? FlashcardCardState.Active : card.State,
        };

    private static bool HasTag(IReadOnlyList<string> tags) =>
        tags.Contains(FlashcardPreset.LeechTag, StringComparer.OrdinalIgnoreCase);

    private static IReadOnlyList<string> WithTag(IReadOnlyList<string> tags)
    {
        var next = new List<string>(tags.Count + 1);
        next.AddRange(tags);
        next.Add(FlashcardPreset.LeechTag);
        return next;
    }

    private static IReadOnlyList<string> WithoutTag(IReadOnlyList<string> tags) =>
        tags.Where(t => !string.Equals(t, FlashcardPreset.LeechTag, StringComparison.OrdinalIgnoreCase)).ToArray();
}
