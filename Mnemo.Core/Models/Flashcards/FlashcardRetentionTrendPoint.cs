namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Retention point for deck-level sparkline/trend rendering.
/// </summary>
/// <param name="RetentionPercent">Null on a day with no reviews, which has no retention rather than a retention of 0%.</param>
public sealed record FlashcardRetentionTrendPoint(
    DateOnly Day,
    int? RetentionPercent,
    int ReviewsCount);
