using System;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>
/// One deck row in the unified flashcard library tree.
/// </summary>
public sealed class FlashcardDeckRowViewModel
{
    /// <summary>Retention at or above this percentage renders as "high" (green) rather than "low" (amber).</summary>
    private const int RetentionHighThreshold = 70;

    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public string? FolderId { get; init; }

    /// <summary>Indentation depth in the tree (0 = root-level deck).</summary>
    public int Depth { get; set; }

    public int TotalCards { get; init; }

    public int RetentionScore { get; init; }

    /// <summary>Cards in the <c>New</c> state.</summary>
    public int NewCount { get; init; }

    /// <summary>Due cards in <c>Learning</c>/<c>Relearning</c> state.</summary>
    public int LearnCount { get; init; }

    /// <summary>Due cards in <c>Review</c> state.</summary>
    public int ReviewDueCount { get; init; }

    public bool HasNew => NewCount > 0;

    public bool HasLearn => LearnCount > 0;

    public bool HasDue => ReviewDueCount > 0;

    /// <summary>Total cards waiting today across all buckets.</summary>
    public int DueToday => NewCount + LearnCount + ReviewDueCount;

    /// <summary>Nothing waiting — row renders dimmed with an "Up to date" label instead of counts.</summary>
    public bool IsUpToDate => DueToday == 0;

    /// <summary>Retention bar (0–100).</summary>
    public int RetentionPercent => Math.Clamp(RetentionScore, 0, 100);

    /// <summary>Fixed pixel width of the retention track (fill is a fraction of this).</summary>
    private const double RetentionTrackWidth = 34d;

    /// <summary>Pixel width of the filled portion of the retention bar.</summary>
    public double RetentionFillWidth => RetentionTrackWidth * RetentionPercent / 100d;

    public bool RetentionIsHigh => RetentionScore >= RetentionHighThreshold;

    public string RetentionText => $"{RetentionScore}%";

    /// <summary>Localized "n cards".</summary>
    public string CardCountLine { get; init; } = string.Empty;
}
