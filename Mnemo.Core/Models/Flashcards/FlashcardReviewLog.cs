namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// An append-only review record. Feeds true retention, trends and (later) FSRS weight
/// optimization. Written by scheduled Review sessions and by an import carrying another app's
/// history across, never by Cram or Test.
/// </summary>
public sealed record FlashcardReviewLog(
    long Id,
    string CardId,
    string DeckId,
    string SessionId,
    FlashcardReviewGrade Grade,
    DateTimeOffset ReviewedAt,
    double ElapsedDays,
    double ScheduledDays,
    double? StabilityAfter,
    double? DifficultyAfter,
    // The state the card was in when the answer was given, null only on rows written before it
    // was recorded. Weight optimization needs the state a review started from, and that cannot
    // be recovered from the state it ended in.
    FlashcardFsrsState? StateBefore,
    FlashcardFsrsState StateAfter,
    // Where the answer came from. Defaulted, so the only caller that has to say anything is the
    // one writing history it did not watch happen.
    FlashcardReviewOrigin Origin = FlashcardReviewOrigin.Studied)
{
    /// <summary>Sentinel id for a log row that has not yet been assigned an autoincrement id.</summary>
    public const long Unassigned = 0;
}
