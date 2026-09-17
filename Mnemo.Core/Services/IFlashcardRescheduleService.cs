using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// Moves cards in time without grading them: to a due date, back to the new queue, or to a place
/// in the new queue. Every operation leaves suspended cards, cards the trash holds and unknown ids
/// alone, and never touches the review log.
/// </summary>
public interface IFlashcardRescheduleService
{
    /// <summary>
    /// Makes cards due <paramref name="daysFromNow"/> study days from now; zero is today. A review,
    /// learning or relearning card keeps its memory state and its counts and becomes a review card
    /// due at the start of that day. A new card leaves the new queue the same way, with no memory
    /// state until its first grade. With <paramref name="matchInterval"/> the stability is
    /// rewritten so retrievability reaches the preset's desired retention exactly on the new due
    /// date, counted from the card's last review, or from now for a card that has none.
    /// </summary>
    Task SetDueAsync(IReadOnlyList<string> cardIds, int daysFromNow, bool matchInterval, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns cards to the new queue: state New, no memory state, due now, which places them at
    /// the back of the queue. Reps, lapses and the last review instant stay on the card unless
    /// <paramref name="keepCounts"/> is false, in which case they are cleared. The review log is
    /// the deck's history and the optimizer's training data, so it is kept either way. Cards that
    /// are already new are left alone.
    /// </summary>
    Task ResetAsync(IReadOnlyList<string> cardIds, bool keepCounts, CancellationToken cancellationToken = default);

    /// <summary>
    /// Moves the active new cards among <paramref name="cardIds"/> to a place in their own deck's
    /// new queue, keeping the order they already had among themselves. Cards with a schedule are
    /// left alone. <paramref name="position"/> is one-based, read only for
    /// <see cref="FlashcardQueuePlacement.At"/>, and clamped to the queue: past the end means last.
    /// </summary>
    Task RepositionAsync(IReadOnlyList<string> cardIds, FlashcardQueuePlacement placement, int position, CancellationToken cancellationToken = default);

    /// <summary>How many active new cards a deck's queue holds. Zero for an unknown deck.</summary>
    Task<int> CountNewQueueAsync(string deckId, CancellationToken cancellationToken = default);
}
