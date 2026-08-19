namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// An append-only review record. Feeds true retention, trends and (later) FSRS weight
/// optimization. Written only by scheduled Review sessions — never by Cram or Test.
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
    FlashcardFsrsState StateAfter)
{
    /// <summary>Sentinel id for a log row that has not yet been assigned an autoincrement id.</summary>
    public const long Unassigned = 0;
}
