using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// A live, stateful study session. Cards graded into a sub-horizon learning step are re-queued within
/// the same session (the real fix for "Again is cosmetic"); graduated cards leave. Review commits each
/// grade to storage as it happens; Cram commits nothing.
/// </summary>
public interface IFlashcardSession
{
    FlashcardSessionMode Mode { get; }
    string DeckId { get; }

    /// <summary>True only for Review — Cram never writes to the schedule.</summary>
    bool WritesSchedule { get; }

    bool IsFinished { get; }

    /// <summary>The card being studied, or null when the session is finished.</summary>
    FlashcardView? Current { get; }

    FlashcardSessionProgress Progress { get; }

    /// <summary>Next-interval preview for a grade button applied to the current card.</summary>
    string DescribeInterval(FlashcardReviewGrade grade);

    /// <summary>Grades the current card, advances the queue, and (Review only) persists the outcome.</summary>
    Task GradeAsync(FlashcardReviewGrade grade, CancellationToken cancellationToken = default);

    /// <summary>Reverses the last grade (schedule + log + counters). Returns false if nothing to undo.</summary>
    Task<bool> UndoAsync(CancellationToken cancellationToken = default);
}
