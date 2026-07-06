using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// FSRS-5 scheduler operating on the split <see cref="FlashcardSchedule"/> with per-preset retention
/// and learning steps. This is the single scheduling seam (the algorithm resolver is gone).
/// </summary>
public interface IFsrsScheduler
{
    /// <summary>Returns the next schedule after grading, honouring the preset's steps and retention.</summary>
    FlashcardSchedule ApplyGrade(FlashcardSchedule current, FlashcardReviewGrade grade, DateTimeOffset reviewedAt, FlashcardPreset preset);

    /// <summary>Human-readable next-interval preview for a grade button (e.g. "10m", "1d", "8d").</summary>
    string DescribeInterval(FlashcardSchedule current, FlashcardReviewGrade grade, DateTimeOffset now, FlashcardPreset preset);
}
