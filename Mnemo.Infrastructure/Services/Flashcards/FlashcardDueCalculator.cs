using System;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// Applies a preset's daily caps to raw due counts. New cards beyond the day's remaining new budget
/// are not introduced; mature (Due) reviews are bounded by the remaining review budget. Learning
/// cards are never capped. They must be finished once started.
/// </summary>
internal static class FlashcardDueCalculator
{
    public static FlashcardDueCounts Cap(FlashcardDueCounts raw, FlashcardPreset preset, FlashcardDailyStat today)
    {
        var newBudget = Math.Max(0, preset.NewPerDay - today.NewIntroduced);
        var newShown = Math.Min(raw.New, newBudget);

        var reviewBudget = Math.Max(0, preset.MaxReviewsPerDay - today.ReviewsDone);
        var dueShown = Math.Min(raw.Due, reviewBudget);

        return new FlashcardDueCounts(newShown, raw.Learning, dueShown);
    }
}
