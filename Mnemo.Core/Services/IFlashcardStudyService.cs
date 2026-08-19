using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// Due-count queries and the atomic Review write. The session engine (start/requeue/caps) layers on
/// top of this separately. Only Review persists here — Cram and Test never call
/// <see cref="RecordReviewAsync"/>, keeping FSRS structurally immune to off-schedule practice.
/// </summary>
public interface IFlashcardStudyService
{
    /// <summary>Cap-aware new/learning/due counts for one deck (honours the preset's daily limits).</summary>
    Task<FlashcardDueCounts> GetDueCountsAsync(string deckId, CancellationToken cancellationToken = default);

    /// <summary>Cap-aware counts summed across all decks (due-today banner and totals).</summary>
    Task<FlashcardDueCounts> GetAggregateDueCountsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// What the scheduler will hand back over the next <paramref name="days"/> UTC days across every
    /// deck, today first. Always returns one entry per day, zeroes included, so a caller can chart
    /// the window without filling gaps itself.
    /// </summary>
    Task<IReadOnlyList<FlashcardForecastDay>> GetReviewForecastAsync(int days, CancellationToken cancellationToken = default);

    /// <summary>
    /// Builds a live session for the deck. Review draws the scheduled (cap-limited) queue; Cram draws
    /// its scope (Due or All) uncapped and persists nothing. Shuffle comes from the deck's preset.
    /// </summary>
    Task<IFlashcardSession> StartSessionAsync(FlashcardSessionRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Persists one graded Review across schedule + review log + daily stats in a single transaction,
    /// returning the new review-log id (for exact undo). Review only.
    /// </summary>
    Task<long> RecordReviewAsync(FlashcardReviewEntry entry, CancellationToken cancellationToken = default);

    /// <summary>
    /// Reverses a review: restores the prior schedule, deletes the review-log row and decrements the
    /// daily-stats counters. Exact inverse of <see cref="RecordReviewAsync"/>.
    /// </summary>
    /// <param name="restoredCard">
    /// The card as it was before the grade, passed only when that grade marked it a leech. Undo has
    /// to take the tag and the suspension back with the lapse, or the card stays punished for a
    /// review that no longer exists.
    /// </param>
    Task UndoReviewAsync(string deckId, FlashcardSchedule restoredSchedule, long reviewId, string localDay, bool wasNewIntroduction, Flashcard? restoredCard = null, CancellationToken cancellationToken = default);
}
