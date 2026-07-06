namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Per-deck, per-day counters that enforce the new/day and reviews/day caps without scanning the
/// review log. <see cref="Date"/> is the LOCAL day (yyyy-MM-dd) captured at review time and never
/// recomputed if the time zone later changes.
/// </summary>
public sealed record FlashcardDailyStat(
    string DeckId,
    string Date,
    int NewIntroduced,
    int ReviewsDone);
