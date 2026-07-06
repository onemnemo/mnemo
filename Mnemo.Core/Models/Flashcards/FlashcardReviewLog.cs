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
    FlashcardFsrsState StateAfter)
{
    /// <summary>Sentinel id for a log row that has not yet been assigned an autoincrement id.</summary>
    public const long Unassigned = 0;
}
